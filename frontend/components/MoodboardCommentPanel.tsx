"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { apiFetch, extractDetail } from "@/lib/api";
import { useProtectedMedia } from "@/lib/useProtectedMediaUrl";
import type { MoodboardItemData } from "@/components/MoodboardComposition";

export interface MoodboardCommentData {
  id: string;
  moodboard_item_id: string;
  user_id: string;
  author_name: string;
  comment: string;
  created_at: string;
}

const MAX_COMMENT_LENGTH = 2000;

function commentNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Panel de comentarios tipo Notion (hoja completa en móvil, slide-over a la
 * derecha en desktop). Compartido por back-office y portal: los permisos
 * finos (autor o SUPER_ADMIN) los impone el backend; aquí solo se habilita
 * el borrado de los comentarios propios.
 */
export function MoodboardCommentPanel({
  projectId,
  item,
  currentUserId,
  onClose,
  onChanged,
  headerExtra,
}: {
  projectId: string;
  /** `null` = panel cerrado. */
  item: MoodboardItemData | null;
  /** Habilita borrar únicamente los comentarios de este usuario. */
  currentUserId?: string;
  onClose: () => void;
  /** Refresca la lista de piezas (conteo de comentarios). */
  onChanged?: () => void;
  /** Back-office: eliminación de la pieza en dos pasos. */
  headerExtra?: ReactNode;
}): ReactElement {
  const itemId = item?.id ?? null;
  const { url, error: imageError } = useProtectedMedia(
    itemId
      ? `/api/v1/projects/${projectId}/moodboard/items/${itemId}/file`
      : null
  );

  const [comments, setComments] = useState<MoodboardCommentData[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentsError, setCommentsError] = useState("");
  // Descarta respuestas de una pieza ya abandonada.
  const commentsRequestRef = useRef(0);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [composerMessage, setComposerMessage] = useState("");

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [threadMessage, setThreadMessage] = useState("");

  const [zoomOpen, setZoomOpen] = useState(false);

  const loadComments = useCallback(async () => {
    const requestId = ++commentsRequestRef.current;
    if (!itemId) {
      setComments([]);
      setCommentsError("");
      setLoadingComments(false);
      return;
    }
    // Limpia el aviso anterior: una recarga correcta no debe arrastrarlo.
    setCommentsError("");
    setLoadingComments(true);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${itemId}/comments`
      );
      if (requestId !== commentsRequestRef.current) return;
      if (res.ok) {
        setComments(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setCommentsError(extractDetail(data, "Error al cargar los comentarios"));
      }
    } catch {
      if (requestId === commentsRequestRef.current) {
        setCommentsError("Error de conexión con el servidor");
      }
    } finally {
      if (requestId === commentsRequestRef.current) {
        setLoadingComments(false);
      }
    }
  }, [projectId, itemId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Al cambiar de pieza (o cerrar el panel) se descarta el borrador y
  // cualquier confirmación pendiente de la pieza anterior.
  useEffect(() => {
    setDraft("");
    setComposerMessage("");
    setConfirmingDeleteId(null);
    setThreadMessage("");
    setZoomOpen(false);
  }, [itemId]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!itemId || posting) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setComposerMessage("El comentario no puede estar vacío");
      return;
    }

    setPosting(true);
    setComposerMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${itemId}/comments`,
        { method: "POST", body: JSON.stringify({ comment: trimmed }) }
      );
      if (res.ok) {
        setDraft("");
        await loadComments();
        onChanged?.();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setComposerMessage(extractDetail(data, "Error al enviar el comentario"));
      }
    } catch {
      setComposerMessage("Error de conexión con el servidor");
    } finally {
      setPosting(false);
    }
  }

  async function removeComment(commentId: string) {
    if (!itemId || deletingId) return;
    if (confirmingDeleteId !== commentId) {
      setConfirmingDeleteId(commentId);
      setThreadMessage("");
      return;
    }

    setDeletingId(commentId);
    setThreadMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${itemId}/comments/${commentId}`,
        { method: "DELETE" }
      );
      if (res.status === 204) {
        setComments((prev) =>
          prev.filter((comment) => comment.id !== commentId)
        );
        setConfirmingDeleteId(null);
        onChanged?.();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setThreadMessage(extractDetail(data, "Error al eliminar el comentario"));
        setConfirmingDeleteId(null);
      }
    } catch {
      setThreadMessage("Error de conexión con el servidor");
      setConfirmingDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  if (!item) return <></>;

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Comentarios de la pieza"
      className="fixed inset-0 z-[60] flex flex-col bg-background md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:border-l md:border-border"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <p className="label-mono">HILO DE COMENTARIOS</p>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Cerrar
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          {url ? (
            <img src={url} alt={item.title} className="block h-auto w-full" />
          ) : imageError ? (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              Error al cargar la imagen
            </p>
          ) : (
            <p className="label-mono text-stone-600">Cargando imagen…</p>
          )}

          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            disabled={!url}
            className="btn-brutal min-h-[44px] self-start px-3 text-xs"
          >
            Ampliar
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {loadingComments ? (
            <p className="type-ui text-sm">Cargando comentarios…</p>
          ) : commentsError ? (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {commentsError}
            </p>
          ) : (
            <>
              <p className="label-mono">{comments.length} COMENTARIOS</p>
              {comments.length === 0 ? (
                <p className="type-ui text-sm">
                  Todavía no hay comentarios en esta pieza.
                </p>
              ) : (
                comments.map((comment, index) => {
                  const canDelete =
                    currentUserId !== undefined &&
                    comment.user_id === currentUserId;
                  const confirming = confirmingDeleteId === comment.id;
                  return (
                    <article
                      key={comment.id}
                      className="flex flex-col gap-1 border border-border bg-surface p-3"
                    >
                      <p className="label-mono">
                        {commentNumber(index)} · {comment.author_name} ·{" "}
                        {new Date(comment.created_at).toLocaleString("es")}
                      </p>
                      <p className="type-editorial whitespace-pre-wrap text-sm">
                        {comment.comment}
                      </p>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => removeComment(comment.id)}
                          disabled={deletingId !== null}
                          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                        >
                          {deletingId === comment.id
                            ? "Eliminando…"
                            : confirming
                              ? "Confirmar eliminación"
                              : "Eliminar"}
                          <span className="btn-brutal__arrow" aria-hidden="true">
                            ↗
                          </span>
                        </button>
                      )}
                    </article>
                  );
                })
              )}
            </>
          )}

          {threadMessage && (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {threadMessage}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={submitComment}
        className="flex flex-col gap-2 border-t border-border p-4"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder="Escribe un comentario"
          aria-label="Escribe un comentario"
          className="type-ui min-h-[80px] border border-border bg-background p-3 text-sm"
        />
        {composerMessage && (
          <p className="type-ui border border-border bg-surface p-3 text-sm">
            {composerMessage}
          </p>
        )}
        <button
          type="submit"
          disabled={posting}
          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
        >
          {posting ? "Enviando…" : "Comentar"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </form>

      {zoomOpen && url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
          className="fixed inset-0 z-[70] flex flex-col bg-background"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="type-ui truncate text-sm">{item.title}</p>
            <button
              type="button"
              onClick={() => setZoomOpen(false)}
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
    </aside>
  );
}
