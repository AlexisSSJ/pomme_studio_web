"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

interface Deliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: "in_review" | "changes_requested" | "approved";
  is_client_visible: boolean;
  is_final_handover: boolean;
  published_at: string | null;
  published_by: string | null;
  created_by: string;
  created_at: string;
}

interface DeliverableComment {
  id: string;
  deliverable_id: string;
  created_by: string;
  x_pct: number;
  y_pct: number;
  page_or_frame: number;
  body: string;
  round_number: number;
  consumes_round: boolean;
  created_at: string;
}

interface ProjectDetail {
  id: string;
  remaining_rounds: number;
  balance_paid: boolean;
}

interface PendingPin {
  x: number;
  y: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.5;
// A pointer may drift this many px before a gesture stops counting as a tap.
const TAP_SLOP_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function deliverableStatusLabel(status: Deliverable["status"]): string {
  if (status === "in_review") return "En revisión";
  if (status === "changes_requested") return "Cambios solicitados";
  return "Aprobado";
}

/**
 * Tactile deliverable viewer: pinch/button zoom (1–4x) over an
 * overflow-auto container, tap-to-place numbered pins, and the client
 * review actions (request changes / approve). `canReview` is false for
 * team members: pins become read-only and only the download remains.
 */
export default function DeliverableViewer({
  projectId,
  deliverableId,
  canReview,
  onChanged,
}: {
  projectId: string;
  deliverableId: string;
  canReview: boolean;
  onChanged?: () => void;
}) {
  const [deliverable, setDeliverable] = useState<Deliverable | null>(null);
  const [comments, setComments] = useState<DeliverableComment[]>([]);
  const [remainingRounds, setRemainingRounds] = useState<number | null>(null);
  const [balancePaid, setBalancePaid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [url, setUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");

  const [scale, setScale] = useState(MIN_SCALE);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [pinBody, setPinBody] = useState("");
  const [sendingPin, setSendingPin] = useState(false);
  const [pinFeedback, setPinFeedback] = useState("");
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null
  );

  const [mutationBusy, setMutationBusy] = useState<
    "changes" | "approve" | null
  >(null);
  const [actionFeedback, setActionFeedback] = useState("");
  const [downloading, setDownloading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Active pointers of the current gesture, keyed by pointerId.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(
    null
  );
  const panStartRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const gestureMovedRef = useRef(false);
  const tapInfoRef = useRef<{
    target: EventTarget | null;
    x: number;
    y: number;
  } | null>(null);

  const filePath = `/api/v1/projects/${projectId}/deliverables/${deliverableId}/file`;
  const previewPath = `/api/v1/projects/${projectId}/deliverables/${deliverableId}/preview`;
  const locked =
    canReview &&
    deliverable !== null &&
    deliverable.is_final_handover &&
    !balancePaid;
  const imagePath = locked ? previewPath : filePath;
  const isInReview = deliverable !== null && deliverable.status === "in_review";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deliverableRes, commentsRes, projectRes] = await Promise.all([
        apiFetch(
          `/api/v1/projects/${projectId}/deliverables/${deliverableId}`
        ),
        apiFetch(
          `/api/v1/projects/${projectId}/deliverables/${deliverableId}/comments`
        ),
        apiFetch(`/api/v1/projects/${projectId}`),
      ]);

      if (deliverableRes.ok) {
        setDeliverable(await deliverableRes.json());
      } else {
        const data: unknown = await deliverableRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el entregable"));
      }

      if (commentsRes.ok) {
        setComments(await commentsRes.json());
      } else if (deliverableRes.ok) {
        const data: unknown = await commentsRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar los pines"));
      }

      if (projectRes.ok) {
        const project = (await projectRes.json()) as ProjectDetail;
        setRemainingRounds(project.remaining_rounds);
        setBalancePaid(project.balance_paid);
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId, deliverableId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setImageError("");

    apiFetchBlobUrl(imagePath)
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
  }, [imagePath]);

  // Gestures can end outside the transformed surface (finger dragged off,
  // mouse released elsewhere); release stray pointers so the next gesture
  // starts clean. Tap handling stays in the wrapper's own pointerup.
  useEffect(() => {
    function releasePointer(event: PointerEvent) {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchStartRef.current = null;
      if (pointersRef.current.size === 0) panStartRef.current = null;
    }
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    return () => {
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
    };
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size === 1) {
      gestureMovedRef.current = false;
      tapInfoRef.current = {
        target: event.target,
        x: event.clientX,
        y: event.clientY,
      };
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: scrollRef.current?.scrollLeft ?? 0,
        top: scrollRef.current?.scrollTop ?? 0,
      };
      pinchStartRef.current = null;
      return;
    }

    // A second pointer always ends any pending tap: pinch beats tap.
    gestureMovedRef.current = true;
    panStartRef.current = null;
    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchStartRef.current = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        scale,
      };
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size >= 2) {
      if (pinchStartRef.current && pinchStartRef.current.distance > 0) {
        const [first, second] = Array.from(pointersRef.current.values());
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        const next = clamp(
          (pinchStartRef.current.scale * distance) /
            pinchStartRef.current.distance,
          MIN_SCALE,
          MAX_SCALE
        );
        setScale(Math.round(next * 100) / 100);
      }
      return;
    }

    const pan = panStartRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      gestureMovedRef.current = true;
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = pan.left - dx;
        scrollRef.current.scrollTop = pan.top - dy;
      }
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const wasTracked = pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 0) panStartRef.current = null;
    if (!wasTracked || gestureMovedRef.current) return;
    // Remaining fingers mean this was part of a multi-touch gesture.
    if (pointersRef.current.size > 0) return;

    const tap = tapInfoRef.current;
    if (!tap) return;
    const target = tap.target instanceof HTMLElement ? tap.target : null;
    const marker = target?.closest("[data-pin-marker]") ?? null;
    if (marker) {
      const commentId = marker.getAttribute("data-pin-marker");
      if (commentId) {
        setSelectedCommentId((prev) =>
          prev === commentId ? null : commentId
        );
      }
      return;
    }

    if (pinMode && imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // getBoundingClientRect reflects the transform, so the percentages
        // are correct at any zoom level.
        const x = clamp(((tap.x - rect.left) / rect.width) * 100, 0, 100);
        const y = clamp(((tap.y - rect.top) / rect.height) * 100, 0, 100);
        setPendingPin({ x, y });
        setPinFeedback("");
      }
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 0) panStartRef.current = null;
    // A canceled gesture (palm rejection, browser takeover) never taps.
    gestureMovedRef.current = true;
  }

  function handleMarkerKeyDown(commentId: string) {
    return (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      // Keyboard activation only: pointer taps are handled in pointerup.
      setSelectedCommentId((prev) =>
        prev === commentId ? null : commentId
      );
    };
  }

  async function sendPin() {
    if (sendingPin || !pendingPin) return;
    const body = pinBody.trim();
    if (!body) {
      setPinFeedback("El comentario del pin no puede estar vacío");
      return;
    }

    setSendingPin(true);
    setPinFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverableId}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            x_pct: Math.round(pendingPin.x * 100) / 100,
            y_pct: Math.round(pendingPin.y * 100) / 100,
            body,
          }),
        }
      );
      if (res.ok) {
        const created = (await res.json()) as DeliverableComment;
        setPendingPin(null);
        setPinBody("");
        setPinMode(false);
        await load();
        setSelectedCommentId(created.id);
        onChanged?.();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setPinFeedback(extractDetail(data, "Error al guardar el pin"));
      }
    } catch {
      setPinFeedback("Error de conexión con el servidor");
    } finally {
      setSendingPin(false);
    }
  }

  async function runMutation(kind: "changes" | "approve") {
    if (mutationBusy || !canReview) return;
    setMutationBusy(kind);
    setActionFeedback("");
    const path = kind === "changes" ? "request-changes" : "approve";
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverableId}/${path}`,
        { method: "POST" }
      );
      if (res.ok) {
        await load();
        onChanged?.();
        setActionFeedback(
          kind === "changes"
            ? "Cambios solicitados. El estudio subirá una nueva versión."
            : "Entregable aprobado."
        );
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setActionFeedback(
          extractDetail(
            data,
            kind === "changes"
              ? "Error al solicitar cambios"
              : "Error al aprobar el entregable"
          )
        );
      }
    } catch {
      setActionFeedback("Error de conexión con el servidor");
    } finally {
      setMutationBusy(null);
    }
  }

  async function download() {
    if (downloading || !deliverable || locked) return;
    setDownloading(true);
    setActionFeedback("");
    try {
      const blobUrl = await apiFetchBlobUrl(filePath);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = deliverable.file_name || "entregable";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      setActionFeedback(
        error instanceof Error ? error.message : "Error al descargar el archivo"
      );
    } finally {
      setDownloading(false);
    }
  }

  const selectedComment =
    comments.find((comment) => comment.id === selectedCommentId) ?? null;
  const selectedCommentNumber = selectedComment
    ? comments.indexOf(selectedComment) + 1
    : 0;

  return (
    <div className="brief-editorial flex flex-col gap-4">
      {message && (
        <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          {message}
        </p>
      )}

      {loading && !deliverable && !message && (
        <p className="type-ui text-sm text-stone-600">Cargando…</p>
      )}

      {deliverable && (
        <>
          <div className="rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="type-subtitle-caps text-base text-stone-900">
                {deliverable.title}
              </p>
              <span
                className={`type-tech inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                  deliverable.status === "approved"
                    ? "border-[#5F7161]/40 bg-[#EEF2EC] text-[#44544A]"
                    : "border-stone-900/15 bg-background text-stone-700"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`dot-organic h-1.5 w-1.5 ${
                    deliverable.status === "approved"
                      ? "bg-[#5F7161]"
                      : "bg-stone-600"
                  }`}
                />
                {deliverableStatusLabel(deliverable.status)}
              </span>
            </div>
            <p className="type-tech mt-2 text-stone-600">
              Versión {deliverable.version} ·{" "}
              {formatBytes(deliverable.size_bytes)}
              {deliverable.is_final_handover && " · Entrega final"}
            </p>
            {remainingRounds !== null && (
              <p className="type-tech mt-1 text-stone-500">
                Rondas de cambios restantes · {remainingRounds}
              </p>
            )}
          </div>

          {imageError ? (
            <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
              {imageError}
            </p>
          ) : url ? (
            <div
              ref={scrollRef}
              className="relative max-h-[70vh] overflow-auto rounded-2xl border border-stone-900/15 bg-surface/65 shadow-editorial"
            >
              <div
                className="relative w-full select-none"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  touchAction: "none",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <img
                  ref={imageRef}
                  src={url}
                  alt={deliverable.title}
                  draggable={false}
                  className="block w-full"
                />
                {comments.map((comment, index) => {
                  const selected = comment.id === selectedCommentId;
                  return (
                    <button
                      key={comment.id}
                      type="button"
                      data-pin-marker={comment.id}
                      aria-pressed={selected}
                      aria-label={`Pin ${index + 1}`}
                      onKeyDown={handleMarkerKeyDown(comment.id)}
                      className={`absolute flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-editorial transition-colors duration-300 ${
                        selected
                          ? "border-stone-900 bg-background text-stone-900"
                          : "border-background/80 bg-stone-900 text-background"
                      }`}
                      style={{
                        left: `${comment.x_pct}%`,
                        top: `${comment.y_pct}%`,
                      }}
                    >
                      <span className="type-tech">{index + 1}</span>
                    </button>
                  );
                })}
                {pendingPin && (
                  <div
                    aria-hidden="true"
                    className="absolute flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-dashed border-stone-900 bg-background/95 text-stone-900 shadow-editorial"
                    style={{
                      left: `${pendingPin.x}%`,
                      top: `${pendingPin.y}%`,
                    }}
                  >
                    <span className="type-tech">{comments.length + 1}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="type-tech rounded-xl border border-stone-900/10 bg-surface/75 p-4 text-stone-600">
              Cargando imagen…
            </p>
          )}

          {url && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setScale((prev) =>
                    clamp(prev - ZOOM_STEP, MIN_SCALE, MAX_SCALE)
                  )
                }
                disabled={scale <= MIN_SCALE}
                aria-label="Alejar"
                className="type-ui flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-stone-900/20 bg-background px-3 text-sm text-stone-800 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <p className="type-tech px-2 text-stone-600">
                Zoom {scale.toFixed(1)}×
              </p>
              <button
                type="button"
                onClick={() =>
                  setScale((prev) =>
                    clamp(prev + ZOOM_STEP, MIN_SCALE, MAX_SCALE)
                  )
                }
                disabled={scale >= MAX_SCALE}
                aria-label="Acercar"
                className="type-ui flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-stone-900/20 bg-background px-3 text-sm text-stone-800 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
              {canReview && isInReview && (
                <button
                  type="button"
                  onClick={() => {
                    setPinMode((prev) => !prev);
                    setPendingPin(null);
                    setPinBody("");
                    setPinFeedback("");
                  }}
                  aria-pressed={pinMode}
                  className={`type-ui min-h-[44px] rounded-lg px-4 py-2 text-xs transition-colors duration-300 ${
                    pinMode
                      ? "bg-stone-900 text-background hover:bg-stone-800"
                      : "border border-stone-900/20 bg-background text-stone-700 hover:bg-stone-900 hover:text-background"
                  }`}
                >
                  {pinMode ? "Modo pin activo ✓" : "Colocar pin ↗"}
                </button>
              )}
              {locked ? (
                <p className="type-tech rounded-lg border border-stone-900/15 bg-surface/75 px-3 py-2.5 text-stone-600">
                  Pago final pendiente · Previsualización
                </p>
              ) : (
                <button
                  type="button"
                  onClick={download}
                  disabled={downloading}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloading ? "Descargando…" : "Descargar ↗"}
                </button>
              )}
            </div>
          )}

          {pinMode && (
            <p className="type-editorial text-sm italic text-stone-600">
              Modo pin activo · Toca sobre la imagen para colocar tu comentario.
            </p>
          )}

          {pendingPin && (
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-900/20 bg-surface/75 p-5 shadow-editorial">
              <p className="type-tech text-stone-600">
                Pin {comments.length + 1} · {Math.round(pendingPin.x)}% /{" "}
                {Math.round(pendingPin.y)}%
              </p>
              <textarea
                value={pinBody}
                onChange={(event) => setPinBody(event.target.value)}
                maxLength={2000}
                placeholder="Escribe el comentario del pin…"
                className="type-ui min-h-[84px] rounded-xl border border-stone-900/15 bg-background p-4 text-sm text-stone-900 transition-colors duration-300 placeholder:text-stone-500 focus:border-stone-900/45"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={sendPin}
                  disabled={sendingPin}
                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingPin ? "Guardando…" : "Enviar pin ↗"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPin(null);
                    setPinBody("");
                    setPinFeedback("");
                  }}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
                >
                  Cancelar
                </button>
              </div>
              {pinFeedback && (
                <p className="type-ui rounded-xl border border-stone-900/15 bg-background p-3 text-sm text-stone-700">
                  {pinFeedback}
                </p>
              )}
            </div>
          )}

          {selectedComment && (
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-900/20 bg-background p-5 shadow-editorial">
              <p className="type-tech text-stone-600">
                Pin {selectedCommentNumber} · Ronda{" "}
                {selectedComment.round_number} · Página{" "}
                {selectedComment.page_or_frame}
              </p>
              <p className="type-editorial text-base leading-relaxed text-stone-900">
                {selectedComment.body}
              </p>
              <button
                type="button"
                onClick={() => setSelectedCommentId(null)}
                className="type-ui min-h-[44px] self-start rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
              >
                Cerrar
              </button>
            </div>
          )}

          {canReview && isInReview && (
            <div className="flex flex-wrap gap-2.5 pt-1">
              {(remainingRounds === null || remainingRounds > 0) && (
                <button
                  type="button"
                  onClick={() => runMutation("changes")}
                  disabled={mutationBusy !== null}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/25 bg-background px-5 py-2 text-xs text-stone-900 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mutationBusy === "changes"
                    ? "Solicitando…"
                    : "Solicitar cambios ↗"}
                </button>
              )}
              <button
                type="button"
                onClick={() => runMutation("approve")}
                disabled={mutationBusy !== null}
                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutationBusy === "approve"
                  ? "Aprobando…"
                  : "Aprobar entregable ↗"}
              </button>
            </div>
          )}

          {canReview &&
            isInReview &&
            remainingRounds !== null &&
            remainingRounds <= 0 && (
              <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
                No te quedan rondas de cambios incluidas. Deja tus comentarios
                como pines y contacta al estudio para contratar más rondas.
              </p>
            )}

          {actionFeedback && (
            <p className="type-ui rounded-xl border border-[#5F7161]/35 bg-[#EEF2EC]/75 p-4 text-sm text-[#44544A]">
              {actionFeedback}
            </p>
          )}
        </>
      )}
    </div>
  );
}
