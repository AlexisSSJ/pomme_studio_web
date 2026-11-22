import io
import anyio
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

class WatermarkError(ValueError):
    """Raised when the input data cannot be parsed as a valid image."""
    pass

def _apply_watermark(data: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = img.convert("RGB")
            width, height = img.size

            # Create a transparent overlay for the watermark text
            txt_layer = Image.new("RGBA", (width, height), (255, 255, 255, 0))
            draw = ImageDraw.Draw(txt_layer)

            # Choose a font size relative to image dimensions
            font_size = max(12, int(min(width, height) / 15))
            try:
                # Try to load a standard sans font if available, otherwise default
                font = ImageFont.truetype("DejaVuSans.ttf", font_size)
            except IOError:
                try:
                    font = ImageFont.truetype("Arial.ttf", font_size)
                except IOError:
                    font = ImageFont.load_default()

            watermark_text = "POMME STUDIO · PREVIEW"
            
            # Draw diagonal repeating pattern across the image
            # We rotate a separate large layer or draw multiple lines diagonally
            # Let's rotate the txt_layer or draw text across
            step_y = max(40, font_size * 3)
            step_x = max(150, font_size * 12)

            for y in range(-height, height * 2, step_y):
                for x in range(-width, width * 2, step_x):
                    draw.text((x, y), watermark_text, fill=(120, 120, 120, 70), font=font)

            # Rotate the whole text layer slightly for a professional diagonal look (-30 degrees)
            rotated_txt = txt_layer.rotate(30, expand=1)
            
            # Paste rotated text onto the image centered or composite
            # To keep original dimensions, we can crop/resize or paste centered
            # Actually, simplest robust way without changing dimensions or complex bounds:
            # Let's paste it by centering the rotated layer onto the original image
            ox = (rotated_txt.width - width) // 2
            oy = (rotated_txt.height - height) // 2
            cropped_txt = rotated_txt.crop((ox, oy, ox + width, oy + height))

            watermarked = Image.alpha_composite(img.convert("RGBA"), cropped_txt).convert("RGB")

            output = io.BytesIO()
            watermarked.save(output, format="JPEG", quality=85)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, SyntaxError) as e:
        raise WatermarkError(f"Invalid image data: {e}") from e

async def render_preview(data: bytes, content_type: str) -> bytes:
    """
    Opens an image, superposes diagonal repeated watermark text, and returns JPEG bytes.
    Runs CPU-bound operations in anyio.to_thread.run_sync.
    """
    return await anyio.to_thread.run_sync(_apply_watermark, data)
