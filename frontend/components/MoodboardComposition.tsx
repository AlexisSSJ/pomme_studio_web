"use client";

import { useState, type ReactElement, type ReactNode } from "react";
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
  like_count: number;
  dislike_count: number;
  comment_count: number;
}

// Ciclo de anchos de la retícula de 12 columnas: cada par suma 12.
const COLLAGE_SPANS = [7, 5, 4, 8, 6, 6, 5, 7, 8, 4];

const COLLAGE_SPAN_CLASSES: Record<number, string> = {
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
};

function pieceNumber(index: number): string {
  return `${String(index + 1).padStart(2, "0")}.`;
}

/**
 * Lámina limpia: imagen a tamaño natural (sin bordes ni aspect-ratio
 * forzado), numeración mono, título y nota. El overlay replica el visor
 * existente con "Cerrar" y zoom táctil.
 */
function PieceFrame({
  projectId,
  item,
  index,
  footer,
}: {
  projectId: string;
  item: MoodboardItemData;
  index: number;
  footer: ReactNode;
}) {
  const { url, error } = useProtectedMedia(
    `/api/v1/projects/${projectId}/moodboard/items/${item.id}/file`
  );
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <figure className="flex flex-col gap-3">
      {url ? (
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          aria-label={`Ampliar ${item.title}`}
          className="block w-full"
        >
          <img
            src={url}
            alt={item.title}
            className="block h-auto w-full"
          />
        </button>
      ) : error ? (
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          Error al cargar la imagen
        </p>
      ) : (
        <p className="label-mono text-stone-600">Cargando imagen…</p>
      )}

      <figcaption className="flex flex-col gap-2">
        <p className="label-mono">{pieceNumber(index)}</p>
        <p className="type-ui text-base font-semibold">{item.title}</p>
        {item.description && (
          <p className="type-editorial text-sm">{item.description}</p>
        )}
        {footer}
      </figcaption>

      {overlayOpen && url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
          className="fixed inset-0 z-50 flex flex-col bg-background"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="type-ui truncate text-sm">{item.title}</p>
            <button
              type="button"
              onClick={() => setOverlayOpen(false)}
              className="btn-brutal min-h-[44px] px-3 text-xs"
            >
              Cerrar
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={url}
              alt={item.title}
              className="max-h-full max-w-full object-contain"
              style={{ touchAction: "pinch-zoom" }}
            />
          </div>
        </div>
      )}
    </figure>
  );
}

function CollageGrid({
  projectId,
  items,
  renderFooter,
}: {
  projectId: string;
  items: MoodboardItemData[];
  renderFooter: (item: MoodboardItemData, index: number) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={
            COLLAGE_SPAN_CLASSES[
              COLLAGE_SPANS[index % COLLAGE_SPANS.length]
            ]
          }
        >
          <PieceFrame
            projectId={projectId}
            item={item}
            index={index}
            footer={renderFooter(item, index)}
          />
        </div>
      ))}
    </div>
  );
}

function AtelierGrid({
  projectId,
  items,
  renderFooter,
}: {
  projectId: string;
  items: MoodboardItemData[];
  renderFooter: (item: MoodboardItemData, index: number) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <PieceFrame
          key={item.id}
          projectId={projectId}
          item={item}
          index={index}
          footer={renderFooter(item, index)}
        />
      ))}
    </div>
  );
}

function MonographStrip({
  projectId,
  items,
  renderFooter,
}: {
  projectId: string;
  items: MoodboardItemData[];
  renderFooter: (item: MoodboardItemData, index: number) => ReactNode;
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
          footer={renderFooter(feature, 0)}
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
                  footer={renderFooter(item, index)}
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
 * lámina + piezas según el layout editorial elegido.
 */
export function MoodboardComposition({
  layout,
  projectId,
  board,
  items,
  renderFooter,
}: {
  layout: MoodboardLayout;
  projectId: string;
  board: { title: string; curatorial_note: string | null };
  items: MoodboardItemData[];
  renderFooter: (item: MoodboardItemData, index: number) => ReactNode;
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
        <CollageGrid
          projectId={projectId}
          items={items}
          renderFooter={renderFooter}
        />
      ) : layout === "atelier_grid" ? (
        <AtelierGrid
          projectId={projectId}
          items={items}
          renderFooter={renderFooter}
        />
      ) : (
        <MonographStrip
          projectId={projectId}
          items={items}
          renderFooter={renderFooter}
        />
      )}
    </div>
  );
}
