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
    <div className="flex flex-col gap-4">
      {message && (
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {loading && !deliverable && !message && (
        <p className="type-ui text-sm">Cargando…</p>
      )}

      {deliverable && (
        <>
          <div>
            <p className="type-subtitle-caps text-base">{deliverable.title}</p>
            <p className="label-mono mt-1">
              VERSIÓN {deliverable.version} ·{" "}
              {deliverableStatusLabel(deliverable.status)} ·{" "}
              {formatBytes(deliverable.size_bytes)}
              {deliverable.is_final_handover && " · ENTREGA FINAL"}
            </p>
            {remainingRounds !== null && (
              <p className="label-mono mt-1">
                RONDAS DE CAMBIOS RESTANTES · {remainingRounds}
              </p>
            )}
          </div>

          {imageError ? (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {imageError}
            </p>
          ) : url ? (
            <div
              ref={scrollRef}
              className="relative max-h-[70vh] overflow-auto border border-border bg-surface"
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
                      className={`absolute flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-border ${
                        selected
                          ? "bg-background text-foreground"
                          : "bg-foreground text-background"
                      }`}
                      style={{
                        left: `${comment.x_pct}%`,
                        top: `${comment.y_pct}%`,
                      }}
                    >
                      <span className="label-mono">{index + 1}</span>
                    </button>
                  );
                })}
                {pendingPin && (
                  <div
                    aria-hidden="true"
                    className="absolute flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-dashed border-border bg-background text-foreground"
                    style={{
                      left: `${pendingPin.x}%`,
                      top: `${pendingPin.y}%`,
                    }}
                  >
                    <span className="label-mono">{comments.length + 1}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="label-mono border border-border bg-surface p-3">
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
                className="btn-brutal min-h-[44px] min-w-[44px] justify-center px-3 text-xs"
              >
                −
              </button>
              <p className="label-mono px-1">ZOOM {scale.toFixed(1)}×</p>
              <button
                type="button"
                onClick={() =>
                  setScale((prev) =>
                    clamp(prev + ZOOM_STEP, MIN_SCALE, MAX_SCALE)
                  )
                }
                disabled={scale >= MAX_SCALE}
                aria-label="Acercar"
                className="btn-brutal min-h-[44px] min-w-[44px] justify-center px-3 text-xs"
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
                  className={`btn-brutal min-h-[44px] px-3 text-xs ${
                    pinMode ? "bg-foreground text-background" : ""
                  }`}
                >
                  Colocar pin
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}
              {locked ? (
                <p className="label-mono border border-border bg-surface p-3">
                  PAGO FINAL PENDIENTE · PREVISUALIZACIÓN
                </p>
              ) : (
                <button
                  type="button"
                  onClick={download}
                  disabled={downloading}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  {downloading ? "Descargando…" : "Descargar"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}
            </div>
          )}

          {pinMode && (
            <p className="label-mono">
              MODO PIN ACTIVO · TOCA LA IMAGEN PARA COLOCAR EL PIN
            </p>
          )}

          {pendingPin && (
            <div className="flex flex-col gap-2 border border-border bg-surface p-3">
              <p className="label-mono">
                PIN {comments.length + 1} · {Math.round(pendingPin.x)}% /{" "}
                {Math.round(pendingPin.y)}%
              </p>
              <textarea
                value={pinBody}
                onChange={(event) => setPinBody(event.target.value)}
                maxLength={2000}
                placeholder="Escribe el comentario del pin"
                className="type-ui min-h-[44px] border border-border bg-background p-3 text-sm placeholder:text-stone-500"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={sendPin}
                  disabled={sendingPin}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  {sendingPin ? "Guardando…" : "Enviar pin"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPin(null);
                    setPinBody("");
                    setPinFeedback("");
                  }}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Cancelar
                </button>
              </div>
              {pinFeedback && (
                <p className="type-ui border border-border bg-background p-3 text-sm">
                  {pinFeedback}
                </p>
              )}
            </div>
          )}

          {selectedComment && (
            <div className="flex flex-col gap-2 border border-border bg-surface p-3">
              <p className="label-mono">
                PIN {selectedCommentNumber} · RONDA{" "}
                {selectedComment.round_number} · PÁGINA{" "}
                {selectedComment.page_or_frame}
              </p>
              <p className="type-editorial text-base leading-snug">
                {selectedComment.body}
              </p>
              <button
                type="button"
                onClick={() => setSelectedCommentId(null)}
                className="btn-brutal min-h-[44px] self-start px-3 text-xs"
              >
                Cerrar
              </button>
            </div>
          )}

          {canReview && isInReview && (
            <div className="flex flex-wrap gap-2">
              {(remainingRounds === null || remainingRounds > 0) && (
                <button
                  type="button"
                  onClick={() => runMutation("changes")}
                  disabled={mutationBusy !== null}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  {mutationBusy === "changes"
                    ? "Solicitando…"
                    : "Solicitar cambios"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => runMutation("approve")}
                disabled={mutationBusy !== null}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                {mutationBusy === "approve" ? "Aprobando…" : "Aprobar entregable"}
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            </div>
          )}

          {canReview &&
            isInReview &&
            remainingRounds !== null &&
            remainingRounds <= 0 && (
              <p className="type-ui border border-border bg-surface p-3 text-sm">
                No te quedan rondas de cambios incluidas. Deja tus comentarios
                como pines y contacta al estudio para contratar más rondas.
              </p>
            )}

          {actionFeedback && (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {actionFeedback}
            </p>
          )}
        </>
      )}
    </div>
  );
}
