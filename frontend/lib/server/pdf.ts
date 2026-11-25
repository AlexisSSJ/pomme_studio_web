import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const COLOR_BG = rgb(0.976, 0.98, 0.957); // #F9FAF4
const COLOR_SURFACE = rgb(0.937, 0.925, 0.902); // #EFECE6
const COLOR_INK = rgb(0.067, 0.067, 0.067); // #111111
const COLOR_MUTED = rgb(0.35, 0.35, 0.35);

function sanitizeForWinAnsi(input: string): string {
  const replaced = input
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");

  let out = "";
  for (let i = 0; i < replaced.length; i++) {
    const code = replaced.charCodeAt(i);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += replaced[i];
    } else if (code === 9) {
      out += "  ";
    }
  }
  return out;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1$2");
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const clean = sanitizeForWinAnsi(text).trim();
  if (!clean) return [""];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        current = word;
      } else {
        // Break overly long token
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) <= maxWidth) {
            chunk += ch;
          } else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderBriefReportPdf(params: {
  projectTitle: string;
  clientLabel: string | null;
  scopeType: string | null;
  generatedAt: string | null;
  contentMarkdown: string;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Pomme Studio - Reporte Ejecutivo de Brief - ${params.projectTitle}`);
  pdfDoc.setAuthor("Pomme Studio");

  const fontSerif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontSerifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const pages: PDFPage[] = [];
  let y = 0;

  const startNewPage = (isFirst: boolean): PDFPage => {
    const currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(currentPage);

    currentPage.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: COLOR_BG,
    });

    if (isFirst) {
      y = PAGE_HEIGHT - MARGIN_TOP;
      // Top monochrome editorial header
      currentPage.drawText("POMME STUDIO", {
        x: MARGIN_X,
        y,
        size: 18,
        font: fontSerifBold,
        color: COLOR_INK,
      });
      currentPage.drawText("REPORTE EJECUTIVO DE BRIEF", {
        x: PAGE_WIDTH - MARGIN_X - fontMono.widthOfTextAtSize("REPORTE EJECUTIVO DE BRIEF", 8.5),
        y: y + 4,
        size: 8.5,
        font: fontMono,
        color: COLOR_MUTED,
      });

      y -= 10;
      currentPage.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_WIDTH - MARGIN_X, y },
        thickness: 1.2,
        color: COLOR_INK,
      });

      // Metadata grid card
      y -= 16;
      const boxHeight = 68;
      const boxBottom = y - boxHeight;
      currentPage.drawRectangle({
        x: MARGIN_X,
        y: boxBottom,
        width: CONTENT_WIDTH,
        height: boxHeight,
        color: COLOR_SURFACE,
        borderColor: COLOR_INK,
        borderWidth: 1,
      });

      const scopeMap: Record<string, string> = {
        branding: "BRANDING",
        interior: "DISENO DE INTERIORES",
        integral: "INTEGRAL (BRANDING + INTERIORES)",
      };
      const scopeLabel =
        (params.scopeType && scopeMap[params.scopeType]) ||
        (params.scopeType ? params.scopeType.toUpperCase() : "DISENO INTEGRAL");

      const dateText = params.generatedAt
        ? params.generatedAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const midX = MARGIN_X + CONTENT_WIDTH * 0.56;
      currentPage.drawText("PROYECTO", {
        x: MARGIN_X + 12,
        y: y - 16,
        size: 7.5,
        font: fontMono,
        color: COLOR_MUTED,
      });
      currentPage.drawText(sanitizeForWinAnsi(params.projectTitle).slice(0, 46), {
        x: MARGIN_X + 12,
        y: y - 30,
        size: 11,
        font: fontSansBold,
        color: COLOR_INK,
      });

      currentPage.drawText("CLIENTE", {
        x: MARGIN_X + 12,
        y: y - 47,
        size: 7.5,
        font: fontMono,
        color: COLOR_MUTED,
      });
      currentPage.drawText(
        sanitizeForWinAnsi(params.clientLabel || "Sin asignar").slice(0, 48),
        {
          x: MARGIN_X + 12,
          y: y - 59,
          size: 9.5,
          font: fontSans,
          color: COLOR_INK,
        }
      );

      currentPage.drawLine({
        start: { x: midX - 10, y },
        end: { x: midX - 10, y: boxBottom },
        thickness: 0.75,
        color: COLOR_INK,
      });

      currentPage.drawText("ALCANCE", {
        x: midX,
        y: y - 16,
        size: 7.5,
        font: fontMono,
        color: COLOR_MUTED,
      });
      currentPage.drawText(sanitizeForWinAnsi(scopeLabel).slice(0, 34), {
        x: midX,
        y: y - 30,
        size: 9.5,
        font: fontSansBold,
        color: COLOR_INK,
      });

      currentPage.drawText("FECHA DE EMISION", {
        x: midX,
        y: y - 47,
        size: 7.5,
        font: fontMono,
        color: COLOR_MUTED,
      });
      currentPage.drawText(sanitizeForWinAnsi(dateText), {
        x: midX,
        y: y - 59,
        size: 9.5,
        font: fontMono,
        color: COLOR_INK,
      });

      y = boxBottom - 24;
    } else {
      y = PAGE_HEIGHT - MARGIN_TOP;
      currentPage.drawText("POMME STUDIO // REPORTE DE BRIEF", {
        x: MARGIN_X,
        y,
        size: 8,
        font: fontMono,
        color: COLOR_MUTED,
      });
      y -= 8;
      currentPage.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_WIDTH - MARGIN_X, y },
        thickness: 0.6,
        color: COLOR_INK,
      });
      y -= 20;
    }

    return currentPage;
  };

  let page: PDFPage = startNewPage(true);

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN_BOTTOM + 20) {
      page = startNewPage(false);
    }
  };

  const rawLines = params.contentMarkdown.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y -= 7;
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      ensureSpace(14);
      y -= 4;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_WIDTH - MARGIN_X, y },
        thickness: 0.6,
        color: COLOR_INK,
      });
      y -= 10;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      const heading = stripInlineMarkdown(trimmed.slice(2).trim());
      const wrapped = wrapText(heading, fontSerifBold, 16, CONTENT_WIDTH);
      ensureSpace(wrapped.length * 20 + 10);
      y -= 4;
      for (const line of wrapped) {
        page.drawText(line, {
          x: MARGIN_X,
          y,
          size: 16,
          font: fontSerifBold,
          color: COLOR_INK,
        });
        y -= 20;
      }
      y -= 4;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      const heading = stripInlineMarkdown(trimmed.slice(3).trim()).toUpperCase();
      const wrapped = wrapText(heading, fontSansBold, 11.5, CONTENT_WIDTH);
      ensureSpace(wrapped.length * 16 + 18);
      y -= 10;
      for (const line of wrapped) {
        page.drawText(line, {
          x: MARGIN_X,
          y,
          size: 11.5,
          font: fontSansBold,
          color: COLOR_INK,
        });
        y -= 15;
      }
      page.drawLine({
        start: { x: MARGIN_X, y: y + 10 },
        end: { x: PAGE_WIDTH - MARGIN_X, y: y + 10 },
        thickness: 0.75,
        color: COLOR_INK,
      });
      y -= 4;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      const heading = stripInlineMarkdown(trimmed.slice(4).trim());
      const wrapped = wrapText(heading, fontSansBold, 10.5, CONTENT_WIDTH);
      ensureSpace(wrapped.length * 14 + 10);
      y -= 6;
      for (const line of wrapped) {
        page.drawText(line, {
          x: MARGIN_X,
          y,
          size: 10.5,
          font: fontSansBold,
          color: COLOR_INK,
        });
        y -= 14;
      }
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quote = stripInlineMarkdown(trimmed.slice(2).trim());
      const wrapped = wrapText(quote, fontSerif, 10, CONTENT_WIDTH - 16);
      const blockHeight = wrapped.length * 14 + 4;
      ensureSpace(blockHeight + 6);
      const topY = y + 9;
      for (const line of wrapped) {
        page.drawText(line, {
          x: MARGIN_X + 14,
          y,
          size: 10,
          font: fontSerif,
          color: COLOR_MUTED,
        });
        y -= 14;
      }
      page.drawLine({
        start: { x: MARGIN_X + 4, y: topY },
        end: { x: MARGIN_X + 4, y: y + 10 },
        thickness: 1.5,
        color: COLOR_INK,
      });
      y -= 4;
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s+(.*)$/);
    if (bulletMatch) {
      const itemText = stripInlineMarkdown(bulletMatch[1]);
      const wrapped = wrapText(itemText, fontSans, 9.8, CONTENT_WIDTH - 16);
      ensureSpace(wrapped.length * 13.5 + 4);
      wrapped.forEach((line, idx) => {
        if (idx === 0) {
          page.drawText("-", {
            x: MARGIN_X + 4,
            y,
            size: 9.8,
            font: fontMono,
            color: COLOR_INK,
          });
        }
        page.drawText(line, {
          x: MARGIN_X + 16,
          y,
          size: 9.8,
          font: fontSans,
          color: COLOR_INK,
        });
        y -= 13.5;
      });
      y -= 2;
      continue;
    }

    const paragraph = stripInlineMarkdown(trimmed);
    const wrapped = wrapText(paragraph, fontSans, 10, CONTENT_WIDTH);
    ensureSpace(wrapped.length * 14 + 4);
    for (const line of wrapped) {
      page.drawText(line, {
        x: MARGIN_X,
        y,
        size: 10,
        font: fontSans,
        color: COLOR_INK,
      });
      y -= 14;
    }
    y -= 3;
  }

  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    const footerY = 30;
    p.drawLine({
      start: { x: MARGIN_X, y: footerY + 12 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: footerY + 12 },
      thickness: 0.5,
      color: COLOR_INK,
    });
    p.drawText("POMME STUDIO - DOCUMENTO CONFIDENCIAL DE DIRECCION CREATIVA", {
      x: MARGIN_X,
      y: footerY,
      size: 7.5,
      font: fontMono,
      color: COLOR_MUTED,
    });
    const pageLabel = `${String(idx + 1).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`;
    p.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - fontMono.widthOfTextAtSize(pageLabel, 8),
      y: footerY,
      size: 8,
      font: fontMono,
      color: COLOR_INK,
    });
  });

  return pdfDoc.save();
}
