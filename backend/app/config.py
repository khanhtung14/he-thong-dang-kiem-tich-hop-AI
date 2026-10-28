from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./inspection.db"
    jwt_secret: str = ""
    jwt_issuer: str = "vehicle-inspection"
    access_token_minutes: int = 30
    cors_origins: str = "http://localhost:5173"
    gemini_api_key: str = ""
    gemini_model: str = ""

    # SMTP Email Configuration
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
    )


settings = Settings()
