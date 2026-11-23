"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import {
  MoodboardComposition,
  type MoodboardItemData,
  type MoodboardLayout,
} from "@/components/MoodboardComposition";

interface MoodboardBoard {
  id: string;
  project_id: string;
  title: string;
  curatorial_note: string | null;
  layout_variant: MoodboardLayout;
  position: number;
  item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface MoodboardItem extends MoodboardItemData {
  project_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  created_by: string;
  created_at: string;
}

const MAX_BOARD_IMAGES = 10;

function boardNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export default function PortalMoodboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [boards, setBoards] = useState<MoodboardBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [message, setMessage] = useState("");
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  // La lista puede fallar sin que la lámina esté vacía: no confundir ambos estados.
  const [itemsFailed, setItemsFailed] = useState(false);
  // Descarta respuestas de una lámina ya abandonada al cambiar de pestaña.
  const itemsRequestRef = useRef(0);

  const activeBoard =
    boards.find((board) => board.id === activeBoardId) ?? null;

  const loadBoards = useCallback(async () => {
    if (!projectId) {
      setLoadingBoards(false);
      return;
    }
    setLoadingBoards(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards`
      );
      if (res.ok) {
        const data = (await res.json()) as MoodboardBoard[];
        setBoards(data);
        setActiveBoardId((prev) =>
          prev && data.some((board) => board.id === prev)
            ? prev
            : data[0]?.id ?? null
        );
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar los moodboards"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoadingBoards(false);
    }
  }, [projectId]);

  const loadItems = useCallback(async () => {
    const requestId = ++itemsRequestRef.current;
    if (!projectId || !activeBoardId) {
      setItems([]);
      setItemsFailed(false);
      setLoadingItems(false);
      return;
    }
    // Limpia el aviso anterior: una recarga correcta no debe arrastrarlo.
    setMessage("");
    setItemsFailed(false);
    setLoadingItems(true);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoardId}/items`
      );
      if (requestId !== itemsRequestRef.current) return;
      if (res.ok) {
        setItems(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las piezas"));
        setItemsFailed(true);
      }
    } catch {
      if (requestId === itemsRequestRef.current) {
        setMessage("Error de conexión con el servidor");
        setItemsFailed(true);
      }
    } finally {
      if (requestId === itemsRequestRef.current) {
        setLoadingItems(false);
      }
    }
  }, [projectId, activeBoardId]);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Al cambiar de lámina se descarta el contenido de la anterior.
  useEffect(() => {
    setItems([]);
  }, [activeBoardId]);

  return (
    <section>
      <h1 className="type-title text-xl">Moodboard</h1>

      {message && (
        <p className="type-ui mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {loadingBoards && boards.length === 0 ? (
        <p className="type-ui mt-4 text-sm">Cargando…</p>
      ) : boards.length === 0 ? (
        <p className="type-ui mt-4 text-sm">Todavía no hay moodboards.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {boards.map((board, index) => {
              const active = board.id === activeBoardId;
              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => setActiveBoardId(board.id)}
                  aria-pressed={active}
                  className={`btn-brutal min-h-[44px] shrink-0 px-3 text-xs ${
                    active ? "bg-foreground text-background" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="label-mono">{boardNumber(index)}</span>
                    {board.title}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Si la carga de piezas falló, el aviso de error de arriba es el
              estado honesto: no simular una lámina vacía. */}
          {activeBoard && !itemsFailed && (
            <>
              <p className="label-mono mt-4">
                {items.length} / {MAX_BOARD_IMAGES} IMÁGENES
              </p>

              <div className="mt-6">
                {loadingItems && items.length === 0 ? (
                  <p className="type-ui text-sm">Cargando piezas…</p>
                ) : (
                  <MoodboardComposition
                    layout={activeBoard.layout_variant}
                    projectId={projectId}
                    board={{
                      title: activeBoard.title,
                      curatorial_note: activeBoard.curatorial_note,
                    }}
                    items={items}
                  />
                )}

                {!loadingItems && items.length === 0 && (
                  <p className="type-ui mt-6 text-sm">
                    Todavía no hay piezas en este moodboard.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
