from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import date, time
from enum import Enum

class PapelEnum(str, Enum):
    FISCAL      = "FISCAL"
    COORDENADOR = "COORDENADOR"
    ADMIN       = "ADMIN"
    MOTORISTA   = "MOTORISTA"
    COBRADOR    = "COBRADOR"
    PATIO       = "PATIO"

class PeriodoEnum(str, Enum):
    MANHA = "MANHA"
    TARDE = "TARDE"

class TipoDiaEnum(str, Enum):
    UTIL    = "UTIL"
    SABADO  = "SABADO"
    DOMINGO = "DOMINGO"

class StatusPartidaEnum(str, Enum):
    PENDENTE  = "PENDENTE"
    REALIZADA = "REALIZADA"
    PERDIDA   = "PERDIDA"

class MotivoEnum(str, Enum):
    FALTA_MOTORISTA = "FALTA_MOTORISTA"
    FALTA_COBRADOR  = "FALTA_COBRADOR"
    RA              = "RA"
    SOS             = "SOS"
    TRANSITO        = "TRANSITO"
    ATRASO_PATIO    = "ATRASO_PATIO"
    OUTROS          = "OUTROS"

class TipoEventoEnum(str, Enum):
    RA  = "RA"
    SOS = "SOS"

# ── Auth ─────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    re: str
    senha: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: dict
    fiscal: dict  # alias para compatibilidade com o frontend compilado

class TrocarSenhaRequest(BaseModel):
    re: str
    senha_atual: str
    senha_nova: str

# ── Onboarding de usuário (público.usuario / UsuarioV3) ────────────────────────
class CriarUsuarioRequest(BaseModel):
    re: str
    nome: str
    senha: str
    tipo_funcionario: str  # nome de public.tipo_funcionario (ex: "FISCAL", "COORDENADOR")

class UsuarioCriadoResponse(BaseModel):
    id: UUID
    re: str
    nome: str
    tipo_funcionario: str
    primeiro_acesso: bool

# ── Turno ─────────────────────────────────────────────────────────────────────
class AbrirTurnoRequest(BaseModel):
    linha_id: UUID
    linha_codigo: str
    terminal: str = Field(pattern="^(TP|TS)$")
    periodo: PeriodoEnum
    data: date
    tipo_dia: TipoDiaEnum

class TurnoResponse(BaseModel):
    id: UUID
    linha_codigo: str
    terminal: str
    periodo: PeriodoEnum
    data: date
    tipo_dia: TipoDiaEnum
    status: str
    total_programadas: int
    total_realizadas: int
    total_perdidas: int
    total_ra: int
    total_sos: int
    ipp: float
    ultimo_prefixo: Optional[str] = None
    ultimo_motorista_re: Optional[str] = None
    ultimo_cobrador_re: Optional[str] = None

    class Config:
        from_attributes = True

# ── Registro de Partida ───────────────────────────────────────────────────────
class RegistrarPartidaRequest(BaseModel):
    partida_programada_id: Optional[UUID] = None
    numero_tabela: int
    horario_programado: time
    terminal: str = Field(pattern="^(TP|TS)$")
    prefixo_carro: Optional[str] = None
    motorista_re: Optional[str] = None
    cobrador_re: Optional[str] = None
    status: StatusPartidaEnum
    horario_real: Optional[time] = None
    motivo_perda: Optional[MotivoEnum] = None
    operador_faltante_re: Optional[str] = None
    operador_faltante_tipo: Optional[str] = None
    descricao_perda: Optional[str] = None
    motivo_troca_operador: Optional[str] = None
    coberto_por_tabela: Optional[int] = None

class UltimaDuplaResponse(BaseModel):
    motorista_re: Optional[str] = None
    cobrador_re: Optional[str] = None

# ── Evento RA/SOS ─────────────────────────────────────────────────────────────
class RegistrarEventoRequest(BaseModel):
    prefixo_carro: str
    numero_tabela: int
    tipo_evento: TipoEventoEnum
    horario_evento: time
    local_evento: Optional[str] = None
    prefixo_substituto: Optional[str] = None
    motorista_substituto_re: Optional[str] = None
    cobrador_substituto_re: Optional[str] = None
    horario_retorno_op: Optional[time] = None

# ── Fechar Turno ──────────────────────────────────────────────────────────────
class FecharTurnoRequest(BaseModel):
    observacao: Optional[str] = None
    # Preenchido somente no turno da TARDE (último carro do dia)
    ultimo_prefixo: Optional[str] = None
    ultimo_motorista_re: Optional[str] = None
    ultimo_cobrador_re: Optional[str] = None

# ── IPP / Relatório ───────────────────────────────────────────────────────────
class IPPDiarioResponse(BaseModel):
    linha_codigo: str
    data: date
    tipo_dia: TipoDiaEnum
    periodo: PeriodoEnum
    total_programadas: int
    total_realizadas: int
    total_perdidas: int
    total_ra: int
    total_sos: int
    ipp_percentual: float

# ── Previsão de Recolhida ──────────────────────────────────────────────────────
class PrevisaoRecolhidaRequest(BaseModel):
    linha_codigo: str
    tipo_dia: TipoDiaEnum
    numero_tabela: int
    periodo: PeriodoEnum
    horario_previsto: time
    vigencia: date

class PrevisaoRecolhidaResponse(BaseModel):
    id: UUID
    linha_codigo: str
    tipo_dia: TipoDiaEnum
    numero_tabela: int
    periodo: PeriodoEnum
    horario_previsto: time
    vigencia: date

    class Config:
        from_attributes = True

# ── Painel do Coordenador — Panorama de Linha ─────────────────────────────────
class PanoramaItemResponse(BaseModel):
    horario_previsto: time
    numero_tabela: int
    terminal: str
    status: str
    prefixo_carro: Optional[str] = None
    motorista_re: Optional[str] = None
    cobrador_re: Optional[str] = None
    coberto_por_tabela: Optional[int] = None
    motivo_perda: Optional[MotivoEnum] = None
    motivo_troca_operador: Optional[str] = None

class PanoramaResponse(BaseModel):
    linha_codigo: str
    tipo_dia: TipoDiaEnum
    data: date
    itens: list[PanoramaItemResponse]
