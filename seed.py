"""
seed.py — bootstrap do primeiro usuário ADMIN em public.usuario (UsuarioV3).

Por que ainda existe: o onboarding normal de usuário é feito via
POST /coordenador/usuarios (app/routers/coordenador.py), mas esse endpoint
exige um ADMIN já autenticado — ovo e galinha na primeira instalação. Este
script fala direto com o banco só para criar esse primeiro ADMIN; depois
dele, todo onboarding novo deve passar pelo endpoint HTTP.

Uso:
    python seed.py --re ADMIN001 --nome "Alisson Martins" --senha MinhaSenh@123
    python seed.py --re ADMIN001 --nome "Alisson Martins" --senha MinhaSenh@123 --tipo-funcionario COORDENADOR

Execute UMA vez após o schema public (tipo_funcionario incluso) já existir
no banco de destino.
"""
import asyncio
import argparse
from urllib.parse import quote_plus
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.core.config import settings
from app.core.security import hash_password
from app.models.v3 import UsuarioV3, TipoFuncionario, Base

# Mesmo mapeamento usado em POST /coordenador/usuarios — tipos sem
# correspondente direto no perfil_usuario_enum legado caem em OPERADOR_PATIO
# (o campo perfil é vestigial quando tipo_funcionario_id está preenchido,
# ver papel_efetivo em app/core/deps.py).
_PERFIL_LEGADO_CORRESPONDENTE = {"ADMIN", "COORDENADOR", "OPERADOR_PATIO", "MOTORISTA", "MECANICO"}
_PERFIL_LEGADO_FALLBACK = "OPERADOR_PATIO"


async def seed(re: str, nome: str, senha: str, tipo_funcionario: str, db_pass: str = None):
    if db_pass:
        db_url = f"postgresql+asyncpg://postgres:{quote_plus(db_pass)}@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    else:
        db_url = f"postgresql+asyncpg://{settings.DB_USER}:{quote_plus(settings.DB_PASSWORD)}@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        re = re.upper()
        result = await session.execute(select(UsuarioV3).where(UsuarioV3.re == re))
        if result.scalar_one_or_none():
            print(f"[!] Usuário com RE={re} já existe em public.usuario. Nada foi criado.")
            return

        tipo_result = await session.execute(
            select(TipoFuncionario).where(TipoFuncionario.nome == tipo_funcionario.upper())
        )
        tipo = tipo_result.scalar_one_or_none()
        if not tipo:
            print(f"[!] tipo_funcionario '{tipo_funcionario}' não encontrado em public.tipo_funcionario.")
            print("    Rode antes o patch deploy/producao/002-consolidacao-usuarios-public.sql (ou o v3-schema-patch local).")
            return

        perfil_legado = tipo.nome if tipo.nome in _PERFIL_LEGADO_CORRESPONDENTE else _PERFIL_LEGADO_FALLBACK

        usuario = UsuarioV3(
            re=re,
            nome=nome,
            senha_hash=hash_password(senha),
            perfil=perfil_legado,
            tipo_funcionario_id=tipo.id,
            primeiro_acesso=True,
        )
        session.add(usuario)
        await session.commit()
        print(
            f"[OK] Usuário criado: RE={usuario.re} | Nome={usuario.nome} "
            f"| tipo_funcionario={tipo.nome} | primeiro_acesso=True"
        )

    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bootstrap do primeiro ADMIN em public.usuario")
    parser.add_argument("--re",    required=True, help="RE do usuário (ex: ADMIN001)")
    parser.add_argument("--nome",  required=True, help="Nome completo")
    parser.add_argument("--senha", required=True, help="Senha inicial")
    parser.add_argument("--tipo-funcionario", default="ADMIN",
                        help="Nome em public.tipo_funcionario (padrão: ADMIN)")
    parser.add_argument("--db-pass", default=None,
                        help="Senha do PostgreSQL (necessário se tiver caracteres especiais como & @ # $)")
    args = parser.parse_args()

    asyncio.run(seed(args.re, args.nome, args.senha, args.tipo_funcionario, args.db_pass))
