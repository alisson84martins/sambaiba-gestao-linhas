from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Conexão com o banco — campos separados evitam problemas com caracteres especiais na senha
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "senha"
    DB_NAME: str = "gestao_patio_sambaiba"

    SECRET_KEY: str  # obrigatório via .env — sem default (repositório é público)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    APP_NAME: str = "Fiscalizacao de Linhas - Sambaiba G3"
    VERSION: str = "1.0.0"
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8001"]

settings = Settings()
