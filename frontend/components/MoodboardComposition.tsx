"use client";

import type { CSSProperties, ReactElement } from "react";
import { useProtectedMedia } from "@/lib/useProtectedMediaUrl";

export type MoodboardLayout =
  | "editorial_collage"
  | "atelier_grid"
  | "monograph_strip";

export interface MoodboardItemData {
  id: string;
  moodboard_id: string | null;
  title: string;
  description: string | null;
  comment_count: number;
  latest_comment: string | null;
}

function pieceNumber(index: number): string {
  return `${String(index + 1).padStart(2, "0")}.`;
}

/**
 * Lámina limpia: imagen a tamaño natural (sin bordes ni aspect-ratio
 * forzado) y numeración mono. Un clic en la imagen selecciona la pieza
 * (el hilo de comentarios se abre en el panel compartido).
 *
 * `embedded` la reutiliza dentro de un slot de la lámina anotada: allí el
 * slot completo es un único `<button>` (imagen + anotación + línea guía),
 * así que la imagen, sus estados de error/carga y la numeración pierden su
 * propio botón y su `figcaption`.
 */
function PieceFrame({
  projectId,
  item,
  index = 0,
  selected,
  onSelect,
  embedded = false,
}: {
  projectId: string;
  item: MoodboardItemData;
  index?: number;
  selected: boolean;
  onSelect?: (item: MoodboardItemData) => void;
  embedded?: boolean;
}) {
  const { url, error } = useProtectedMedia(
    `/api/v1/projects/${projectId}/moodboard/items/${item.id}/file`
  );

  if (embedded) {
    return (
      <span className="block h-full w-full">
        {url ? (
          <img
            src={url}
            alt={item.title}
            className="block h-auto w-full md:h-full md:object-cover"
          />
        ) : (
          <span className="label-mono flex h-full min-h-[44px] w-full items-center border border-border bg-surface p-3 text-stone-600">
            {error ? "Error al cargar la imagen" : "Cargando imagen…"}
          </span>
        )}
      </span>
    );
  }

  return (
    <figure
      className={`flex flex-col gap-2 ${
        selected ? "outline outline-2 outline-foreground" : ""
      }`}
    >
      {url ? (
        <button
          type="button"
          onClick={() => onSelect?.(item)}
          aria-pressed={selected}
          aria-label={`Comentarios de ${item.title}`}
          className="block w-full"
        >
          <img src={url} alt={item.title} className="block h-auto w-full" />
        </button>
      ) : error ? (
        <button
          type="button"
          onClick={() => onSelect?.(item)}
          aria-pressed={selected}
          aria-label={`Comentarios de ${item.title}`}
          className="type-ui min-h-[44px] w-full border border-border bg-surface p-3 text-left text-sm"
        >
          Error al cargar la imagen
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(item)}
          aria-pressed={selected}
          aria-label={`Comentarios de ${item.title}`}
          className="label-mono min-h-[44px] w-full text-left text-stone-600"
        >
          Cargando imagen…
        </button>
      )}

      <figcaption className="flex flex-col gap-2">
        <p className="label-mono">{pieceNumber(index)}</p>
      </figcaption>
    </figure>
  );
}

interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type AnnotationSide = "top" | "bottom" | "right";

interface SheetSlot {
  /** Rect de la imagen en % del lienzo 3:2. */
  rect: SheetRect;
  side: AnnotationSide;
  /**
   * Hueco reservado en % para la anotación (8). La caja real es de altura
   * automática (2 líneas como máximo, recortadas con elipsis); este valor
   * solo define el hueco libre que la geometría garantiza. La guía
   * horizontal del lado `right` NO se ancla a la mitad de este hueco: engancha
   * la primera línea de la caja (ver `sheetLeaderRect` / `AnnotatedSlot`).
   */
  captionReserve: number;
}

/**
 * Tabla maestra de slots (x, y, w, h en % de un lienzo 3:2) con el lado de
 * su anotación. Los primeros N slots se usan tal cual (spread-first) y los
 * rects de imagen son disjuntos para N=1..10 (el backend limita a 10).
 *
 * Ajustes ±3% sobre el borrador del plan. El primero reserva hueco para que
 * cada caja de anotación (8% ≈ dos líneas de 12px) no pise ninguna imagen:
 * - slot 01: y 10→9, h 28→27 — deja el hueco 0–8% para su nota.
 * - slot 03: x 32→34, y 40→43 — su nota quedaba encima de la 01 y la 05.
 * - slot 04: y 44→46, h 38→36 — abre el hueco 37–45% bajo la 01.
 * - slot 05: y 8→9, h 26→24 — abre el hueco 0–8% arriba y libera el 34–42%.
 * - slot 07: y 60→58 — deja 90–98% para su nota, sin tocar el borde.
 * - slot 08: y 78→79 — su nota cae en 70–78%, bajo la 03.
 * - slot 10: y 90→92, h 8→7 — abre 83–91% bajo la 04.
 */
const SHEET_SLOTS: SheetSlot[] = [
  { rect: { x: 10, y: 9, w: 24, h: 27 }, side: "top", captionReserve: 8 },
  { rect: { x: 56, y: 6, w: 22, h: 50 }, side: "right", captionReserve: 8 },
  { rect: { x: 34, y: 43, w: 20, h: 26 }, side: "top", captionReserve: 8 },
  { rect: { x: 6, y: 46, w: 20, h: 36 }, side: "top", captionReserve: 8 },
  { rect: { x: 36, y: 9, w: 14, h: 24 }, side: "top", captionReserve: 8 },
  { rect: { x: 56, y: 62, w: 18, h: 24 }, side: "bottom", captionReserve: 8 },
  { rect: { x: 78, y: 58, w: 18, h: 30 }, side: "bottom", captionReserve: 8 },
  { rect: { x: 30, y: 79, w: 22, h: 16 }, side: "top", captionReserve: 8 },
  { rect: { x: 82, y: 24, w: 14, h: 32 }, side: "top", captionReserve: 8 },
  { rect: { x: 8, y: 92, w: 18, h: 7 }, side: "top", captionReserve: 8 },
];

/** Lámina de una sola pieza: pieza centrada y anotación al pie. */
const SINGLE_SHEET_SLOT: SheetSlot = {
  rect: { x: 30, y: 20, w: 40, h: 60 },
  side: "bottom",
  captionReserve: 8,
};

/**
 * Hueco de la anotación según el lado: mismo ancho y misma x que la imagen
 * en top/bottom (dentro del hueco vertical reservado); a la derecha de la
 * imagen (2% de separación) en right. La caja real se dibuja de altura
 * automática dentro de este hueco.
 */
function sheetCaptionRect(slot: SheetSlot): SheetRect {
  const { rect, side, captionReserve } = slot;

  if (side === "right") {
    const x = rect.x + rect.w + 2;
    return { x, y: rect.y, w: Math.min(18, 100 - x), h: captionReserve };
  }

  if (side === "top") {
    return {
      x: rect.x,
      y: rect.y - captionReserve - 1,
      w: rect.w,
      h: captionReserve,
    };
  }

  return {
    x: rect.x,
    y: rect.y + rect.h + 2,
    w: rect.w,
    h: captionReserve,
  };
}

/**
 * Línea guía de 1px: vertical (top/bottom) desde el borde de la caja al
 * borde de la imagen, u horizontal (right) desde la imagen a la caja.
 * El rect devuelto es el hueco a cruzar; su eje corto vale 0.
 *
 * La guía horizontal se ancla al borde SUPERIOR de la caja (`caption.y`):
 * la caja tiene altura de contenido y la primera línea arranca ahí, así que
 * el medio line-box que la centra se suma al publicar `--lead-y`
 * (ver `AnnotatedSlot`), no aquí, donde el alto de la reserva no interviene.
 */
function sheetLeaderRect(slot: SheetSlot, caption: SheetRect): SheetRect {
  const { rect, side } = slot;

  if (side === "right") {
    return {
      x: rect.x + rect.w,
      y: caption.y,
      w: caption.x - (rect.x + rect.w),
      h: 0,
    };
  }

  if (side === "top") {
    return {
      x: caption.x + caption.w / 2,
      y: caption.y + caption.h,
      w: 0,
      h: rect.y - (caption.y + caption.h),
    };
  }

  return {
    x: caption.x + caption.w / 2,
    y: rect.y + rect.h,
    w: 0,
    h: caption.y - (rect.y + rect.h),
  };
}

/** Rect que contiene imagen y anotación: el botón-slot completo. */
function sheetUnion(a: SheetRect, b: SheetRect): SheetRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

type SheetStyle = CSSProperties & Record<string, string>;

function pct(value: number, total: number): string {
  return `${Number(((value / total) * 100).toFixed(3))}%`;
}

/**
 * Posición de un rect hijo (en % del lienzo) expresada en % del rect padre.
 * Se publica como variables CSS porque en móvil la misma pieza fluye en
 * columna y solo a partir de md se posiciona en absoluto sobre el lienzo.
 */
function sheetVars(
  prefix: string,
  child: SheetRect,
  base: SheetRect
): Record<string, string> {
  return {
    [`--${prefix}-x`]: pct(child.x - base.x, base.w),
    [`--${prefix}-y`]: pct(child.y - base.y, base.h),
    [`--${prefix}-w`]: pct(child.w, base.w),
    [`--${prefix}-h`]: pct(child.h, base.h),
  };
}

/**
 * Line-box de la anotación: `text-[11px]` × `leading-snug` (1.375) = 15.125px.
 * Su mitad centra la guía horizontal en la PRIMERA línea del texto, que es
 * la única que siempre existe (la caja mide 1 o 2 líneas según el comentario).
 */
const CAPTION_LINE_BOX_PX = 11 * 1.375;

/**
 * Slot de la lámina anotada: un único `<button>` (imagen + anotación +
 * línea guía) que selecciona la pieza. La anotación es el último comentario
 * de la pieza; sin comentarios no hay caja ni línea y la pieza queda limpia.
 */
function AnnotatedSlot({
  projectId,
  item,
  slot,
  selected,
  onSelect,
}: {
  projectId: string;
  item: MoodboardItemData;
  slot: SheetSlot;
  selected: boolean;
  onSelect?: (item: MoodboardItemData) => void;
}) {
  const caption = item.latest_comment?.trim() ?? "";
  const captionRect = sheetCaptionRect(slot);
  const leaderRect = sheetLeaderRect(slot, captionRect);
  const base = caption ? sheetUnion(slot.rect, captionRect) : slot.rect;
  // Las cajas crecen SIEMPRE hacia el hueco libre: la de arriba se ancla por
  // su borde inferior (a 1% de la imagen) y crece hacia arriba; las demás por
  // su borde superior. Así una nota larga nunca invade su propia imagen.
  const growsUpward = slot.side === "top";

  const style: SheetStyle = {
    "--slot-x": pct(base.x, 100),
    "--slot-y": pct(base.y, 100),
    "--slot-w": pct(base.w, 100),
    "--slot-h": pct(base.h, 100),
    ...sheetVars("media", slot.rect, base),
    "--cap-x": pct(captionRect.x - base.x, base.w),
    "--cap-w": pct(captionRect.w, base.w),
    "--cap-top": growsUpward ? "auto" : pct(captionRect.y - base.y, base.h),
    "--cap-bottom": growsUpward
      ? pct(base.y + base.h - (captionRect.y + captionRect.h), base.h)
      : "auto",
    ...sheetVars("lead", leaderRect, base),
    // La guía horizontal (`right`) engancha el centro de la primera línea de
    // la nota: `--cap-top` (borde superior de la caja, que es de altura de
    // contenido) + medio line-box. Así el tick toca el texto tanto con una
    // como con dos líneas, en cualquier alto de lienzo.
    ...(slot.side === "right"
      ? { "--lead-y": `calc(var(--cap-top) + ${CAPTION_LINE_BOX_PX / 2}px)` }
      : {}),
  };

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      aria-pressed={selected}
      aria-label={
        caption
          ? `Comentarios de ${item.title}: ${caption}`
          : `Comentarios de ${item.title}`
      }
      style={style}
      className="flex w-full flex-col gap-2 text-left md:absolute md:left-[var(--slot-x)] md:top-[var(--slot-y)] md:h-[var(--slot-h)] md:w-[var(--slot-w)] md:gap-0"
    >
      {caption && (
        <>
          <span className="type-editorial w-full text-[11px] italic leading-snug line-clamp-2 md:absolute md:left-[var(--cap-x)] md:top-[var(--cap-top)] md:bottom-[var(--cap-bottom)] md:w-[var(--cap-w)] md:overflow-hidden">
            {caption}
          </span>
          <span
            aria-hidden="true"
            className={`hidden bg-foreground md:absolute md:left-[var(--lead-x)] md:top-[var(--lead-y)] ${
              leaderRect.w === 0
                ? "md:block md:h-[var(--lead-h)] md:w-px"
                : "md:block md:h-px md:w-[var(--lead-w)]"
            }`}
          />
        </>
      )}

      <span
        className={`relative w-full overflow-hidden md:absolute md:left-[var(--media-x)] md:top-[var(--media-y)] md:h-[var(--media-h)] md:w-[var(--media-w)] ${
          selected ? "outline outline-2 outline-foreground" : ""
        }`}
      >
        <PieceFrame
          projectId={projectId}
          item={item}
          selected={selected}
          embedded
        />
      </span>
    </button>
  );
}

/**
 * Lámina editorial anotada (estilo referencia VEER): collage orgánico sobre
 * un lienzo 3:2 con imágenes de tamaños variados, cada una acompañada del
 * último comentario en serif itálica y una línea guía de 1px. En móvil las
 * piezas se apilan en una columna con la anotación en línea sobre la imagen.
 */
function AnnotatedSheet({
  projectId,
  items,
  selectedItemId,
  onSelect,
}: {
  projectId: string;
  items: MoodboardItemData[];
  selectedItemId?: string | null;
  onSelect?: (item: MoodboardItemData) => void;
}) {
  const slots = items.length === 1 ? [SINGLE_SHEET_SLOT] : SHEET_SLOTS;

  return (
    <div className="grid grid-cols-1 gap-6 md:relative md:block md:aspect-[3/2] md:w-full">
      {items.map((item, index) => (
        <AnnotatedSlot
          key={item.id}
          projectId={projectId}
          item={item}
          slot={slots[index] ?? SHEET_SLOTS[index % SHEET_SLOTS.length]}
          selected={item.id === selectedItemId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function AtelierGrid({
  projectId,
  items,
  selectedItemId,
  onSelect,
}: {
  projectId: string;
  items: MoodboardItemData[];
  selectedItemId?: string | null;
  onSelect?: (item: MoodboardItemData) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <PieceFrame
          key={item.id}
          projectId={projectId}
          item={item}
          index={index}
          selected={item.id === selectedItemId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function MonographStrip({
  projectId,
  items,
  selectedItemId,
  onSelect,
}: {
  projectId: string;
  items: MoodboardItemData[];
  selectedItemId?: string | null;
  onSelect?: (item: MoodboardItemData) => void;
}) {
  const [feature, ...rest] = items;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="label-mono mb-3">IMAGEN PRINCIPAL</p>
        <PieceFrame
          projectId={projectId}
          item={feature}
          index={0}
          selected={feature.id === selectedItemId}
          onSelect={onSelect}
        />
      </div>

      {rest.length > 0 && (
        <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
          {rest.map((item, offset) => {
            const index = offset + 1;
            return (
              <div
                key={item.id}
                className="w-[85%] shrink-0 snap-start sm:w-[60%] lg:w-auto"
              >
                <PieceFrame
                  projectId={projectId}
                  item={item}
                  index={index}
                  selected={item.id === selectedItemId}
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Composición compartida del moodboard (admin y portal): cabecera de
 * lámina + piezas según el layout editorial elegido. La selección de una
 * pieza la resuelve el consumidor (panel de comentarios compartido).
 */
export function MoodboardComposition({
  layout,
  projectId,
  board,
  items,
  selectedItemId,
  onSelect,
}: {
  layout: MoodboardLayout;
  projectId: string;
  board: { title: string; curatorial_note: string | null };
  items: MoodboardItemData[];
  selectedItemId?: string | null;
  onSelect?: (item: MoodboardItemData) => void;
}): ReactElement {
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3">
        <p className="label-mono">MOODBOARD — POMME STUDIO</p>
        <h2 className="type-title text-3xl md:text-5xl">{board.title}</h2>
        {board.curatorial_note && (
          <p className="type-editorial max-w-prose text-base md:text-lg">
            {board.curatorial_note}
          </p>
        )}
      </header>

      <div className="rule my-6 md:my-8" />

      {items.length === 0 ? null : layout === "editorial_collage" ? (
        <AnnotatedSheet
          projectId={projectId}
          items={items}
          selectedItemId={selectedItemId}
          onSelect={onSelect}
        />
      ) : layout === "atelier_grid" ? (
        <AtelierGrid
          projectId={projectId}
          items={items}
          selectedItemId={selectedItemId}
          onSelect={onSelect}
        />
      ) : (
        <MonographStrip
          projectId={projectId}
          items={items}
          selectedItemId={selectedItemId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
