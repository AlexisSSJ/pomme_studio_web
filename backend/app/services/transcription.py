"""Configurable audio-to-text transcription with a clean no-key fallback.

The provider endpoint is OpenAI-compatible (multipart POST with a ``model``
field and a ``file`` part, JSON response with a ``text`` field), so any
compatible service can be configured through ``TRANSCRIPTION_API_URL``.

Transcription is a best-effort enhancement: without an API key it returns
``None`` before touching the network, and every failure (transport, timeout,
HTTP error, unexpected payload) is logged and downgraded to ``None``. Callers
keep the uploaded audio either way.
"""

import logging

import httpx

from ..core.config import settings
from .storage import CONTENT_TYPE_EXTENSIONS

logger = logging.getLogger(__name__)

# Provider calls are bounded so a slow transcription never blocks an upload.
TRANSCRIPTION_TIMEOUT_SECONDS = 30.0


async def transcribe_audio(data: bytes, content_type: str) -> str | None:
    """Transcribe ``data`` with the configured provider.

    Returns the trimmed transcription, or ``None`` when the integration is
    disabled (no API key) or the provider fails in any way. Never raises.
    """
    api_key = settings.TRANSCRIPTION_API_KEY
    if not api_key:
        return None

    extension = CONTENT_TYPE_EXTENSIONS.get(content_type, ".bin")
    try:
        async with httpx.AsyncClient(timeout=TRANSCRIPTION_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.TRANSCRIPTION_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data={"model": settings.TRANSCRIPTION_MODEL},
                files={"file": (f"audio{extension}", data, content_type)},
            )
        if response.status_code >= 400:
            logger.warning(
                "Transcription provider returned status %s", response.status_code
            )
            return None

        payload = response.json()
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str):
            logger.warning("Transcription provider returned an unexpected payload")
            return None
    # A failed transcription must never break the upload that triggered it.
    except Exception as exc:  # noqa: BLE001
        logger.warning("Transcription failed: %s", exc)
        return None

    transcription = text.strip()
    return transcription or None
