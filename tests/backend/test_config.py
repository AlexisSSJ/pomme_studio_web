"""Tests for environment-driven settings parsing (`.env`-style values)."""

from backend.app.core.config import Settings


def test_cors_origins_accepts_comma_separated_env(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == ["http://a.test", "http://b.test"]


def test_cors_origins_accepts_single_origin(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://single.test")

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == ["http://single.test"]


def test_development_group_flags(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "a-real-secret")

    settings = Settings(_env_file=None)

    assert settings.is_production is True
    assert settings.is_development is False
