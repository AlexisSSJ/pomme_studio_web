"use client";

import type { ReactElement } from "react";
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
 * forzado) y numeración mono. Un clic en la imagen selecciona la pieza
 * (el hilo de comentarios se abre en el panel compartido).
 */
function PieceFrame({
  projectId,
  item,
  index,
  selected,
  onSelect,
}: {
  projectId: string;
  item: MoodboardItemData;
  index: number;
  selected: boolean;
  onSelect?: (item: MoodboardItemData) => void;
}) {
  const { url, error } = useProtectedMedia(
    `/api/v1/projects/${projectId}/moodboard/items/${item.id}/file`
  );

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
          className="type-ui w-full border border-border bg-surface p-3 text-left text-sm"
        >
          Error al cargar la imagen
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(item)}
          aria-pressed={selected}
          aria-label={`Comentarios de ${item.title}`}
          className="label-mono w-full text-left text-stone-600"
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

function CollageGrid({
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
            selected={item.id === selectedItemId}
            onSelect={onSelect}
          />
        </div>
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
        <CollageGrid
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
