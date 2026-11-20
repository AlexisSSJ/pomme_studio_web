"""Password hashing and JWT helpers.

These primitives are intentionally small: they are the building blocks used by
the auth endpoints and by the request dependencies in `app.api.deps`.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings

# bcrypt only; hashes are portable and do not require any external service.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True when `plain` matches the bcrypt `hashed` value."""
    try:
        return pwd_context.verify(plain, hashed)
    except (TypeError, ValueError):
        # Malformed / non-bcrypt hash: treat as a failed verification rather
        # than leaking an exception to the caller.
        return False


def get_password_hash(password: str) -> str:
    """Hash a plaintext password with bcrypt.

    Note: bcrypt only considers the first 72 bytes of the input. Enforce a
    password length limit at the API/schema layer if that matters.
    """
    return pwd_context.hash(password)


def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """Sign a JWT containing `data` plus `exp`/`iat` claims."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode a JWT, returning its claims or `None` when invalid/expired."""
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
    except JWTError:
        return None
