from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_usuario
from app.models.fiscalizacao import LinhaFiscal
from app.models.v3 import UsuarioV3

router = APIRouter(prefix="/linhas", tags=["Linhas"])


class LinhaCreate(BaseModel):
    codigo: str
    nome: str

class LinhaResponse(BaseModel):
    id: UUID
    codigo: str
    nome: str
    ativa: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=list[LinhaResponse])
async def listar_linhas(
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LinhaFiscal).where(LinhaFiscal.ativa == True).order_by(LinhaFiscal.codigo)
    )
    return result.scalars().all()


@router.post("/", response_model=LinhaResponse, status_code=status.HTTP_201_CREATED)
async def criar_linha(
    body: LinhaCreate,
    usuario: UsuarioV3 = Depends(get_current_usuario),
    db: AsyncSession = Depends(get_db),
):
    existente = (await db.execute(
        select(LinhaFiscal).where(LinhaFiscal.codigo == body.codigo)
    )).scalar_one_or_none()
    if existente:
        raise HTTPException(status_code=409, detail=f"Linha {body.codigo} já existe")
    linha = LinhaFiscal(**body.model_dump())
    db.add(linha)
    await db.commit()
    await db.refresh(linha)
    return linha
