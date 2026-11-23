"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

interface MoodboardItem {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  created_by: string;
  created_at: string;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  my_reaction: "like" | "dislike" | "comment" | null;
  my_comment: string | null;
}

function MoodboardPiece({
  projectId,
  item,
  onChanged,
}: {
  projectId: string;
  item: MoodboardItem;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const filePath = `/api/v1/projects/${projectId}/moodboard/items/${item.id}/file`;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    apiFetchBlobUrl(filePath)
      .then((created) => {
        if (!active) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
      .catch((error: unknown) => {
        if (active) {
          setImageError(
            error instanceof Error
              ? error.message
              : "Error al cargar la imagen"
          );
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath]);

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
    <article className="flex flex-col gap-3 p-4">
      {url ? (
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          aria-label={`Ampliar ${item.title}`}
          className="block w-full"
        >
          <img src={url} alt={item.title} className="w-full" />
        </button>
      ) : imageError ? (
        <p className="border border-border bg-surface p-3 text-sm">
          {imageError}
        </p>
      ) : (
        <p className="type-ui text-xs text-foreground/60">Cargando imagen…</p>
      )}

      <div>
        <p className="text-sm font-semibold">{item.title}</p>
        {item.description && (
          <p className="type-editorial mt-1 text-sm">{item.description}</p>
        )}
      </div>

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
        <p className="border border-border bg-surface p-3 text-sm">
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
            className="min-h-[44px] border border-border bg-background p-3 text-sm"
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
        <p className="border border-border bg-surface p-3 text-sm">{feedback}</p>
      )}

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
    </article>
  );
}

export default function MoodboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard`
      );
      if (res.ok) {
        setItems(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el moodboard"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  return (
    <section>
      <h1 className="type-title text-xl">Moodboard</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm">
          Todavía no hay piezas en el moodboard.
        </p>
      ) : (
        <div className="grid-brutal grid-brutal--2 mt-4">
          {items.map((item) => (
            <MoodboardPiece
              key={item.id}
              projectId={projectId}
              item={item}
              onChanged={loadItems}
            />
          ))}
        </div>
      )}
    </section>
  );
}
