import pytest
import io
from PIL import Image
from backend.app.services.watermark import render_preview, WatermarkError

@pytest.mark.asyncio
async def test_render_preview_returns_jpeg_different_from_input():
    img = Image.new("RGB", (80, 60), (240, 240, 240))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    
    out = await render_preview(png_bytes, "image/png")
    assert out != png_bytes
    
    out_img = Image.open(io.BytesIO(out))
    assert out_img.format == "JPEG"

@pytest.mark.asyncio
async def test_render_preview_preserves_dimensions():
    img = Image.new("RGB", (100, 50), (200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    
    out = await render_preview(png_bytes, "image/png")
    out_img = Image.open(io.BytesIO(out))
    assert out_img.size == (100, 50)

@pytest.mark.asyncio
async def test_render_preview_rejects_invalid_bytes():
    with pytest.raises(WatermarkError):
        await render_preview(b"not-an-image", "image/png")
