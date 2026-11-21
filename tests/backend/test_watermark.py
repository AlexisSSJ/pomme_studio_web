"""Tests for the server-side watermarked preview rendering service."""

import io

import pytest
from PIL import Image

from backend.app.services.watermark import WatermarkError, render_preview


def _png_bytes() -> bytes:
    """A real 80x60 PNG so Pillow can actually decode it."""
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (240, 240, 240)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_render_preview_returns_jpeg_different_from_input():
    png_bytes = _png_bytes()

    out = await render_preview(png_bytes, "image/png")

    assert out != png_bytes
    with Image.open(io.BytesIO(out)) as preview:
        assert preview.format == "JPEG"


@pytest.mark.asyncio
async def test_render_preview_preserves_dimensions():
    png_bytes = _png_bytes()

    out = await render_preview(png_bytes, "image/png")

    with Image.open(io.BytesIO(out)) as preview:
        assert preview.size == (80, 60)


@pytest.mark.asyncio
async def test_render_preview_rejects_invalid_bytes():
    with pytest.raises(WatermarkError):
        await render_preview(b"not-an-image", "image/png")
