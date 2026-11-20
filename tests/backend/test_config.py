"""Tests for environment-driven settings parsing (`.env`-style values)."""

import pytest
from pydantic import ValidationError

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


def test_discovery_call_minutes_must_be_positive():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, DISCOVERY_CALL_MINUTES=0)


@pytest.mark.parametrize(
    ("start", "end"),
    [("18:00", "09:00"), ("09:00", "09:00")],
)
def test_business_window_must_start_before_end(start, end):
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            STUDIO_BUSINESS_START=start,
            STUDIO_BUSINESS_END=end,
        )


@pytest.mark.parametrize("value", ["9:00", "24:00", "09-00"])
def test_business_times_must_be_valid_hh_mm(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, STUDIO_BUSINESS_START=value)
