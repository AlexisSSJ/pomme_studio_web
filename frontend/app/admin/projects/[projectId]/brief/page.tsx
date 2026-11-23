"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import { useProtectedMediaUrl } from "@/lib/useProtectedMediaUrl";

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
  status: string;
  created_at: string;
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
    <div className="flex flex-col bg-background">
      <button
        type="button"
        onClick={() => src && onZoom(src, alt)}
        disabled={!src}
        aria-label={`Ampliar imagen ${label}`}
        className="flex min-h-[160px] w-full items-center justify-center border-b border-[#111111] bg-background p-2"
      >
        {src ? (
          <img src={src} alt={alt} className="max-h-48 w-full object-contain" />
        ) : (
          <span className="label-mono">CARGANDO IMAGEN…</span>
        )}
      </button>
      <div className="flex min-h-[44px] items-center justify-between gap-2 p-2">
        <span className="label-mono">{label}</span>
        <span className="label-mono" aria-hidden="true">
          ZOOM ↗
        </span>
      </div>
    </div>
  );
}

function AdminAudioPlayer({ url }: { url: string }) {
  const src = useProtectedMediaUrl(url);
  return src ? (
    <audio controls src={src} className="mt-1 w-full" />
  ) : (
    <p className="label-mono">CARGANDO AUDIO…</p>
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

  return (
    <section>
      <div className="mb-6 flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl tracking-tightest">Brief</h1>
          {project && <p className="label-mono mt-1">{project.title}</p>}
        </div>
        <div className="flex flex-col gap-1 sm:text-right">
          <p className="label-mono">ESTADO: {briefStatus}</p>
          <p className="label-mono">PROGRESO: {progressPercent}%</p>
          <div className="h-2 w-full overflow-hidden border border-border bg-background sm:w-48">
            <div
              className="h-full bg-foreground"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="label-mono">
            {answeredQuestions} / {totalQuestions} RESPONDIDAS
          </p>
        </div>
      </div>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {project && !isActive && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          Este proyecto no está activo: la creación de preguntas está
          deshabilitada.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : (
        <>
          <h2 className="mt-6 text-lg tracking-tightest">Nueva pregunta</h2>
          <form
            onSubmit={createQuestion}
            className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"
          >
            <label className="flex flex-col gap-1">
              <span className="label-mono">Pregunta</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={500}
                className="min-h-[44px] border border-border bg-background p-3 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="label-mono">Categoría</span>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(
                    event.target.value as "branding" | "interior" | "general"
                  )
                }
                className="min-h-[44px] border border-border bg-background px-3 text-sm"
              >
                <option value="branding">Branding</option>
                <option value="interior">Interior</option>
                <option value="general">General</option>
              </select>
            </label>

            {formMessage && <p className="text-sm">{formMessage}</p>}

            <button
              type="submit"
              disabled={creating || !isActive}
              className="btn-brutal min-h-[44px] self-start px-3 text-xs"
            >
              {creating ? "Creando…" : "Crear pregunta"}
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          </form>

          <h2 className="mt-6 text-lg tracking-tightest">Cuestionario</h2>
          {questions.length === 0 ? (
            <p className="mt-3 text-sm">
              Todavía no hay preguntas para este proyecto.
            </p>
          ) : (
            <div className="grid-brutal mt-3">
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

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 border border-border bg-surface p-4"
                  >
                    <p className="label-mono">
                      {item.category ?? "general"} ·{" "}
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <p className="text-sm font-semibold">{item.prompt}</p>

                    <p className="label-mono">
                      {hasResponse ? "RESPUESTA DEL CLIENTE" : "SIN RESPUESTA"}
                    </p>
                    {answer && <p className="text-sm">{answer}</p>}

                    <div className="flex flex-col gap-3 border-t border-[#111111] pt-3">
                      <p className="label-mono">RESPUESTA MULTIMODAL</p>

                      {imageCount > 0 && (
                        <div className="grid grid-cols-2 gap-px border border-[#111111] bg-[#111111]">
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
                        <div className="flex flex-col gap-1 border border-[#111111] bg-background p-3">
                          <p className="label-mono">AUDIO ADJUNTO</p>
                          <AdminAudioPlayer url={item.audio_url} />
                        </div>
                      )}

                      {transcription && (
                        <div className="flex flex-col gap-1 border border-[#111111] bg-background p-3">
                          <p className="label-mono">TRANSCRIPCIÓN</p>
                          <p className="text-sm">{transcription}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="mt-6 text-lg tracking-tightest">Referencias</h2>
          {references.length === 0 ? (
            <p className="mt-3 text-sm">Todavía no hay referencias.</p>
          ) : (
            <div className="grid-brutal mt-3">
              {references.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.file_name}</p>
                    <p className="label-mono mt-1">
                      {item.category} · {item.content_type} ·{" "}
                      {formatBytes(item.size_bytes)}
                    </p>
                    {item.note && <p className="mt-1 text-sm">{item.note}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadReference(item)}
                    disabled={downloadingId === item.id}
                    className="btn-brutal min-h-[44px] px-3 text-xs"
                  >
                    {downloadingId === item.id ? "Descargando…" : "Descargar"}
                    <span className="btn-brutal__arrow" aria-hidden="true">
                      ↗
                    </span>
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
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-[#111111] p-4"
        >
          <div className="max-h-full max-w-full border border-background bg-background p-2">
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
