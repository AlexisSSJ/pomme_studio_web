"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

interface MoodboardItem {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  created_at: string;
  like_count: number;
  dislike_count: number;
  comment_count: number;
}

interface MoodboardReaction {
  id: string;
  moodboard_item_id: string;
  user_id: string;
  reaction: "like" | "dislike" | "comment";
  comment: string | null;
  created_at: string;
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

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactions, setReactions] = useState<MoodboardReaction[] | null>(null);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionsMessage, setReactionsMessage] = useState("");

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

  async function removePiece() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setDeleting(true);
    setFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFeedback(extractDetail(data, "Error al eliminar la pieza"));
        setConfirmingDelete(false);
      }
    } catch {
      setFeedback("Error de conexión con el servidor");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function toggleComments() {
    if (commentsOpen) {
      setCommentsOpen(false);
      return;
    }

    setCommentsOpen(true);
    setLoadingReactions(true);
    setReactionsMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}/reactions`
      );
      if (res.ok) {
        setReactions(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setReactionsMessage(
          extractDetail(data, "Error al cargar los comentarios")
        );
      }
    } catch {
      setReactionsMessage("Error de conexión con el servidor");
    } finally {
      setLoadingReactions(false);
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
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          {imageError}
        </p>
      ) : (
        <p className="type-ui text-sm text-stone-600">Cargando imagen…</p>
      )}

      <div>
        <p className="type-ui text-sm font-semibold">{item.title}</p>
        {item.description && <p className="type-editorial mt-1 text-sm">{item.description}</p>}
      </div>

      <p className="label-mono">
        {item.like_count} ME GUSTA · {item.dislike_count} NO ·{" "}
        {item.comment_count} COMENTARIOS
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={removePiece}
          disabled={deleting}
          className="btn-brutal min-h-[44px] px-3 text-xs"
        >
          {deleting
            ? "Eliminando…"
            : confirmingDelete
              ? "Confirmar eliminación"
              : "Eliminar"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        <button
          type="button"
          onClick={toggleComments}
          aria-expanded={commentsOpen}
          className="btn-brutal min-h-[44px] px-3 text-xs"
        >
          Comentarios
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </div>

      {feedback && (
        <p className="type-ui border border-border bg-surface p-3 text-sm">{feedback}</p>
      )}

      {commentsOpen && (
        <div className="flex flex-col gap-2">
          {loadingReactions ? (
            <p className="type-ui text-sm">Cargando…</p>
          ) : reactionsMessage ? (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {reactionsMessage}
            </p>
          ) : reactions !== null && reactions.length === 0 ? (
            <p className="type-ui text-sm">Todavía no hay reacciones.</p>
          ) : (
            reactions?.map((reaction) => (
              <div
                key={reaction.id}
                className="flex flex-col gap-1 border border-border bg-background p-3"
              >
                <p className="label-mono">
                  {reaction.reaction} ·{" "}
                  {new Date(reaction.created_at).toLocaleString("es")}
                </p>
                {reaction.comment && (
                  <p className="type-editorial text-sm">{reaction.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
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

export default function AdminMoodboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/moodboard`);
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

  async function uploadPiece(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setUploadMessage("El título no puede estar vacío");
      return;
    }
    if (!file) {
      setUploadMessage("Selecciona un archivo");
      return;
    }

    setUploading(true);
    setUploadMessage("Subiendo…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", trimmedTitle);
      if (description.trim()) {
        form.append("description", description.trim());
      }
      const parsedOrder = Number.parseInt(sortOrder, 10);
      form.append("sort_order", Number.isNaN(parsedOrder) ? "0" : String(parsedOrder));

      const res = await apiFetch(`/api/v1/projects/${projectId}/moodboard`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        setUploadMessage("Pieza subida");
        setTitle("");
        setDescription("");
        setSortOrder("0");
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        loadItems();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setUploadMessage(extractDetail(data, "Error al subir la pieza"));
      }
    } catch {
      setUploadMessage("Error de conexión con el servidor");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <h1 className="type-title text-xl">Moodboard</h1>

      {message && (
        <p className="type-ui mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <h2 className="type-subtitle-caps mt-6 text-lg">Nueva pieza</h2>
      <form
        onSubmit={uploadPiece}
        className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Título</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Descripción (opcional)</span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Orden</span>
          <input
            type="number"
            step={1}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>

        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 border border-border bg-background px-3">
          <span className="type-ui truncate text-sm">
            {file ? file.name : "Elegir imagen"}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>

        {uploadMessage && <p className="type-ui text-sm">{uploadMessage}</p>}

        <button
          type="submit"
          disabled={uploading}
          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
        >
          {uploading ? "Subiendo…" : "Subir pieza"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </form>

      <h2 className="type-subtitle-caps mt-6 text-lg">Piezas</h2>
      {loading && items.length === 0 ? (
        <p className="type-ui mt-3 text-sm">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="type-ui mt-3 text-sm">
          Todavía no hay piezas en el moodboard.
        </p>
      ) : (
        <div className="grid-brutal grid-brutal--2 mt-3">
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
