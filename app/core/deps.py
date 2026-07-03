"""
Dependências reutilizáveis para os routers FastAPI.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID
from jose import JWTError
from typing import Callable

from app.core.database import get_db
from app.core.security import decode_token
from app.models.v3 import UsuarioV3

bearer_scheme = HTTPBearer()


async def get_current_usuario(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> UsuarioV3:
    """Valida JWT e retorna o usuário autenticado (qualquer papel)."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido ou expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(credentials.credentials)
        usuario_id: str = payload.get("sub")
        if usuario_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(
        select(UsuarioV3)
        .options(selectinload(UsuarioV3.tipo_funcionario))
        .where(UsuarioV3.id == UUID(usuario_id))
    )
    usuario = result.scalar_one_or_none()
    if usuario is None or not usuario.ativo:
        raise credentials_exception

    # Papel efetivo: prioriza tipo_funcionario (novo), cai pra perfil (legado) como fallback
    usuario.papel_efetivo = usuario.tipo_funcionario.nome if usuario.tipo_funcionario_id else usuario.perfil
    return usuario


def require_papel(*papeis: str) -> Callable:
    """
    Dependência de papel — uso:
        usuario: UsuarioV3 = Depends(require_papel("FISCAL", "COORDENADOR"))

    Garante que o usuário autenticado tem um dos papéis informados.
    """
    async def _check(usuario: UsuarioV3 = Depends(get_current_usuario)) -> UsuarioV3:
        if usuario.papel_efetivo not in papeis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso restrito a: {', '.join(papeis)}",
            )
        return usuario
    return _check
