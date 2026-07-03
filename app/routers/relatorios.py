from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import date
from app.core.database import get_db

router = APIRouter(prefix="/relatorios", tags=["Relatórios"])

@router.get("/ipp-diario")
async def ipp_diario(
    linha_codigo: str = Query(None),
    data_inicio: date = Query(None),
    data_fim: date = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """IPP diário por linha — usa a view fiscalizacao.vw_ipp_diario"""
    sql = "SELECT * FROM fiscalizacao.vw_ipp_diario WHERE 1=1"
    params = {}
    if linha_codigo:
        sql += " AND linha_codigo = :linha_codigo"
        params["linha_codigo"] = linha_codigo
    if data_inicio:
        sql += " AND data >= :data_inicio"
        params["data_inicio"] = data_inicio
    if data_fim:
        sql += " AND data <= :data_fim"
        params["data_fim"] = data_fim
    result = await db.execute(text(sql), params)
    return [dict(r._mapping) for r in result.all()]

@router.get("/pareto-motivos")
async def pareto_motivos(linha_codigo: str = Query(None), db: AsyncSession = Depends(get_db)):
    """Pareto de causas de perda — usa a view fiscalizacao.vw_pareto_motivos"""
    sql = "SELECT * FROM fiscalizacao.vw_pareto_motivos"
    params = {}
    if linha_codigo:
        sql += " WHERE linha_codigo = :linha_codigo"
        params["linha_codigo"] = linha_codigo
    result = await db.execute(text(sql), params)
    return [dict(r._mapping) for r in result.all()]

@router.get("/operadores-recorrentes")
async def operadores_recorrentes(db: AsyncSession = Depends(get_db)):
    """Operadores com 2+ faltas — usa a view fiscalizacao.vw_operadores_recorrentes"""
    result = await db.execute(text("SELECT * FROM fiscalizacao.vw_operadores_recorrentes"))
    return [dict(r._mapping) for r in result.all()]
