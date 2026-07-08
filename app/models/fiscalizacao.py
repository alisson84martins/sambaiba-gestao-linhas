"""
Modelos SQLAlchemy para o schema fiscalizacao.
Mapeiam diretamente as tabelas criadas em fiscalizacao_schema.sql
"""
import uuid
from datetime import datetime, date, time
from sqlalchemy import (
    Column, String, Boolean, SmallInteger, Numeric,
    Date, Time, Text, ForeignKey, Enum as SAEnum,
    UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.orm import relationship
from app.core.database import Base

# ─── PARTIDA PROGRAMADA ───────────────────────────────────────────────────────
class PartidaProgramada(Base):
    __tablename__ = "partida_programada"
    __table_args__ = (
        UniqueConstraint("linha_codigo","tipo_dia","numero_tabela","sequencia","terminal","vigencia",
                         name="idx_pp_unica"),
        {"schema": "fiscalizacao"},
    )

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    linha_id       = Column(UUID(as_uuid=True), nullable=False)
    linha_codigo   = Column(String(20), nullable=False)
    tipo_dia       = Column(SAEnum("UTIL","SABADO","DOMINGO",
                                   name="tipo_dia_enum", schema="fiscalizacao",
                                   create_type=False), nullable=False)
    numero_tabela  = Column(SmallInteger, nullable=False)
    sequencia      = Column(SmallInteger, nullable=False)
    terminal       = Column(String(5), nullable=False)
    horario        = Column(Time, nullable=False)
    km_tabela      = Column(Numeric(8,3))
    vigencia       = Column(Date, nullable=False)
    criado_em      = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

# ─── TURNO FISCAL ─────────────────────────────────────────────────────────────
class TurnoFiscal(Base):
    __tablename__ = "turno_fiscal"
    __table_args__ = {"schema": "fiscalizacao"}

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    usuario_id        = Column(UUID(as_uuid=True),
                               ForeignKey("public.usuario.id",
                                          ondelete="RESTRICT", onupdate="CASCADE"),
                               nullable=False)
    linha_id          = Column(UUID(as_uuid=True), nullable=False)
    linha_codigo      = Column(String(20), nullable=False)
    terminal          = Column(String(5), nullable=False)
    periodo           = Column(SAEnum("MANHA","TARDE",
                                      name="periodo_enum", schema="fiscalizacao",
                                      create_type=False), nullable=False)
    data              = Column(Date, nullable=False)
    tipo_dia          = Column(SAEnum("UTIL","SABADO","DOMINGO",
                                      name="tipo_dia_enum", schema="fiscalizacao",
                                      create_type=False), nullable=False)
    total_programadas = Column(SmallInteger, nullable=False, default=0)
    total_realizadas  = Column(SmallInteger, nullable=False, default=0)
    total_perdidas    = Column(SmallInteger, nullable=False, default=0)
    total_ra          = Column(SmallInteger, nullable=False, default=0)
    total_sos         = Column(SmallInteger, nullable=False, default=0)
    status            = Column(SAEnum("ABERTO","FECHADO",
                                      name="status_turno_enum", schema="fiscalizacao",
                                      create_type=False), nullable=False, default="ABERTO")
    aberto_em         = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    fechado_em        = Column(TIMESTAMP(timezone=True))
    observacao        = Column(Text)
    criado_em         = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    atualizado_em     = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    ultimo_prefixo      = Column(String(10))
    ultimo_motorista_re = Column(String(20))
    ultimo_cobrador_re  = Column(String(20))

    usuario   = relationship("UsuarioV3")
    registros = relationship("RegistroPartida", back_populates="turno")
    eventos   = relationship("EventoVeiculo", back_populates="turno")

# ─── REGISTRO PARTIDA ─────────────────────────────────────────────────────────
class RegistroPartida(Base):
    __tablename__ = "registro_partida"
    __table_args__ = {"schema": "fiscalizacao"}

    id                     = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    turno_fiscal_id        = Column(UUID(as_uuid=True),
                                    ForeignKey("fiscalizacao.turno_fiscal.id"), nullable=False)
    partida_programada_id  = Column(UUID(as_uuid=True),
                                    ForeignKey("fiscalizacao.partida_programada.id"))
    numero_tabela          = Column(SmallInteger, nullable=False)
    horario_programado     = Column(Time, nullable=False)
    terminal               = Column(String(5), nullable=False)
    prefixo_carro          = Column(String(10))
    motorista_re           = Column(String(20))
    cobrador_re            = Column(String(20))
    status                 = Column(SAEnum("PENDENTE","REALIZADA","PERDIDA",
                                           name="status_partida_enum", schema="fiscalizacao",
                                           create_type=False), nullable=False, default="PENDENTE")
    horario_real           = Column(Time)
    motivo_perda           = Column(SAEnum("FALTA_MOTORISTA","FALTA_COBRADOR","RA","SOS",
                                           "TRANSITO","ATRASO_PATIO","OUTROS",
                                           name="motivo_perda_enum", schema="fiscalizacao",
                                           create_type=False))
    operador_faltante_re   = Column(String(20))
    operador_faltante_tipo = Column(String(15))
    descricao_perda        = Column(Text)
    motivo_troca_operador  = Column(Text)      # justificativa quando a dupla muda em relação à última da tabela no turno
    coberto_por_tabela     = Column(SmallInteger)  # número da tabela que efetivamente cobriu este horário
    motivo_ajuste_horario  = Column(Text)      # justificativa quando o horário real é editado na confirmação da viagem
    idempotency_key        = Column(UUID(as_uuid=True))  # chave da fila offline — evita duplicar ao reenviar a mesma ação
    criado_em              = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    atualizado_em          = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    turno = relationship("TurnoFiscal", back_populates="registros")

# ─── EVENTO VEICULO ───────────────────────────────────────────────────────────
class EventoVeiculo(Base):
    __tablename__ = "evento_veiculo"
    __table_args__ = {"schema": "fiscalizacao"}

    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    turno_fiscal_id         = Column(UUID(as_uuid=True),
                                     ForeignKey("fiscalizacao.turno_fiscal.id"), nullable=False)
    prefixo_carro           = Column(String(10), nullable=False)
    numero_tabela           = Column(SmallInteger, nullable=False)
    tipo_evento             = Column(SAEnum("RA","SOS",
                                            name="tipo_evento_enum", schema="fiscalizacao",
                                            create_type=False), nullable=False)
    horario_evento          = Column(Time, nullable=False)
    local_evento            = Column(String(200))
    prefixo_substituto      = Column(String(10))
    motorista_substituto_re = Column(String(20))
    cobrador_substituto_re  = Column(String(20))
    horario_retorno_op      = Column(Time)
    status                  = Column(SAEnum("AGUARDANDO","RESOLVIDO","CONVERTEU_RA",
                                            name="status_evento_enum", schema="fiscalizacao",
                                            create_type=False), nullable=False, default="AGUARDANDO")
    horario_resolucao       = Column(Time)
    observacao              = Column(Text)
    criado_em               = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    atualizado_em           = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    turno = relationship("TurnoFiscal", back_populates="eventos")

# ─── LINHA FISCAL ─────────────────────────────────────────────────────────────
class LinhaFiscal(Base):
    """Cadastro de linhas disponíveis para fiscalização."""
    __tablename__ = "linha_fiscal"
    __table_args__ = {"schema": "fiscalizacao"}

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo    = Column(String(20), nullable=False, unique=True)   # ex: "1726-10"
    nome      = Column(String(100), nullable=False)
    ativa     = Column(Boolean, nullable=False, default=True)
    criado_em = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

# ─── PREVISAO RECOLHIDA ───────────────────────────────────────────────────────
class PrevisaoRecolhida(Base):
    """Horário previsto de chegada na garagem (REC.), por tabela/período/vigência."""
    __tablename__ = "previsao_recolhida"
    __table_args__ = (
        UniqueConstraint("linha_codigo", "tipo_dia", "numero_tabela", "periodo", "vigencia",
                         name="idx_previsao_recolhida_unica"),
        {"schema": "fiscalizacao"},
    )

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    linha_codigo     = Column(String(20), nullable=False)
    tipo_dia         = Column(SAEnum("UTIL", "SABADO", "DOMINGO",
                                     name="tipo_dia_enum", schema="fiscalizacao",
                                     create_type=False), nullable=False)
    numero_tabela    = Column(SmallInteger, nullable=False)
    periodo          = Column(SAEnum("MANHA", "TARDE",
                                     name="periodo_enum", schema="fiscalizacao",
                                     create_type=False), nullable=False)
    horario_previsto = Column(Time, nullable=False)
    vigencia         = Column(Date, nullable=False)
    criado_em        = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

# ─── JORNADA OPERADOR ─────────────────────────────────────────────────────────
class JornadaOperador(Base):
    """Horário de entrada/saída de cada operador por tabela — Telas Início/Fim do app do fiscal."""
    __tablename__ = "jornada_operador"
    __table_args__ = (
        UniqueConstraint("turno_fiscal_id", "numero_tabela", "operador_re", "tipo",
                         name="idx_jornada_operador_unica"),
        {"schema": "fiscalizacao"},
    )

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    turno_fiscal_id = Column(UUID(as_uuid=True),
                             ForeignKey("fiscalizacao.turno_fiscal.id"), nullable=False)
    numero_tabela   = Column(SmallInteger, nullable=False)
    operador_re     = Column(String(20), nullable=False)
    tipo            = Column(SAEnum("MOTORISTA", "COBRADOR",
                                    name="tipo_operador_enum", schema="fiscalizacao",
                                    create_type=False), nullable=False)
    horario_entrada = Column(Time)
    horario_saida   = Column(Time)
    origem          = Column(SAEnum("PRE_DEFINIDO", "MANUAL",
                                    name="origem_jornada_enum", schema="fiscalizacao",
                                    create_type=False), nullable=False, default="MANUAL")
    criado_em       = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    atualizado_em   = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)

# ─── REFEICAO ─────────────────────────────────────────────────────────────────
class Refeicao(Base):
    """Janela de refeição (início/fim) da dupla, por tabela — Tela Refeição do app do fiscal."""
    __tablename__ = "refeicao"
    __table_args__ = (
        UniqueConstraint("turno_fiscal_id", "numero_tabela", name="idx_refeicao_unica"),
        {"schema": "fiscalizacao"},
    )

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    turno_fiscal_id = Column(UUID(as_uuid=True),
                             ForeignKey("fiscalizacao.turno_fiscal.id"), nullable=False)
    numero_tabela   = Column(SmallInteger, nullable=False)
    motorista_re    = Column(String(20))
    cobrador_re     = Column(String(20))
    horario_inicio  = Column(Time)
    horario_fim     = Column(Time)
    criado_em       = Column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    atualizado_em   = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
