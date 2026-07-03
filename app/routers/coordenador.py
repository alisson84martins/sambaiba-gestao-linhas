"""
Painel do Coordenador — panorama de linha (timeline única TP+TS) e
gestão do horário previsto de chegada na garagem (previsao_recolhida).

Acesso restrito aos papéis COORDENADOR e ADMIN (ver require_papel em app/core/deps.py).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import date

from app.core.database import get_db
from app.core.deps import require_papel
from app.core.security import hash_password
from app.models.fiscalizacao import (
    PartidaProgramada, RegistroPartida, TurnoFiscal, PrevisaoRecolhida,
)
from app.models.v3 import UsuarioV3, TipoFuncionario
from app.schemas.fiscal import (
    TipoDiaEnum, PanoramaResponse, PanoramaItemResponse,
    PrevisaoRecolhidaRequest, PrevisaoRecolhidaResponse,
    CriarUsuarioRequest, UsuarioCriadoResponse,
)

router = APIRouter(prefix="/coordenador", tags=["Painel do Coordenador"])

_papel_coordenacao = require_papel("COORDENADOR", "ADMIN")
_papel_admin = require_papel("ADMIN")

# Papéis legados (perfil_usuario_enum) que têm correspondente direto em
# tipo_funcionario. Tipos sem correspondência (ex: FISCAL, COBRADOR) caem no
# fallback abaixo — o campo perfil é mantido só por NOT NULL/compatibilidade
# com o v3, mas a autorização real usa tipo_funcionario (ver papel_efetivo
# em app/core/deps.py), então o valor exato do fallback não afeta permissões.
_PERFIL_LEGADO_CORRESPONDENTE = {"ADMIN", "COORDENADOR", "OPERADOR_PATIO", "MOTORISTA", "MECANICO"}
_PERFIL_LEGADO_FALLBACK = "OPERADOR_PATIO"


@router.get("/panorama/{linha_codigo}", response_model=PanoramaResponse)
async def panorama(
    linha_codigo: str,
    data: date,
    tipo_dia: TipoDiaEnum = TipoDiaEnum.UTIL,
    usuario: UsuarioV3 = Depends(_papel_coordenacao),
    db: AsyncSession = Depends(get_db),
):
    """
    Timeline única (TP+TS misturados) da linha inteira num dia, cruzando o
    programado (partida_programada) com o realizado (registro_partida via
    os turnos daquela linha/data), incluindo cobertura cruzada e motivo de perda.
    """
    linha_codigo = linha_codigo.upper()

    # Usa a vigência mais recente <= data para esta linha/tipo_dia como grade programada
    vigencia_result = await db.execute(
        select(func.max(PartidaProgramada.vigencia)).where(
            PartidaProgramada.linha_codigo == linha_codigo,
            PartidaProgramada.tipo_dia == tipo_dia,
            PartidaProgramada.vigencia <= data,
        )
    )
    vigencia = vigencia_result.scalar()

    programadas = []
    if vigencia:
        result = await db.execute(
            select(PartidaProgramada).where(
                PartidaProgramada.linha_codigo == linha_codigo,
                PartidaProgramada.tipo_dia == tipo_dia,
                PartidaProgramada.vigencia == vigencia,
            )
        )
        programadas = result.scalars().all()

    # Registros realizados no dia — todos os turnos (MANHA/TARDE, TP/TS) desta linha/data
    registros_result = await db.execute(
        select(RegistroPartida)
        .join(TurnoFiscal, RegistroPartida.turno_fiscal_id == TurnoFiscal.id)
        .where(
            TurnoFiscal.linha_codigo == linha_codigo,
            TurnoFiscal.tipo_dia == tipo_dia,
            TurnoFiscal.data == data,
        )
    )
    registros = registros_result.scalars().all()

    # Indexa o registro mais recente por (numero_tabela, terminal, horario_programado)
    registros_por_chave = {}
    for r in registros:
        chave = (r.numero_tabela, r.terminal, r.horario_programado)
        atual = registros_por_chave.get(chave)
        if atual is None or r.criado_em > atual.criado_em:
            registros_por_chave[chave] = r

    itens = []
    chaves_usadas = set()

    for p in programadas:
        chave = (p.numero_tabela, p.terminal, p.horario)
        chaves_usadas.add(chave)
        r = registros_por_chave.get(chave)
        itens.append(PanoramaItemResponse(
            horario_previsto=p.horario,
            numero_tabela=p.numero_tabela,
            terminal=p.terminal,
            status=r.status if r else "PENDENTE",
            prefixo_carro=r.prefixo_carro if r else None,
            motorista_re=r.motorista_re if r else None,
            cobrador_re=r.cobrador_re if r else None,
            coberto_por_tabela=r.coberto_por_tabela if r else None,
            motivo_perda=r.motivo_perda if r else None,
            motivo_troca_operador=r.motivo_troca_operador if r else None,
        ))

    # Registros sem partida_programada correspondente (fora da grade importada)
    for chave, r in registros_por_chave.items():
        if chave in chaves_usadas:
            continue
        itens.append(PanoramaItemResponse(
            horario_previsto=r.horario_programado,
            numero_tabela=r.numero_tabela,
            terminal=r.terminal,
            status=r.status,
            prefixo_carro=r.prefixo_carro,
            motorista_re=r.motorista_re,
            cobrador_re=r.cobrador_re,
            coberto_por_tabela=r.coberto_por_tabela,
            motivo_perda=r.motivo_perda,
            motivo_troca_operador=r.motivo_troca_operador,
        ))

    itens.sort(key=lambda i: (i.horario_previsto, i.terminal))

    return PanoramaResponse(
        linha_codigo=linha_codigo,
        tipo_dia=tipo_dia,
        data=data,
        itens=itens,
    )


@router.get("/previsao-recolhida/{linha_codigo}", response_model=list[PrevisaoRecolhidaResponse])
async def listar_previsao_recolhida(
    linha_codigo: str,
    tipo_dia: TipoDiaEnum,
    vigencia: date,
    usuario: UsuarioV3 = Depends(_papel_coordenacao),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PrevisaoRecolhida).where(
            PrevisaoRecolhida.linha_codigo == linha_codigo.upper(),
            PrevisaoRecolhida.tipo_dia == tipo_dia,
            PrevisaoRecolhida.vigencia == vigencia,
        ).order_by(PrevisaoRecolhida.numero_tabela, PrevisaoRecolhida.periodo)
    )
    return result.scalars().all()


@router.post("/previsao-recolhida", response_model=PrevisaoRecolhidaResponse, status_code=status.HTTP_201_CREATED)
async def upsert_previsao_recolhida(
    body: PrevisaoRecolhidaRequest,
    usuario: UsuarioV3 = Depends(_papel_coordenacao),
    db: AsyncSession = Depends(get_db),
):
    """Cria ou atualiza (upsert) o horário previsto de chegada na garagem de uma tabela+período+vigência."""
    linha_codigo = body.linha_codigo.upper()
    existente = (await db.execute(
        select(PrevisaoRecolhida).where(
            PrevisaoRecolhida.linha_codigo == linha_codigo,
            PrevisaoRecolhida.tipo_dia == body.tipo_dia,
            PrevisaoRecolhida.numero_tabela == body.numero_tabela,
            PrevisaoRecolhida.periodo == body.periodo,
            PrevisaoRecolhida.vigencia == body.vigencia,
        )
    )).scalar_one_or_none()

    if existente:
        existente.horario_previsto = body.horario_previsto
        await db.commit()
        await db.refresh(existente)
        return existente

    nova = PrevisaoRecolhida(
        linha_codigo=linha_codigo,
        tipo_dia=body.tipo_dia,
        numero_tabela=body.numero_tabela,
        periodo=body.periodo,
        horario_previsto=body.horario_previsto,
        vigencia=body.vigencia,
    )
    db.add(nova)
    await db.commit()
    await db.refresh(nova)
    return nova


@router.post("/usuarios", response_model=UsuarioCriadoResponse, status_code=status.HTTP_201_CREATED)
async def criar_usuario(
    body: CriarUsuarioRequest,
    usuario: UsuarioV3 = Depends(_papel_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Onboarding de usuário — só ADMIN cria (coordenador não). Cria o registro
    direto em public.usuario (UsuarioV3), a base compartilhada com o v3.
    """
    re = body.re.strip().upper()

    existente = (await db.execute(
        select(UsuarioV3).where(UsuarioV3.re == re)
    )).scalar_one_or_none()
    if existente:
        raise HTTPException(status_code=409, detail=f"Já existe um usuário com RE={re}")

    tipo = (await db.execute(
        select(TipoFuncionario).where(func.upper(TipoFuncionario.nome) == body.tipo_funcionario.strip().upper())
    )).scalar_one_or_none()
    if not tipo:
        raise HTTPException(
            status_code=400,
            detail=f"tipo_funcionario '{body.tipo_funcionario}' não encontrado em public.tipo_funcionario",
        )

    perfil_legado = tipo.nome.upper() if tipo.nome.upper() in _PERFIL_LEGADO_CORRESPONDENTE else _PERFIL_LEGADO_FALLBACK

    novo = UsuarioV3(
        re=re,
        nome=body.nome,
        senha_hash=hash_password(body.senha),
        perfil=perfil_legado,
        tipo_funcionario_id=tipo.id,
        primeiro_acesso=True,
        criado_por=usuario.id,
    )
    db.add(novo)
    await db.commit()
    await db.refresh(novo)
    return UsuarioCriadoResponse(
        id=novo.id, re=novo.re, nome=novo.nome,
        tipo_funcionario=tipo.nome, primeiro_acesso=novo.primeiro_acesso,
    )
