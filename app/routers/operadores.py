"""
Busca de colaborador (motorista/cobrador) para as Telas Início/Fim do app do
fiscal — montagem de dupla por tabela.

Consulta public.motorista e public.cobrador (roster de campo já usado em todo
o resto do sistema — ver registro_partida.motorista_re/cobrador_re e o
endpoint /turno/{id}/tabela/{numero}/ultima-dupla), não public.usuario (que é
conta de login e não cobre a maior parte dos cobradores).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.core.deps import get_current_usuario
from app.models.v3 import UsuarioV3, MotoristaV3, CobradorV3
from app.schemas.fiscal import OperadorBuscaResponse

router = APIRouter(prefix="/operadores", tags=["Operadores"])


@router.get("/busca", response_model=list[OperadorBuscaResponse])
async def buscar_operadores(
    q: str,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    """Busca por RE ou nome (case-insensitive, parcial) em motorista + cobrador ativos."""
    termo = f"%{q.strip()}%"
    if not q.strip():
        return []

    motoristas_result = await db.execute(
        select(MotoristaV3).where(
            MotoristaV3.status == "ATIVO",
            or_(MotoristaV3.re.ilike(termo), MotoristaV3.nome.ilike(termo)),
        ).order_by(MotoristaV3.nome).limit(20)
    )
    cobradores_result = await db.execute(
        select(CobradorV3).where(
            CobradorV3.status == "ATIVO",
            or_(CobradorV3.re.ilike(termo), CobradorV3.nome.ilike(termo)),
        ).order_by(CobradorV3.nome).limit(20)
    )

    resultado = [
        OperadorBuscaResponse(re=m.re, nome=m.nome, tipo="MOTORISTA")
        for m in motoristas_result.scalars().all()
    ] + [
        OperadorBuscaResponse(re=c.re, nome=c.nome, tipo="COBRADOR")
        for c in cobradores_result.scalars().all()
    ]
    return resultado
