"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import { useProtectedMediaUrl } from "@/lib/useProtectedMediaUrl";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";

interface Project {
  id: string;
  title: string;
  status: string;
  scope_type: string | null;
}

interface BriefImage {
  id: string;
  url: string;
  position: number;
  content_type: string | null;
}

interface BriefItem {
  id: string;
  item_type: "question" | "reference";
  category: "branding" | "interior" | "general" | null;
  prompt: string | null;
  answer: string | null;
  note: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  images?: BriefImage[];
  audio_url: string | null;
  audio_transcription: string | null;
  transcription?: string | null;
  client_confirmed?: boolean;
  status: string;
  created_at: string;
  updated_at?: string;
}

interface BriefProgress {
  progress?: number | null;
  total_questions?: number | null;
  answered_questions?: number | null;
  status?: string | null;
}

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AdminImagePreview({
  image,
  index,
  onZoom,
}: {
  image: BriefImage;
  index: number;
  onZoom: (src: string, alt: string) => void;
}) {
  const src = useProtectedMediaUrl(image?.url);
  // Fixed denominator: every question accepts up to two images.
  const label = `${String(index + 1).padStart(2, "0")}/02`;
  const alt = `Imagen de respuesta ${label}`;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-stone-900/10 bg-[#FAF8F5]">
      <button
        type="button"
        onClick={() => src && onZoom(src, alt)}
        disabled={!src}
        aria-label={`Ampliar imagen ${label}`}
        className="flex min-h-[160px] w-full items-center justify-center border-b border-stone-900/10 bg-[#F4F1EA]/50 p-2"
      >
        {src ? (
          <img src={src} alt={alt} className="max-h-48 w-full object-contain" />
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone-500">
            Cargando imagen…
          </span>
        )}
      </button>
      <div className="flex min-h-[44px] items-center justify-between gap-2 p-2">
        <span className="font-mono text-[11px] tabular-nums text-stone-500">
          {label}
        </span>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone-400"
          aria-hidden="true"
        >
          Zoom ↗
        </span>
      </div>
    </div>
  );
}

export default function AdminBriefPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [progressData, setProgressData] = useState<BriefProgress | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<"branding" | "interior" | "general">(
    "branding"
  );
  const [creating, setCreating] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(
    null
  );

  // Accordion UI state (pure view state; read-only review).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandInitRef = useRef(false);

  const isActive = project?.status === "active";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectRes, briefRes, progressRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/brief`),
        apiFetch(`/api/v1/projects/${projectId}/brief/pending`).catch(() => null),
      ]);

      if (projectRes.ok) {
        setProject(await projectRes.json());
      } else {
        const data: unknown = await projectRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }

      if (briefRes.ok) {
        const data: unknown = await briefRes.json();
        // Legacy/incomplete payloads must never break the view.
        setItems(Array.isArray(data) ? (data as BriefItem[]) : []);
      } else {
        const data: unknown = await briefRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el brief"));
      }

      if (progressRes?.ok) {
        const data: unknown = await progressRes.json().catch(() => null);
        if (data && typeof data === "object") setProgressData(data as BriefProgress);
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!zoomedImage) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setZoomedImage(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [zoomedImage]);

  // Open the first question once, after the initial load.
  useEffect(() => {
    if (expandInitRef.current) return;
    const qs = items.filter((it) => it?.item_type === "question");
    if (qs.length === 0) return;
    expandInitRef.current = true;
    setExpandedId(qs[0].id);
  }, [items]);

  async function createQuestion(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      setFormMessage("La pregunta no puede estar vacía");
      return;
    }

    setCreating(true);
    setFormMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/questions`,
        { method: "POST", body: JSON.stringify({ prompt: trimmed, category }) }
      );
      if (res.ok) {
        const created: BriefItem = await res.json();
        setItems((prev) => [...prev, created]);
        setFormMessage("Pregunta creada");
        setPrompt("");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFormMessage(extractDetail(data, "Error al crear la pregunta"));
      }
    } catch {
      setFormMessage("Error de conexión con el servidor");
    } finally {
      setCreating(false);
    }
  }

  async function downloadReference(item: BriefItem) {
    setDownloadingId(item.id);
    try {
      const url = await apiFetchBlobUrl(
        `/api/v1/projects/${projectId}/brief/items/${item.id}/file`
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.file_name || "referencia";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Error al descargar el archivo"
      );
    } finally {
      setDownloadingId(null);
    }
  }

  const questions = items.filter((item) => item?.item_type === "question");
  const references = items.filter((item) => item?.item_type === "reference");

  // Null-safe totals: legacy records may lack progress metadata entirely.
  const legacyAnswered = questions.filter((question) => {
    const images = Array.isArray(question.images) ? question.images : [];
    return Boolean(
      (question.answer ?? "").trim() ||
        (question.audio_url ?? "").trim() ||
        (question.audio_transcription ?? "").trim() ||
        (question.transcription ?? "").trim() ||
        images.length > 0 ||
        question.status === "completed"
    );
  }).length;
  const totalQuestions =
    typeof progressData?.total_questions === "number"
      ? progressData.total_questions
      : questions.length;
  const answeredQuestions =
    typeof progressData?.answered_questions === "number"
      ? progressData.answered_questions
      : legacyAnswered;
  const progressPercent =
    typeof progressData?.progress === "number"
      ? Math.min(100, Math.max(0, progressData.progress))
      : totalQuestions > 0
        ? Math.round((answeredQuestions / totalQuestions) * 100)
        : 0;
  const briefStatus =
    progressData?.status ??
    (answeredQuestions > 0 && answeredQuestions >= totalQuestions
      ? "completed"
      : answeredQuestions > 0
        ? "in_progress"
        : "pending");
  const confirmedCount = questions.filter((q) => q.client_confirmed).length;

  return (
    <section className="brief-editorial">
      {/* Editorial ficha header: micro-label, serif title, architectural progress line. */}
      <div className="mb-8 border-b border-stone-900/15 pb-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
            01 · Brief del proyecto
          </p>
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-500">
            <span
              aria-hidden="true"
              className="dot-organic h-1.5 w-1.5 shrink-0 bg-stone-800/70"
            />
            {briefStatus}
          </p>
        </div>
        <h1 className="mt-2 font-serif text-3xl font-normal tracking-tight text-stone-900 md:text-4xl">
          {project?.title ?? "Brief"}
        </h1>
        <div className="mt-5 flex flex-col gap-2">
          <div className="h-[2px] w-full bg-stone-200">
            <div
              className="h-full bg-stone-800 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="font-mono text-xs tabular-nums text-stone-500">
            {answeredQuestions} / {totalQuestions} respondidas · {progressPercent}% ·{" "}
            {confirmedCount} confirmadas
          </span>
        </div>
      </div>

      {message && (
        <p className="mb-4 rounded-xl border border-stone-900/15 bg-[#EFECE6]/75 p-4 text-sm text-stone-700">
          {message}
        </p>
      )}

      {project && !isActive && (
        <p className="mb-4 rounded-xl border border-stone-900/15 bg-[#EFECE6]/75 p-4 text-sm text-stone-700">
          Este proyecto no está activo: la creación de preguntas está
          deshabilitada.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">Cargando…</p>
      ) : (
        <>
          <h2 className="font-serif text-xl font-normal tracking-tight text-stone-900">
            Nueva pregunta
          </h2>
          <form
            onSubmit={createQuestion}
            className="mt-4 flex flex-col gap-4 rounded-2xl border border-stone-900/10 bg-[#EFECE6]/75 p-5 md:p-6"
          >
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                Pregunta
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={500}
                className="min-h-[80px] w-full rounded-xl border border-stone-900/15 bg-[#FAF8F5] p-4 text-[15px] text-stone-900 transition-colors duration-300 placeholder:text-stone-400 focus:border-stone-900/45 focus:bg-white"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                Categoría
              </span>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(
                    event.target.value as "branding" | "interior" | "general"
                  )
                }
                className="min-h-[44px] rounded-lg border border-stone-900/15 bg-[#FAF8F5] px-3 text-sm text-stone-900"
              >
                <option value="branding">Branding</option>
                <option value="interior">Interior</option>
                <option value="general">General</option>
              </select>
            </label>

            {formMessage && (
              <p className="text-sm text-stone-600">{formMessage}</p>
            )}

            <button
              type="submit"
              disabled={creating || !isActive}
              className="min-h-[44px] self-start rounded-lg bg-stone-900 px-5 py-2 text-xs uppercase tracking-wider text-[#FAF8F5] transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creando…" : "Crear pregunta"}
            </button>
          </form>

          <h2 className="mt-10 font-serif text-xl font-normal tracking-tight text-stone-900">
            Cuestionario
          </h2>
          {questions.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              Todavía no hay preguntas para este proyecto.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {questions.map((item, index) => {
                // Render only from the canonical response fields.
                const images = Array.isArray(item?.images) ? item.images : [];
                const imageCount = Math.min(images.length, 2);
                const answer = (item?.answer ?? "").trim();
                const transcription = (
                  item?.audio_transcription ??
                  item?.transcription ??
                  ""
                ).trim();
                const hasResponse = Boolean(
                  answer || transcription || item?.audio_url || imageCount > 0
                );
                const expanded = expandedId === item.id;
                const confirmed = Boolean(item.client_confirmed);

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border transition-all duration-300 ${
                      expanded
                        ? confirmed
                          ? "border-[#5F7161]/45 bg-[#FAF8F5] px-5 py-5 shadow-editorial md:px-7 md:py-6"
                          : "border-stone-900/35 bg-[#FAF8F5] px-5 py-5 shadow-editorial md:px-7 md:py-6"
                        : confirmed
                          ? "border-[#5F7161]/30 bg-[#EEF2EC]/75 px-5 py-4 hover:bg-[#E5EBE2] md:px-6 md:py-5"
                          : "border-stone-900/10 bg-[#EFECE6]/75 px-5 py-4 hover:bg-[#EAE5DC] md:px-6 md:py-5"
                    }`}
                  >
                    {/* Full-row header button: touch target far above 44px. */}
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`admin-brief-panel-${item.id}`}
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      className="flex min-h-[44px] w-full cursor-pointer items-center gap-4 text-left"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-stone-400">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`flex-1 ${
                          expanded
                            ? "font-serif text-lg leading-snug text-stone-950 md:text-xl"
                            : "text-[15px] font-normal text-stone-800 md:text-base"
                        }`}
                      >
                        {item.prompt}
                      </span>
                      {!expanded && confirmed && (
                        <span className="hidden items-center gap-2 font-serif text-[11px] italic text-[#44544A] sm:flex">
                          <span
                            aria-hidden="true"
                            className="dot-organic h-1.5 w-1.5 shrink-0 bg-[#5F7161]"
                          />
                          Confirmada
                        </span>
                      )}
                      {!expanded && !confirmed && (
                        <span className="hidden font-serif text-[11px] italic text-stone-500 sm:inline">
                          {hasResponse ? "Respondida" : "Sin respuesta"}
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition-transform duration-300 ${
                          expanded
                            ? "border border-stone-900/25 bg-transparent text-stone-800 hover:border-stone-900"
                            : "bg-stone-900 text-[#FAF8F5]"
                        }`}
                      >
                        {expanded ? "×" : "+"}
                      </span>
                    </button>

                    {expanded && (
                      <div
                        id={`admin-brief-panel-${item.id}`}
                        className="mt-5 flex flex-col gap-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                            {item.category ?? "general"} ·{" "}
                            {hasResponse ? "Respuesta del cliente" : "Sin respuesta"}
                          </p>
                          {confirmed ? (
                            <span className="flex items-center gap-2 rounded-lg bg-[#EEF2EC] px-3 py-1 font-serif text-[11px] italic text-[#44544A]">
                              <span
                                aria-hidden="true"
                                className="dot-organic h-1.5 w-1.5 shrink-0 bg-[#5F7161]"
                              />
                              Confirmada por el cliente ✓
                            </span>
                          ) : (
                            <span className="font-serif text-[11px] italic text-stone-500">
                              Sin confirmar por el cliente
                            </span>
                          )}
                        </div>

                        {answer && (
                          <p className="text-[15px] leading-relaxed text-stone-800">
                            {answer}
                          </p>
                        )}

                        <div className="flex flex-col gap-3 border-t border-stone-900/10 pt-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                            Respuesta multimodal
                          </p>

                          {imageCount > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                              {images.slice(0, 2).map((image, imageIndex) => (
                                <AdminImagePreview
                                  key={image?.id ?? imageIndex}
                                  image={image}
                                  index={imageIndex}
                                  onZoom={(src, alt) => setZoomedImage({ src, alt })}
                                />
                              ))}
                            </div>
                          )}

                          {item?.audio_url && (
                            <div className="flex flex-col gap-1 rounded-xl border border-stone-900/15 bg-[#F4F1EA]/50 p-4">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                                Nota de voz
                              </p>
                              {/* key forces a remount (fresh blob fetch) after the client
                                  re-records: the /media URL is stable across uploads. */}
                              <VoiceNotePlayer
                                key={item.updated_at ?? item.id}
                                url={item.audio_url}
                              />
                            </div>
                          )}

                          {transcription && (
                            <div className="flex flex-col gap-2 rounded-xl border border-stone-900/15 bg-[#F4F1EA]/50 p-4">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500">
                                Transcripción
                              </p>
                              <p className="text-[15px] leading-relaxed text-stone-800">
                                {transcription}
                              </p>
                            </div>
                          )}

                          {!hasResponse && (
                            <p className="font-serif text-[13px] italic text-stone-500">
                              El cliente todavía no ha respondido esta pregunta.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="mt-10 font-serif text-xl font-normal tracking-tight text-stone-900">
            Referencias
          </h2>
          {references.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">Todavía no hay referencias.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {references.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-stone-900/10 bg-[#EFECE6]/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-[15px] font-normal text-stone-800">
                      {item.file_name}
                    </p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-stone-500">
                      {item.category} · {item.content_type} ·{" "}
                      {formatBytes(item.size_bytes)}
                    </p>
                    {item.note && (
                      <p className="mt-1 text-sm text-stone-600">{item.note}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadReference(item)}
                    disabled={downloadingId === item.id}
                    className="min-h-[44px] shrink-0 rounded-lg border border-stone-900/20 px-4 py-2 text-xs uppercase tracking-wider text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:opacity-50"
                  >
                    {downloadingId === item.id ? "Descargando…" : "Descargar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tap anywhere (or Esc) closes the zoom; no hover needed. */}
      {zoomedImage && (
        <div
          role="button"
          tabIndex={0}
          autoFocus
          aria-label="Cerrar imagen ampliada"
          onClick={() => setZoomedImage(null)}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" ||
              event.key === "Enter" ||
              event.key === " "
            ) {
              setZoomedImage(null);
            }
          }}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-stone-950/95 p-4"
        >
          <div className="max-h-full max-w-full rounded-xl border border-stone-900/10 bg-[#FAF8F5] p-2">
            <img
              src={zoomedImage.src}
              alt={zoomedImage.alt}
              className="max-h-[80vh] max-w-[92vw] object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
}
