"""Zero-dependency editorial PDF generator for Pomme Studio brief reports.

Produces a clean, multi-page PDF 1.4 document using standard Type1 fonts
(Times-Bold, Helvetica, Helvetica-Bold, Courier) with Pomme Studio's monochrome
architectural header, project/client metadata block, page numbering, and
structured Markdown rendering (headings, bullet lists, blockquotes, paragraphs).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

PAGE_WIDTH = 595.28  # A4 width in points
PAGE_HEIGHT = 841.89  # A4 height in points
MARGIN_X = 48.0
MARGIN_TOP = 54.0
MARGIN_BOTTOM = 54.0
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X

# Replacements for Unicode punctuation outside WinAnsiEncoding.
_WINANSI_REPLACEMENTS = {
    "\u2014": "-",
    "\u2013": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2022": "-",
    "\u2026": "...",
    "\u2197": "->",
    "\u2192": "->",
    "\u2713": "[OK]",
    "\u2715": "x",
    "\u00a0": " ",
}


def _to_pdf_literal(text: str) -> bytes:
    """Encode text as a WinAnsi PDF string literal with parentheses escaped."""
    cleaned = text
    for src, dst in _WINANSI_REPLACEMENTS.items():
        cleaned = cleaned.replace(src, dst)
    encoded = cleaned.encode("cp1252", errors="replace")
    escaped = (
        encoded.replace(b"\\", b"\\\\")
        .replace(b"(", b"\\(")
        .replace(b")", b"\\)")
    )
    return b"(" + escaped + b")"


def _strip_inline_md(text: str) -> str:
    """Strip common inline Markdown markers cleanly for PDF text flow."""
    result = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    result = re.sub(r"__(.+?)__", r"\1", result)
    result = re.sub(r"`([^`]+)`", r"\1", result)
    result = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", result)
    return result.strip()


def _wrap_text(text: str, max_chars: int) -> list[str]:
    """Word-wrap text to ``max_chars`` per line."""
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= max_chars:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def render_brief_report_pdf(
    *,
    project_title: str,
    client_label: str | None,
    scope_type: str | None,
    generated_at: datetime | None,
    markdown_content: str,
) -> bytes:
    """Render a Pomme Studio branded PDF document from Markdown content."""
    date_dt = generated_at or datetime.now(timezone.utc)
    date_label = date_dt.strftime("%Y-%m-%d")

    pages: list[list[bytes]] = []
    current_ops: list[bytes] = []
    cursor_y = PAGE_HEIGHT - MARGIN_TOP

    def start_new_page() -> None:
        nonlocal current_ops, cursor_y
        if current_ops:
            pages.append(current_ops)
        current_ops = []
        cursor_y = PAGE_HEIGHT - MARGIN_TOP

    def ensure_space(needed_height: float) -> None:
        if cursor_y - needed_height < MARGIN_BOTTOM + 24:
            start_new_page()

    def draw_text(
        x: float,
        y: float,
        text: str,
        *,
        font: str = "F1",
        size: float = 10.5,
        gray: float = 0.07,
    ) -> None:
        current_ops.append(
            f"BT /{font} {size:.2f} Tf {gray:.2f} g {x:.2f} {y:.2f} Td ".encode("ascii")
            + _to_pdf_literal(text)
            + b" Tj ET"
        )

    def draw_rule(y: float, width: float = 0.8, gray: float = 0.07) -> None:
        current_ops.append(
            f"{gray:.2f} G {width:.2f} w {MARGIN_X:.2f} {y:.2f} m {PAGE_WIDTH - MARGIN_X:.2f} {y:.2f} l S".encode(
                "ascii"
            )
        )

    # ---- Page 1 Editorial Header ----
    # Top brand header block
    draw_text(MARGIN_X, cursor_y, "POMME STUDIO", font="F2", size=18.0, gray=0.07)
    draw_text(
        MARGIN_X,
        cursor_y - 14,
        "BRANDING  /  DIRECCION CREATIVA  /  INTERIORES  /  FF&E",
        font="F4",
        size=7.5,
        gray=0.35,
    )
    draw_text(
        PAGE_WIDTH - MARGIN_X - 120,
        cursor_y,
        "REPORTE EJECUTIVO BRIEF",
        font="F4",
        size=8.0,
        gray=0.35,
    )
    draw_text(
        PAGE_WIDTH - MARGIN_X - 120,
        cursor_y - 13,
        f"FECHA: {date_label}",
        font="F4",
        size=8.0,
        gray=0.35,
    )
    cursor_y -= 24
    draw_rule(cursor_y, width=1.2)
    cursor_y -= 26

    # Metadata surface card (#EFECE6 approximation in RGB)
    box_height = 66.0
    box_bottom = cursor_y - box_height + 12
    current_ops.append(
        f"0.94 0.93 0.90 rg {MARGIN_X:.2f} {box_bottom:.2f} {CONTENT_WIDTH:.2f} {box_height:.2f} re f "
        f"0.07 G 0.75 w {MARGIN_X:.2f} {box_bottom:.2f} {CONTENT_WIDTH:.2f} {box_height:.2f} re S".encode(
            "ascii"
        )
    )
    draw_text(MARGIN_X + 12, cursor_y - 4, "PROYECTO", font="F4", size=7.5, gray=0.38)
    draw_text(MARGIN_X + 12, cursor_y - 19, project_title[:68], font="F2", size=13.5, gray=0.07)
    draw_text(
        MARGIN_X + 12,
        cursor_y - 36,
        f"CLIENTE: {client_label or 'No asignado'}    |    ALCANCE: {(scope_type or 'N/A').upper()}",
        font="F4",
        size=8.0,
        gray=0.25,
    )
    cursor_y = box_bottom - 24

    # ---- Parse and render Markdown lines ----
    for raw_line in markdown_content.splitlines():
        line = raw_line.strip()
        if not line:
            cursor_y -= 8
            continue

        if re.match(r"^[-*_]{3,}$", line):
            ensure_space(16)
            draw_rule(cursor_y, width=0.5, gray=0.55)
            cursor_y -= 14
            continue

        if line.startswith("# "):
            heading = _strip_inline_md(line[2:])
            wrapped = _wrap_text(heading.upper(), 56)
            ensure_space(len(wrapped) * 18 + 16)
            cursor_y -= 6
            for wl in wrapped:
                draw_text(MARGIN_X, cursor_y, wl, font="F2", size=14.0)
                cursor_y -= 18
            draw_rule(cursor_y + 4, width=0.8)
            cursor_y -= 10
            continue

        if line.startswith("## "):
            heading = _strip_inline_md(line[3:])
            wrapped = _wrap_text(heading.upper(), 62)
            ensure_space(len(wrapped) * 16 + 18)
            cursor_y -= 8
            for wl in wrapped:
                draw_text(MARGIN_X, cursor_y, wl, font="F3", size=11.5)
                cursor_y -= 15
            draw_rule(cursor_y + 4, width=0.5, gray=0.35)
            cursor_y -= 8
            continue

        if line.startswith("### "):
            heading = _strip_inline_md(line[4:])
            wrapped = _wrap_text(heading, 72)
            ensure_space(len(wrapped) * 14 + 10)
            cursor_y -= 4
            for wl in wrapped:
                draw_text(MARGIN_X, cursor_y, wl, font="F3", size=10.5)
                cursor_y -= 14
            continue

        if line.startswith("> "):
            quote = _strip_inline_md(line[2:])
            wrapped = _wrap_text(quote, 76)
            ensure_space(len(wrapped) * 14 + 8)
            for wl in wrapped:
                draw_text(MARGIN_X + 14, cursor_y, f"|  {wl}", font="F1", size=9.8, gray=0.25)
                cursor_y -= 14
            cursor_y -= 4
            continue

        bullet_match = re.match(r"^([-*]|\d+\.)\s+(.+)$", line)
        if bullet_match:
            prefix = "-" if bullet_match.group(1) in {"-", "*"} else bullet_match.group(1)
            body = _strip_inline_md(bullet_match.group(2))
            wrapped = _wrap_text(body, 78)
            ensure_space(len(wrapped) * 14 + 4)
            for idx, wl in enumerate(wrapped):
                if idx == 0:
                    draw_text(MARGIN_X + 8, cursor_y, prefix, font="F4", size=9.5)
                draw_text(MARGIN_X + 22, cursor_y, wl, font="F1", size=10.0)
                cursor_y -= 14
            cursor_y -= 2
            continue

        paragraph = _strip_inline_md(line)
        wrapped = _wrap_text(paragraph, 84)
        ensure_space(len(wrapped) * 14 + 6)
        for wl in wrapped:
            draw_text(MARGIN_X, cursor_y, wl, font="F1", size=10.0)
            cursor_y -= 14
        cursor_y -= 4

    pages.append(current_ops)

    # Add monochrome footer + page counter to each page
    total_pages = len(pages)
    for page_idx, ops in enumerate(pages, start=1):
        footer_y = MARGIN_BOTTOM - 22
        ops.append(
            f"0.65 G 0.50 w {MARGIN_X:.2f} {footer_y + 12:.2f} m {PAGE_WIDTH - MARGIN_X:.2f} {footer_y + 12:.2f} l S".encode(
                "ascii"
            )
        )
        ops.append(
            f"BT /F4 7.50 Tf 0.45 g {MARGIN_X:.2f} {footer_y:.2f} Td ".encode("ascii")
            + _to_pdf_literal("POMME STUDIO  /  DOCUMENTO CONFIDENCIAL DE DISENO")
            + b" Tj ET"
        )
        ops.append(
            f"BT /F4 7.50 Tf 0.45 g {PAGE_WIDTH - MARGIN_X - 42:.2f} {footer_y:.2f} Td ".encode("ascii")
            + _to_pdf_literal(f"{page_idx:02d} / {total_pages:02d}")
            + b" Tj ET"
        )

    # Assemble PDF 1.4 objects
    # 1: Catalog, 2: Pages, 3..6: Fonts (F1=Helvetica, F2=Times-Bold, F3=Helvetica-Bold, F4=Courier)
    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"")  # placeholder for Pages
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")

    page_obj_refs: list[bytes] = []
    for ops in pages:
        stream_data = b"\n".join(ops)
        content_obj_num = len(objects) + 1
        objects.append(
            f"<< /Length {len(stream_data)} >>\nstream\n".encode("ascii")
            + stream_data
            + b"\nendstream"
        )
        page_obj_num = len(objects) + 1
        page_obj_refs.append(f"{page_obj_num} 0 R".encode("ascii"))
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> "
                f"/Contents {content_obj_num} 0 R >>"
            ).encode("ascii")
        )

    kids = b" ".join(page_obj_refs)
    objects[1] = f"<< /Type /Pages /Kids [ ".encode("ascii") + kids + f" ] /Count {len(page_obj_refs)} >>".encode("ascii")

    pdf_parts: list[bytes] = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
    offsets: list[int] = [0]
    current_offset = len(pdf_parts[0])
    for idx, obj in enumerate(objects, start=1):
        offsets.append(current_offset)
        chunk = f"{idx} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
        pdf_parts.append(chunk)
        current_offset += len(chunk)

    xref_offset = current_offset
    xref_lines = [f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")]
    for off in offsets[1:]:
        xref_lines.append(f"{off:010d} 00000 n \n".encode("ascii"))
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")

    return b"".join(pdf_parts + xref_lines + [trailer])
