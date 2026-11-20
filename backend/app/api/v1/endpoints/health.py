"""Liveness endpoint used by the local setup and deployment checks."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Return a static OK payload; does not touch the database."""
    return {"status": "ok"}
