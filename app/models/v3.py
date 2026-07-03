"""
Modelos SQLAlchemy para o schema public — base v3 (Sambaíba, sistema legado
EM USO ATIVO NO CAMPO). Não confundir com as classes de app/models/fiscalizacao.py,
que mapeiam o schema fiscalizacao (próprio deste projeto).
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.orm import relationship
from app.core.database import Base

# ─── TIPO FUNCIONARIO ─────────────────────────────────────────────────────────
class TipoFuncionario(Base):
    """Tabela de referência para o tipo/função do funcionário (substitui perfil_usuario_enum)."""
    __tablename__ = "tipo_funcionario"
    __table_args__ = {"schema": "public"}

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nome      = Column(String(30), nullable=False, unique=True)
    descricao = Column(Text)
    ativo     = Column(Boolean, nullable=False, default=True)
    criado_em = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

# ─── USUARIO (v3) ──────────────────────────────────────────────────────────────
class UsuarioV3(Base):
    """Usuários da base v3 — cadastro único a ser usado por todos os sistemas futuros."""
    __tablename__ = "usuario"
    __table_args__ = {"schema": "public"}

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    re                   = Column(String(20), nullable=False, unique=True)
    nome                 = Column(String(100), nullable=False)
    senha_hash           = Column(String(255), nullable=False)
    perfil               = Column(SAEnum("ADMIN", "COORDENADOR", "OPERADOR_PATIO", "MOTORISTA", "MECANICO",
                                         name="perfil_usuario_enum", schema="public", create_type=False),
                                  nullable=False)
    ativo                = Column(Boolean, nullable=False, default=True)
    motorista_id         = Column(UUID(as_uuid=True), ForeignKey("public.motorista.id", ondelete="SET NULL"))
    cobrador_id          = Column(UUID(as_uuid=True), ForeignKey("public.cobrador.id"))
    tipo_funcionario_id  = Column(UUID(as_uuid=True), ForeignKey("public.tipo_funcionario.id"))
    ultimo_acesso        = Column(TIMESTAMP(timezone=True))
    primeiro_acesso      = Column(Boolean, nullable=False, default=True)
    criado_em            = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    criado_por           = Column(UUID(as_uuid=True), ForeignKey("public.usuario.id", ondelete="SET NULL"))
    atualizado_em        = Column(TIMESTAMP(timezone=True))
    atualizado_por       = Column(UUID(as_uuid=True), ForeignKey("public.usuario.id", ondelete="SET NULL"))

    tipo_funcionario = relationship("TipoFuncionario", foreign_keys=[tipo_funcionario_id])

# ─── COBRADOR (v3) ─────────────────────────────────────────────────────────────
class CobradorV3(Base):
    """Cadastro de cobradores na base v3 — mesmo padrão de MotoristaV3."""
    __tablename__ = "cobrador"
    __table_args__ = {"schema": "public"}

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    re             = Column(String(20), nullable=False, unique=True)
    nome           = Column(String(100), nullable=False)
    cpf            = Column(String(14))
    status         = Column(SAEnum("ATIVO", "AFASTADO", "FERIAS", "DESLIGADO",
                                   name="status_motorista_enum", schema="public", create_type=False),
                            nullable=False, default="ATIVO")
    codigo_externo = Column(String(50))
    criado_em      = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    criado_por     = Column(UUID(as_uuid=True))
    atualizado_em  = Column(TIMESTAMP(timezone=True))
    atualizado_por = Column(UUID(as_uuid=True))

# ─── MOTORISTA (v3) ────────────────────────────────────────────────────────────
class MotoristaV3(Base):
    """Campos básicos do motorista na base v3 — útil para telas mostrarem o nome vinculado."""
    __tablename__ = "motorista"
    __table_args__ = {"schema": "public"}

    id     = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    re     = Column(String(20), nullable=False, unique=True)
    nome   = Column(String(100), nullable=False)
    status = Column(SAEnum("ATIVO", "AFASTADO", "FERIAS", "DESLIGADO",
                           name="status_motorista_enum", schema="public", create_type=False),
                    nullable=False, default="ATIVO")
