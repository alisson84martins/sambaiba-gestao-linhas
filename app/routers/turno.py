from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from datetime import datetime
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_usuario
from app.models.fiscalizacao import (
    TurnoFiscal, RegistroPartida, EventoVeiculo, PartidaProgramada,
    JornadaOperador, Refeicao,
)
from app.models.v3 import UsuarioV3
from app.schemas.fiscal import (
    AbrirTurnoRequest, TurnoResponse,
    RegistrarPartidaRequest, RegistrarEventoRequest, FecharTurnoRequest,
    UltimaDuplaResponse,
    RegistrarEntradaJornadaRequest, RegistrarSaidaJornadaRequest, JornadaOperadorResponse,
    RegistrarInicioRefeicaoRequest, RegistrarFimRefeicaoRequest, RefeicaoResponse,
)

router = APIRouter(prefix="/turno", tags=["Turno Fiscal"])


def _calcular_ipp(turno: TurnoFiscal) -> float:
    if turno.total_programadas == 0:
        return 0.0
    return round(turno.total_realizadas / turno.total_programadas * 100, 2)


async def _buscar_ultima_dupla(db: AsyncSession, turno_id: UUID, numero_tabela: int) -> Optional[RegistroPartida]:
    """Última RegistroPartida da tabela dentro do turno, ordenada por horario_programado desc."""
    result = await db.execute(
        select(RegistroPartida).where(
            RegistroPartida.turno_fiscal_id == turno_id,
            RegistroPartida.numero_tabela == numero_tabela,
        ).order_by(RegistroPartida.horario_programado.desc(), RegistroPartida.criado_em.desc())
    )
    return result.scalars().first()


@router.post("/abrir", response_model=TurnoResponse, status_code=status.HTTP_201_CREATED)
async def abrir_turno(
    body: AbrirTurnoRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(
        select(TurnoFiscal).where(
            TurnoFiscal.usuario_id == usuario.id,
            TurnoFiscal.linha_codigo == body.linha_codigo,
            TurnoFiscal.periodo == body.periodo,
            TurnoFiscal.data == body.data,
            TurnoFiscal.status == "ABERTO",
        )
    )
    if q.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Ja existe um turno aberto para esta linha/periodo/data")

    # Conta partidas programadas para este terminal e tipo_dia
    count_q = await db.execute(
        select(func.count(PartidaProgramada.id)).where(
            PartidaProgramada.linha_codigo == body.linha_codigo,
            PartidaProgramada.tipo_dia == body.tipo_dia,
            PartidaProgramada.terminal == body.terminal,
        )
    )
    total_programadas = count_q.scalar() or 0

    turno = TurnoFiscal(**body.model_dump(), usuario_id=usuario.id, total_programadas=total_programadas)
    db.add(turno)
    await db.commit()
    await db.refresh(turno)
    return {**turno.__dict__, "ipp": _calcular_ipp(turno)}


@router.get("/ativo")
async def turno_ativo(
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TurnoFiscal).where(
            TurnoFiscal.usuario_id == usuario.id,
            TurnoFiscal.status == "ABERTO",
        ).order_by(TurnoFiscal.aberto_em.desc())
    )
    turno = result.scalar_one_or_none()
    if not turno:
        return None
    return {**turno.__dict__, "ipp": _calcular_ipp(turno)}


@router.get("/{turno_id}", response_model=TurnoResponse)
async def obter_turno(
    turno_id: UUID,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))
    turno = result.scalar_one_or_none()
    if not turno:
        raise HTTPException(status_code=404, detail="Turno nao encontrado")
    return {**turno.__dict__, "ipp": _calcular_ipp(turno)}


@router.get("/{turno_id}/tabela/{numero_tabela}/ultima-dupla", response_model=Optional[UltimaDuplaResponse])
async def ultima_dupla(
    turno_id: UUID,
    numero_tabela: int,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Retorna a dupla (motorista_re/cobrador_re) do último registro dessa tabela no turno, ou null."""
    ultimo = await _buscar_ultima_dupla(db, turno_id, numero_tabela)
    if not ultimo:
        return None
    return {"motorista_re": ultimo.motorista_re, "cobrador_re": ultimo.cobrador_re}


@router.post("/{turno_id}/partida", status_code=status.HTTP_201_CREATED)
async def registrar_partida(
    turno_id: UUID,
    body: RegistrarPartidaRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    turno = (await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))).scalar_one_or_none()
    if not turno or turno.status != "ABERTO":
        raise HTTPException(status_code=400, detail="Turno nao encontrado ou fechado")
    if turno.usuario_id != usuario.id:
        raise HTTPException(status_code=403, detail="Turno pertence a outro usuario")

    if body.idempotency_key is not None:
        # Fila offline pode reenviar a mesma ação após falha de rede — devolve
        # o registro já criado em vez de duplicar (e re-somar os contadores).
        existente = (await db.execute(
            select(RegistroPartida).where(
                RegistroPartida.turno_fiscal_id == turno_id,
                RegistroPartida.idempotency_key == body.idempotency_key,
            )
        )).scalar_one_or_none()
        if existente:
            return {"id": str(existente.id), "status": existente.status}

    dados = body.model_dump()
    ultimo = await _buscar_ultima_dupla(db, turno_id, body.numero_tabela)

    if ultimo is None:
        # Primeira partida da tabela no turno — dupla obrigatória
        if not dados.get("motorista_re") or not dados.get("cobrador_re"):
            raise HTTPException(
                status_code=400,
                detail="Primeira partida da tabela no turno: motorista_re e cobrador_re sao obrigatorios",
            )
    else:
        # Partidas seguintes — pré-preenche se não informado
        if not dados.get("motorista_re"):
            dados["motorista_re"] = ultimo.motorista_re
        if not dados.get("cobrador_re"):
            dados["cobrador_re"] = ultimo.cobrador_re

        dupla_mudou = (
            dados["motorista_re"] != ultimo.motorista_re
            or dados["cobrador_re"] != ultimo.cobrador_re
        )
        if dupla_mudou and not dados.get("motivo_troca_operador"):
            raise HTTPException(
                status_code=400,
                detail="Dupla diferente da ultima registrada para esta tabela: motivo_troca_operador e obrigatorio",
            )

    registro = RegistroPartida(turno_fiscal_id=turno_id, **dados)
    db.add(registro)
    delta_real = 1 if body.status == "REALIZADA" else 0
    delta_perd = 1 if body.status == "PERDIDA" else 0
    await db.execute(
        update(TurnoFiscal).where(TurnoFiscal.id == turno_id).values(
            total_realizadas=TurnoFiscal.total_realizadas + delta_real,
            total_perdidas=TurnoFiscal.total_perdidas + delta_perd,
            atualizado_em=datetime.utcnow(),
        )
    )
    await db.commit()
    await db.refresh(registro)
    return {"id": str(registro.id), "status": registro.status}


@router.post("/{turno_id}/evento", status_code=status.HTTP_201_CREATED)
async def registrar_evento(
    turno_id: UUID,
    body: RegistrarEventoRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    turno = (await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))).scalar_one_or_none()
    if not turno or turno.status != "ABERTO":
        raise HTTPException(status_code=400, detail="Turno nao encontrado ou fechado")
    if turno.usuario_id != usuario.id:
        raise HTTPException(status_code=403, detail="Turno pertence a outro usuario")
    evento = EventoVeiculo(turno_fiscal_id=turno_id, **body.model_dump())
    db.add(evento)
    field = "total_ra" if body.tipo_evento == "RA" else "total_sos"
    await db.execute(
        update(TurnoFiscal).where(TurnoFiscal.id == turno_id).values(
            **{field: getattr(TurnoFiscal, field) + 1},
            atualizado_em=datetime.utcnow(),
        )
    )
    await db.commit()
    await db.refresh(evento)
    return {"id": str(evento.id), "tipo": evento.tipo_evento, "status": evento.status}


async def _checar_turno_aberto(db: AsyncSession, turno_id: UUID, usuario: UsuarioV3) -> TurnoFiscal:
    turno = (await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))).scalar_one_or_none()
    if not turno or turno.status != "ABERTO":
        raise HTTPException(status_code=400, detail="Turno nao encontrado ou fechado")
    if turno.usuario_id != usuario.id:
        raise HTTPException(status_code=403, detail="Turno pertence a outro usuario")
    return turno


# ─── Jornada do operador (Telas Início/Fim) ────────────────────────────────────
@router.post("/{turno_id}/jornada", response_model=JornadaOperadorResponse, status_code=status.HTTP_201_CREATED)
async def registrar_entrada_jornada(
    turno_id: UUID,
    body: RegistrarEntradaJornadaRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Upsert por (turno, tabela, operador, tipo) — grava/atualiza o horário de entrada."""
    await _checar_turno_aberto(db, turno_id, usuario)

    existente = (await db.execute(
        select(JornadaOperador).where(
            JornadaOperador.turno_fiscal_id == turno_id,
            JornadaOperador.numero_tabela == body.numero_tabela,
            JornadaOperador.operador_re == body.operador_re,
            JornadaOperador.tipo == body.tipo,
        )
    )).scalar_one_or_none()

    if existente:
        existente.horario_entrada = body.horario_entrada
        existente.origem = body.origem
    else:
        existente = JornadaOperador(turno_fiscal_id=turno_id, **body.model_dump())
        db.add(existente)

    await db.commit()
    await db.refresh(existente)
    return existente


@router.patch("/{turno_id}/jornada", response_model=JornadaOperadorResponse)
async def registrar_saida_jornada(
    turno_id: UUID,
    body: RegistrarSaidaJornadaRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Upsert por (turno, tabela, operador, tipo) — grava/atualiza o horário de saída."""
    await _checar_turno_aberto(db, turno_id, usuario)

    existente = (await db.execute(
        select(JornadaOperador).where(
            JornadaOperador.turno_fiscal_id == turno_id,
            JornadaOperador.numero_tabela == body.numero_tabela,
            JornadaOperador.operador_re == body.operador_re,
            JornadaOperador.tipo == body.tipo,
        )
    )).scalar_one_or_none()

    if not existente:
        # Fiscal foi direto pra tela Fim (ex: retomada de turno) — cria mesmo assim
        existente = JornadaOperador(
            turno_fiscal_id=turno_id, numero_tabela=body.numero_tabela,
            operador_re=body.operador_re, tipo=body.tipo,
        )
        db.add(existente)

    existente.horario_saida = body.horario_saida
    await db.commit()
    await db.refresh(existente)
    return existente


# ─── Refeição (Tela Refeição) ───────────────────────────────────────────────────
@router.post("/{turno_id}/refeicao", response_model=RefeicaoResponse, status_code=status.HTTP_201_CREATED)
async def registrar_inicio_refeicao(
    turno_id: UUID,
    body: RegistrarInicioRefeicaoRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Upsert por (turno, tabela) — grava/atualiza o horário de início da refeição."""
    await _checar_turno_aberto(db, turno_id, usuario)

    existente = (await db.execute(
        select(Refeicao).where(
            Refeicao.turno_fiscal_id == turno_id,
            Refeicao.numero_tabela == body.numero_tabela,
        )
    )).scalar_one_or_none()

    if existente:
        existente.motorista_re = body.motorista_re
        existente.cobrador_re = body.cobrador_re
        existente.horario_inicio = body.horario_inicio
    else:
        existente = Refeicao(turno_fiscal_id=turno_id, **body.model_dump())
        db.add(existente)

    await db.commit()
    await db.refresh(existente)
    return existente


@router.patch("/{turno_id}/refeicao", response_model=RefeicaoResponse)
async def registrar_fim_refeicao(
    turno_id: UUID,
    body: RegistrarFimRefeicaoRequest,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Upsert por (turno, tabela) — grava/atualiza o horário de fim da refeição."""
    await _checar_turno_aberto(db, turno_id, usuario)

    existente = (await db.execute(
        select(Refeicao).where(
            Refeicao.turno_fiscal_id == turno_id,
            Refeicao.numero_tabela == body.numero_tabela,
        )
    )).scalar_one_or_none()

    if not existente:
        existente = Refeicao(turno_fiscal_id=turno_id, numero_tabela=body.numero_tabela)
        db.add(existente)

    existente.horario_fim = body.horario_fim
    await db.commit()
    await db.refresh(existente)
    return existente


@router.post("/{turno_id}/fechar", response_model=TurnoResponse)
async def fechar_turno(
    turno_id: UUID,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
    observacao: Optional[str] = None,
    ultimo_prefixo: Optional[str] = None,
    ultimo_motorista_re: Optional[str] = None,
    ultimo_cobrador_re: Optional[str] = None,
):
    turno = (await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))).scalar_one_or_none()
    if not turno or turno.status != "ABERTO":
        raise HTTPException(status_code=400, detail="Turno nao encontrado ou ja fechado")
    if turno.usuario_id != usuario.id:
        raise HTTPException(status_code=403, detail="Turno pertence a outro usuario")
    await db.execute(
        update(TurnoFiscal).where(TurnoFiscal.id == turno_id).values(
            status="FECHADO",
            fechado_em=datetime.utcnow(),
            observacao=observacao,
            ultimo_prefixo=ultimo_prefixo,
            ultimo_motorista_re=ultimo_motorista_re,
            ultimo_cobrador_re=ultimo_cobrador_re,
            atualizado_em=datetime.utcnow(),
        )
    )
    await db.commit()
    result = await db.execute(select(TurnoFiscal).where(TurnoFiscal.id == turno_id))
    turno = result.scalar_one()
    return {**turno.__dict__, "ipp": _calcular_ipp(turno)}
