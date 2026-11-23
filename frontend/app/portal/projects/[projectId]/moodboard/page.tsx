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
  my_reaction: "like" | "dislike" | "comment" | null;
  my_comment: string | null;
}

const MAX_BOARD_IMAGES = 10;

function boardNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Pie de pieza del portal: conteos públicos y controles de reacción del
 * cliente (me gusta / no me gusta / comentar / quitar), sin acciones de
 * equipo.
 */
function MoodboardReactionFooter({
  projectId,
  item,
  onChanged,
}: {
  projectId: string;
  item: MoodboardItem;
  onChanged: () => void;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function react(reaction: "like" | "dislike") {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}/reactions`,
        { method: "POST", body: JSON.stringify({ reaction }) }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFeedback(extractDetail(data, "Error al guardar la reacción"));
      }
    } catch {
      setFeedback("Error de conexión con el servidor");
    } finally {
      setBusy(false);
    }
  }

  async function sendComment() {
    if (busy) return;
    if (!comment.trim()) {
      setFeedback("El comentario no puede estar vacío");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}/reactions`,
        {
          method: "POST",
          body: JSON.stringify({ reaction: "comment", comment: comment.trim() }),
        }
      );
      if (res.ok) {
        setCommentOpen(false);
        setComment("");
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFeedback(extractDetail(data, "Error al enviar el comentario"));
      }
    } catch {
      setFeedback("Error de conexión con el servidor");
    } finally {
      setBusy(false);
    }
  }

  async function removeReaction() {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}/reactions`,
        { method: "DELETE" }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFeedback(extractDetail(data, "Error al quitar la reacción"));
      }
    } catch {
      setFeedback("Error de conexión con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="label-mono">
        {item.like_count} ME GUSTA · {item.dislike_count} NO ·{" "}
        {item.comment_count} COMENTARIOS
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => react("like")}
          disabled={busy}
          aria-pressed={item.my_reaction === "like"}
          className={`btn-brutal min-h-[44px] min-w-[44px] justify-center px-3 text-xs ${
            item.my_reaction === "like" ? "bg-foreground text-background" : ""
          }`}
        >
          Me gusta
        </button>
        <button
          type="button"
          onClick={() => react("dislike")}
          disabled={busy}
          aria-pressed={item.my_reaction === "dislike"}
          className={`btn-brutal min-h-[44px] min-w-[44px] justify-center px-3 text-xs ${
            item.my_reaction === "dislike"
              ? "bg-foreground text-background"
              : ""
          }`}
        >
          No me gusta
        </button>
        <button
          type="button"
          onClick={() => {
            setCommentOpen((open) => !open);
            setComment(
              item.my_reaction === "comment" ? item.my_comment ?? "" : ""
            );
            setFeedback("");
          }}
          disabled={busy}
          aria-pressed={commentOpen}
          className="btn-brutal min-h-[44px] px-3 text-xs"
        >
          Comentar
        </button>
        {item.my_reaction && (
          <button
            type="button"
            onClick={removeReaction}
            disabled={busy}
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Quitar reacción
          </button>
        )}
      </div>

      {item.my_reaction === "comment" && item.my_comment && !commentOpen && (
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          Tu comentario: {item.my_comment}
        </p>
      )}

      {commentOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            placeholder="Escribe tu comentario"
            className="type-ui min-h-[44px] border border-border bg-background p-3 text-sm"
          />
          <button
            type="button"
            onClick={sendComment}
            disabled={busy}
            className="btn-brutal min-h-[44px] self-start px-3 text-xs"
          >
            {busy ? "Enviando…" : "Enviar comentario"}
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      )}

      {feedback && (
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          {feedback}
        </p>
      )}
    </div>
  );
}

export default function PortalMoodboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [boards, setBoards] = useState<MoodboardBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [message, setMessage] = useState("");
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  // Descarta respuestas de una lámina ya abandonada al cambiar de pestaña.
  const itemsRequestRef = useRef(0);

  const activeBoard =
    boards.find((board) => board.id === activeBoardId) ?? null;

  const loadBoards = useCallback(async () => {
    if (!projectId) return;
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
      setLoadingItems(false);
      return;
    }
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
      }
    } catch {
      if (requestId === itemsRequestRef.current) {
        setMessage("Error de conexión con el servidor");
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

  // La composición tipa las piezas como `MoodboardItemData`; el pie de
  // reacciones necesita además los campos propios del listado.
  const itemsById = new Map(items.map((item) => [item.id, item]));

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

          {activeBoard && (
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
                    renderFooter={(piece) => {
                      const item = itemsById.get(piece.id);
                      if (!item) return null;
                      return (
                        <MoodboardReactionFooter
                          projectId={projectId}
                          item={item}
                          onChanged={loadItems}
                        />
                      );
                    }}
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
