"""Centralised application settings.

Configuration is read from environment variables, optionally layered over a
`.env` file at the repository root. Field names mirror `.env.example` exactly;
keep both files in sync when adding new settings.

Development defaults are safe placeholders only — real secrets must be injected
through the environment in staging/production.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Repository root (backend/app/core/config.py -> backend/app/core -> ...).
ROOT_DIR = Path(__file__).resolve().parents[3]

# Version prefix shared by the API router and the OpenAPI docs.
API_V1_PREFIX = "/api/v1"


class Settings(BaseSettings):
    """Application settings grouped by concern (app, database, auth, ...)."""

    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- app ---------------------------------------------------------------
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "change-me-in-production"
    # Comma-separated list of browser origins allowed by CORS (development).
    # `NoDecode` keeps pydantic-settings from JSON-decoding the env value first.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # --- database ----------------------------------------------------------
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "pomme_user"
    POSTGRES_PASSWORD: str = "pomme_password"
    POSTGRES_DB: str = "pomme_studio"
    # Authoritative SQLAlchemy async URL; keep in sync with the parts above.
    DATABASE_URL: str = (
        "postgresql+asyncpg://pomme_user:pomme_password@localhost:5432/pomme_studio"
    )

    # --- auth --------------------------------------------------------------
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- storage (S3 / R2-compatible) --------------------------------------
    STORAGE_ENDPOINT: str = "https://<account>.r2.cloudflarestorage.com"
    STORAGE_REGION: str = "auto"
    STORAGE_ACCESS_KEY_ID: str = "change-me"
    STORAGE_SECRET_ACCESS_KEY: str = "change-me"
    STORAGE_BUCKET_NAME: str = "pomme-studio-assets"
    STORAGE_PUBLIC_URL: str = "https://cdn.example.com"

    # --- google calendar ---------------------------------------------------
    GOOGLE_CLIENT_ID: str = "change-me"
    GOOGLE_CLIENT_SECRET: str = "change-me"
    GOOGLE_REDIRECT_URI: str = "http://localhost:3000/api/auth/callback/google"
    GOOGLE_PROJECT_ID: str = "change-me"
    GOOGLE_CALENDAR_ID: str = "primary"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Accept a comma-separated string as well as a JSON list."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() == "development"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance (cached)."""
    return Settings()


settings = get_settings()
