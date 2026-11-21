"""Tests for the server-side watermarked preview rendering service."""

import io
import struct
import zlib

import pytest
from PIL import Image

from backend.app.services.watermark import WatermarkError, render_preview


def _png_bytes() -> bytes:
    """A real 80x60 PNG so Pillow can actually decode it."""
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (240, 240, 240)).save(buffer, format="PNG")
    return buffer.getvalue()


def _bomb_png_bytes() -> bytes:
    """A tiny PNG whose header declares a 30000x30000 (~900M pixel) frame.

    Pillow raises DecompressionBombError while opening it — before decoding
    any pixel data — because 900M pixels exceed its ~89.5M-pixel bomb
    threshold. DecompressionBombError derives from Exception (not OSError),
    so it must be mapped to WatermarkError explicitly.
    """

    def chunk(cid: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + cid
            + data
            + struct.pack(">I", zlib.crc32(cid + data) & 0xFFFFFFFF)
        )

    signature = b"\x89PNG\r\n\x1a\n"
    # IHDR: 30000x30000, 8-bit RGB. IDAT is a minimal valid zlib stream that
    # is never decoded at open time.
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 30000, 30000, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b""))
    return signature + ihdr + idat


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


@pytest.mark.asyncio
async def test_render_preview_rejects_decompression_bomb():
    with pytest.raises(WatermarkError):
        await render_preview(_bomb_png_bytes(), "image/png")
