"""Tests for the password hashing and JWT helpers."""

from datetime import timedelta

from backend.app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)


def test_password_hash_roundtrip():
    hashed = get_password_hash("s3cret-password")

    assert hashed != "s3cret-password"
    assert verify_password("s3cret-password", hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_verify_password_rejects_malformed_hash():
    assert verify_password("whatever", "not-a-bcrypt-hash") is False


def test_access_token_roundtrip():
    token = create_access_token({"sub": "user@example.com", "role": "CLIENT"})
    payload = decode_access_token(token)

    assert payload is not None
    assert payload["sub"] == "user@example.com"
    assert payload["role"] == "CLIENT"
    assert "exp" in payload
    assert "iat" in payload


def test_decode_rejects_garbage():
    assert decode_access_token("this-is-not-a-jwt") is None


def test_decode_rejects_expired_token():
    token = create_access_token({"sub": "user@example.com"}, timedelta(seconds=-1))

    assert decode_access_token(token) is None
