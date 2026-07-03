from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from datetime import datetime
from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token
from app.models.v3 import UsuarioV3
from app.schemas.fiscal import LoginRequest, TokenResponse, TrocarSenhaRequest

router = APIRouter(prefix="/auth", tags=["Autenticação"])

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(UsuarioV3)
        .options(selectinload(UsuarioV3.tipo_funcionario))
        .where(UsuarioV3.re == body.re.upper())
    )
    usuario = result.scalar_one_or_none()
    if not usuario or not verify_password(body.senha, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="RE ou senha inválidos")
    if not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário inativo")

    # Papel efetivo: prioriza tipo_funcionario (novo), cai pra perfil (legado) como fallback
    papel_efetivo = usuario.tipo_funcionario.nome if usuario.tipo_funcionario_id else usuario.perfil

    # Atualiza último acesso
    await db.execute(
        update(UsuarioV3).where(UsuarioV3.id == usuario.id).values(ultimo_acesso=datetime.utcnow())
    )
    await db.commit()
    token = create_access_token({"sub": str(usuario.id), "re": usuario.re, "papel": papel_efetivo})
    usuario_dict = {
        "id":               str(usuario.id),
        "re":               usuario.re,
        "nome":             usuario.nome,
        "papel":            papel_efetivo,
        "periodo":          None,  # public.usuario não tem campo periodo — chave mantida para o frontend compilado
        "primeiro_acesso":  usuario.primeiro_acesso,
    }
    return TokenResponse(
        access_token=token,
        usuario=usuario_dict,
        fiscal=usuario_dict,  # alias para frontend compilado com chave antiga
    )


@router.post("/trocar-senha")
async def trocar_senha(body: TrocarSenhaRequest, db: AsyncSession = Depends(get_db)):
    """Fluxo de primeiro acesso: valida a senha atual e troca por uma nova."""
    result = await db.execute(select(UsuarioV3).where(UsuarioV3.re == body.re.upper()))
    usuario = result.scalar_one_or_none()
    if not usuario or not verify_password(body.senha_atual, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="RE ou senha atual inválidos")

    await db.execute(
        update(UsuarioV3).where(UsuarioV3.id == usuario.id).values(
            senha_hash=hash_password(body.senha_nova),
            primeiro_acesso=False,
            atualizado_em=datetime.utcnow(),
        )
    )
    await db.commit()
    return {"ok": True}
