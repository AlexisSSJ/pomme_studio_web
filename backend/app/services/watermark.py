"""Server-side watermarked preview rendering for project deliverables.

While a project's final balance is unpaid, clients are shown a
watermarked preview instead of the original file: ``render_preview``
decodes the image bytes with Pillow, overlays repeated diagonal
"``POMME STUDIO · PREVIEW``" text across the whole frame, and re-encodes
the result as JPEG bytes at the original dimensions (no downscale). The
CPU-bound Pillow pipeline runs in a worker thread via
``anyio.to_thread.run_sync`` so the event loop is never blocked.
"""

import io
import math

import anyio
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

# Text overlaid diagonally on every rendered preview.
WATERMARK_TEXT = "POMME STUDIO · PREVIEW"

# Rotation applied to the tiled watermark layer (degrees).
WATERMARK_ANGLE_DEGREES = 30

# Semi-transparent gray that stays visible on both light and dark images.
WATERMARK_FILL = (120, 120, 120, 140)

# JPEG re-encode quality for rendered previews.
PREVIEW_JPEG_QUALITY = 85


class WatermarkError(ValueError):
    """Raised when the payload cannot be decoded as an image."""


def _tile_watermark(width: int, height: int) -> Image.Image:
    """Build a frame-sized transparent layer of repeated diagonal text."""
    font = ImageFont.load_default(size=max(12, min(width, height) // 6))

    # Tile the text on an oversized layer so that, once rotated, the grid
    # still covers every corner of the frame.
    radians = math.radians(WATERMARK_ANGLE_DEGREES)
    cos_a = abs(math.cos(radians))
    sin_a = abs(math.sin(radians))
    layer_width = math.ceil(width * cos_a + height * sin_a)
    layer_height = math.ceil(width * sin_a + height * cos_a)

    layer = Image.new("RGBA", (layer_width, layer_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
    text_width = x1 - x0
    text_height = y1 - y0

    step_x = text_width + max(1, text_width // 3)
    step_y = max(1, text_height) * 3

    row = 0
    while row * step_y < layer_height:
        column = 0
        while column * step_x < layer_width:
            draw.text(
                (column * step_x - x0, row * step_y - y0),
                WATERMARK_TEXT,
                font=font,
                fill=WATERMARK_FILL,
            )
            column += 1
        row += 1

    layer = layer.rotate(WATERMARK_ANGLE_DEGREES, fillcolor=(0, 0, 0, 0))
    # Crop the rotated layer back to the frame, centered.
    offset_x = (layer.width - width) // 2
    offset_y = (layer.height - height) // 2
    return layer.crop((offset_x, offset_y, offset_x + width, offset_y + height))


def _render(data: bytes) -> bytes:
    """Synchronous Pillow pipeline; runs inside a worker thread."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            frame = image.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise WatermarkError("Payload is not a decodable image") from exc

    watermarked = Image.alpha_composite(
        frame.convert("RGBA"), _tile_watermark(*frame.size)
    ).convert("RGB")

    buffer = io.BytesIO()
    watermarked.save(buffer, format="JPEG", quality=PREVIEW_JPEG_QUALITY)
    return buffer.getvalue()


async def render_preview(data: bytes, content_type: str) -> bytes:
    """Render a watermarked JPEG preview of ``data`` and return its bytes.

    The image is decoded from the bytes themselves: ``content_type`` is
    part of the endpoint interface but is never trusted for decoding —
    Pillow sniffs the actual format. The original dimensions are
    preserved (no downscale).

    Raises ``WatermarkError`` when the payload is not a valid image.
    """
    return await anyio.to_thread.run_sync(_render, data)
