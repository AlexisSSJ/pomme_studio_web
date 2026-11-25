"""Centralised application settings.

Configuration is read from environment variables, optionally layered over a
`.env` file at the repository root. Field names mirror `.env.example` exactly;
keep both files in sync when adding new settings.

Development defaults are safe placeholders only — real secrets must be injected
through the environment in staging/production.
"""

from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator, model_validator
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
    # Local filesystem root for uploaded project media (brief references,
    # moodboard pins). Consumed by the LocalStorage service.
    MEDIA_ROOT: str = str(ROOT_DIR / "media")

    # --- google calendar ---------------------------------------------------
    GOOGLE_CLIENT_ID: str = "change-me"
    GOOGLE_CLIENT_SECRET: str = "change-me"
    GOOGLE_REDIRECT_URI: str = "http://localhost:3000/api/auth/callback/google"
    GOOGLE_PROJECT_ID: str = "change-me"
    GOOGLE_CALENDAR_ID: str = "primary"
    # OAuth refresh token for server-side Calendar API calls. Empty means the
    # integration is disconnected; the value is never exposed through the API.
    GOOGLE_REFRESH_TOKEN: str = ""

    # --- transcription (voice -> text) -------------------------------------
    # Provider label for operators; the client only needs an OpenAI-compatible
    # endpoint. An empty key disables transcription without failing uploads.
    TRANSCRIPTION_PROVIDER: str = "openai"
    TRANSCRIPTION_API_KEY: str = ""
    TRANSCRIPTION_API_URL: str = "https://api.openai.com/v1/audio/transcriptions"
    TRANSCRIPTION_MODEL: str = "whisper-1"

    # --- AI brief report generation (Gemini) -------------------------------
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"

    # --- studio schedule ---------------------------------------------------
    # IANA timezone used when displaying studio business hours to clients.
    STUDIO_TIMEZONE: str = "America/Mexico_City"
    # Daily business window start/end (HH:MM) for appointment booking.
    STUDIO_BUSINESS_START: str = "09:00"
    STUDIO_BUSINESS_END: str = "18:00"
    # Default length of a discovery / intro call (minutes).
    DISCOVERY_CALL_MINUTES: int = 30
    # Default length of an in-project review or survey meeting (minutes).
    PROJECT_MEETING_MINUTES: int = 60

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_asyncpg_url(cls, value: object) -> object:
        """Accept managed Postgres URLs (postgresql:// or postgres://).

        Railway and similar providers inject a plain postgresql:// URL; the
        async engine requires the +asyncpg driver. SQLite and already-qualified
        URLs pass through unchanged.
        """
        if isinstance(value, str):
            if value.startswith("postgresql://"):
                return value.replace("postgresql://", "postgresql+asyncpg://", 1)
            if value.startswith("postgres://"):
                return value.replace("postgres://", "postgresql+asyncpg://", 1)
        return value

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Accept a comma-separated string as well as a JSON list."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("DISCOVERY_CALL_MINUTES")
    @classmethod
    def _validate_discovery_call_minutes(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("DISCOVERY_CALL_MINUTES must be greater than zero")
        return value

    @field_validator("PROJECT_MEETING_MINUTES")
    @classmethod
    def _validate_project_meeting_minutes(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("PROJECT_MEETING_MINUTES must be greater than zero")
        return value

    @field_validator("STUDIO_BUSINESS_START", "STUDIO_BUSINESS_END")
    @classmethod
    def _validate_business_time(cls, value: str) -> str:
        try:
            parsed = datetime.strptime(value, "%H:%M")
        except ValueError as exc:
            raise ValueError("business times must use valid HH:MM values") from exc
        if parsed.strftime("%H:%M") != value:
            raise ValueError("business times must use valid HH:MM values")
        return value

    @model_validator(mode="after")
    def _validate_business_window(self) -> "Settings":
        start = datetime.strptime(self.STUDIO_BUSINESS_START, "%H:%M").time()
        end = datetime.strptime(self.STUDIO_BUSINESS_END, "%H:%M").time()
        if start >= end:
            raise ValueError("STUDIO_BUSINESS_START must be before STUDIO_BUSINESS_END")
        return self

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
