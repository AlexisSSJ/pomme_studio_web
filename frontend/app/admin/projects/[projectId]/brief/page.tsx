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
  brief_sent_at: string | null;
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
  image_url: string | null;
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-stone-900/10 bg-background">
      <button
        type="button"
        onClick={() => src && onZoom(src, alt)}
        disabled={!src}
        aria-label={`Ampliar imagen ${label}`}
        className="flex min-h-[160px] w-full items-center justify-center border-b border-stone-900/10 bg-surface/50 p-2"
      >
        {src ? (
          <img src={src} alt={alt} className="max-h-48 w-full object-contain" />
        ) : (
          <span className="type-ui text-xs text-stone-600">
            Cargando imagen…
          </span>
        )}
      </button>
      <div className="flex min-h-[44px] items-center justify-between gap-2 p-2">
        <span className="type-tech text-stone-500">
          {label}
        </span>
        <span
          className="type-tech text-stone-600"
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

  // Question edit/delete + release-to-client state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editCategory, setEditCategory] = useState<
    "branding" | "interior" | "general"
  >("branding");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(
    null
  );
  const [sending, setSending] = useState(false);

  const isActive = project?.status === "active";
  const briefSent = Boolean(project?.brief_sent_at);

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

  async function sendBrief() {
    if (!project || project.brief_sent_at || !isActive || sending) return;
    const confirmed = window.confirm(
      "¿Confirmas y envías el brief al cliente? El cliente podrá responder desde su portal."
    );
    if (!confirmed) return;

    setSending(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/brief/send`, {
        method: "POST",
      });
      if (res.ok) {
        const data: { project_id: string; brief_sent_at: string } =
          await res.json();
        setProject((prev) =>
          prev ? { ...prev, brief_sent_at: data.brief_sent_at } : prev
        );
        setMessage("Brief enviado al cliente ✓");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al enviar el brief"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setSending(false);
    }
  }

  function startEditing(item: BriefItem) {
    setEditingId(item.id);
    setEditPrompt(item.prompt ?? "");
    setEditCategory(item.category ?? "general");
    setEditError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditPrompt("");
    setEditError("");
  }

  async function saveEdit(item: BriefItem) {
    const trimmed = editPrompt.trim();
    if (!trimmed) {
      setEditError("La pregunta no puede estar vacía");
      return;
    }

    setEditSaving(true);
    setEditError("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/questions/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ prompt: trimmed, category: editCategory }),
        }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) =>
          prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it))
        );
        setEditingId(null);
        setEditPrompt("");
        setMessage("Pregunta actualizada");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setEditError(extractDetail(data, "Error al guardar la pregunta"));
      }
    } catch {
      setEditError("Error de conexión con el servidor");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteQuestion(item: BriefItem, hasResponse: boolean) {
    const confirmed = window.confirm(
      hasResponse
        ? "¿Eliminar esta pregunta? Las respuestas del cliente (texto, imágenes y audio) también se eliminarán. Esta acción no se puede deshacer."
        : "¿Eliminar esta pregunta? Esta acción no se puede deshacer."
    );
    if (!confirmed) return;

    setDeletingQuestionId(item.id);
    try {
      // The backend refuses to discard answers unless force=true.
      const suffix = hasResponse ? "?force=true" : "";
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/questions/${item.id}${suffix}`,
        { method: "DELETE" }
      );
      // 204 No Content: there is no JSON body to parse.
      if (res.status === 204 || res.ok) {
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        if (expandedId === item.id) setExpandedId(null);
        if (editingId === item.id) cancelEditing();
        setMessage("Pregunta eliminada");
        // Header counters come from the pending endpoint: reload so the
        // totals drop with the removed question instead of staying stale.
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al eliminar la pregunta"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setDeletingQuestionId(null);
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
          <p className="type-tech text-stone-600">
            01 · Brief del proyecto
          </p>
          <p className="type-tech flex items-center gap-2 text-stone-600">
            <span
              aria-hidden="true"
              className="dot-organic h-1.5 w-1.5 shrink-0 bg-stone-800/70"
            />
            {briefStatus}
          </p>
        </div>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          {project?.title ?? "Brief"}
        </h1>
        {project && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className={`type-tech inline-flex items-center gap-2 rounded-lg border px-3 py-1 ${
                briefSent
                  ? "border-[#5F7161]/40 bg-[#EEF2EC] text-[#44544A]"
                  : "border-stone-900/15 bg-surface/75 text-stone-600"
              }`}
            >
              <span
                aria-hidden="true"
                className={`dot-organic h-1.5 w-1.5 shrink-0 ${
                  briefSent ? "bg-[#5F7161]" : "bg-stone-800/70"
                }`}
              />
              {briefSent ? "Enviado al cliente" : "Borrador · no enviado"}
            </span>
            {!briefSent && isActive && (
              <button
                type="button"
                onClick={sendBrief}
                disabled={sending}
                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending
                  ? "Enviando…"
                  : "Confirmar y enviar al cliente ↗"}
              </button>
            )}
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <div className="h-[2px] w-full bg-stone-200">
            <div
              className="h-full bg-stone-800 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="type-tech text-stone-600">
            {answeredQuestions} / {totalQuestions} respondidas · {progressPercent}% ·{" "}
            {confirmedCount} confirmadas
          </span>
        </div>
      </div>

      {message && (
        <p className="type-ui mb-4 rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          {message}
        </p>
      )}

      {project && !isActive && (
        <p className="type-ui mb-4 rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          Este proyecto no está activo: la creación de preguntas está
          deshabilitada.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="type-ui mt-4 text-sm text-stone-600">Cargando…</p>
      ) : (
        <>
          <h2 className="type-subtitle-caps text-xl text-stone-900">
            Nueva pregunta
          </h2>
          <form
            onSubmit={createQuestion}
            className="mt-4 flex flex-col gap-4 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6"
          >
            <label className="flex flex-col gap-1">
              <span className="type-ui text-sm text-stone-600">
                Pregunta
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={500}
                className="type-ui min-h-[80px] w-full rounded-xl border border-stone-900/15 bg-background p-4 text-[15px] text-stone-900 transition-colors duration-300 placeholder:text-stone-500 focus:border-stone-900/45 focus:bg-background"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="type-ui text-sm text-stone-600">
                Categoría
              </span>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(
                    event.target.value as "branding" | "interior" | "general"
                  )
                }
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900"
              >
                <option value="branding">Branding</option>
                <option value="interior">Interior</option>
                <option value="general">General</option>
              </select>
            </label>

            {formMessage && (
              <p className="type-ui text-sm text-stone-600">{formMessage}</p>
            )}

            <button
              type="submit"
              disabled={creating || !isActive}
              className="type-ui min-h-[44px] self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creando…" : "Crear pregunta"}
            </button>
          </form>

          <h2 className="type-subtitle-caps mt-10 text-xl text-stone-900">
            Cuestionario
          </h2>
          {questions.length === 0 ? (
            <p className="type-ui mt-3 text-sm text-stone-600">
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
                  answer ||
                    transcription ||
                    item?.audio_url ||
                    // Legacy single-image rows have no images[] child rows.
                    item?.image_url ||
                    imageCount > 0 ||
                    // Mirrors the backend's is_question_answered(): a completed
                    // status counts as a response even if the fields look empty.
                    item?.status === "completed"
                );
                const expanded = expandedId === item.id;
                const confirmed = Boolean(item.client_confirmed);

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border transition-all duration-300 ${
                      expanded
                        ? confirmed
                          ? "border-[#5F7161]/45 bg-background px-5 py-5 shadow-editorial md:px-7 md:py-6"
                          : "border-stone-900/35 bg-background px-5 py-5 shadow-editorial md:px-7 md:py-6"
                        : confirmed
                          ? "border-[#5F7161]/30 bg-[#EEF2EC]/75 px-5 py-4 hover:bg-[#E5EBE2] md:px-6 md:py-5"
                          : "border-stone-900/10 bg-surface/75 px-5 py-4 hover:bg-[#EAE5DC] md:px-6 md:py-5"
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
                      <span className="type-tech text-stone-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`flex-1 ${
                          expanded
                            ? "type-editorial text-lg leading-snug text-stone-950 md:text-xl"
                            : "type-editorial text-[15px] text-stone-800 md:text-base"
                        }`}
                      >
                        {item.prompt}
                      </span>
                      {!expanded && confirmed && (
                        <span className="type-editorial hidden items-center gap-2 text-[11px] italic text-[#44544A] sm:flex">
                          <span
                            aria-hidden="true"
                            className="dot-organic h-1.5 w-1.5 shrink-0 bg-[#5F7161]"
                          />
                          Confirmada
                        </span>
                      )}
                      {!expanded && !confirmed && (
                        <span className="type-editorial hidden text-[11px] italic text-stone-500 sm:inline">
                          {hasResponse ? "Respondida" : "Sin respuesta"}
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition-transform duration-300 ${
                          expanded
                            ? "border border-stone-900/25 bg-transparent text-stone-800 hover:border-stone-900"
                            : "bg-stone-900 text-background"
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
                          <p className="type-tech text-stone-600">
                            {item.category ?? "general"} ·{" "}
                            {hasResponse ? "Respuesta del cliente" : "Sin respuesta"}
                          </p>
                          {confirmed ? (
                            <span className="type-editorial flex items-center gap-2 rounded-lg bg-[#EEF2EC] px-3 py-1 text-[11px] italic text-[#44544A]">
                              <span
                                aria-hidden="true"
                                className="dot-organic h-1.5 w-1.5 shrink-0 bg-[#5F7161]"
                              />
                              Confirmada por el cliente ✓
                            </span>
                          ) : (
                            <span className="type-editorial text-[11px] italic text-stone-500">
                              Sin confirmar por el cliente
                            </span>
                          )}
                        </div>

                        {answer && (
                          <p className="type-editorial text-[15px] leading-relaxed text-stone-800">
                            {answer}
                          </p>
                        )}

                        <div className="flex flex-col gap-3 border-t border-stone-900/10 pt-4">
                          <p className="type-tech text-stone-600">
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
                            <div className="flex flex-col gap-1 rounded-xl border border-stone-900/15 bg-surface/50 p-4">
                              <p className="type-tech text-stone-600">
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
                            <div className="flex flex-col gap-2 rounded-xl border border-stone-900/15 bg-surface/50 p-4">
                              <p className="type-tech text-stone-600">
                                Transcripción
                              </p>
                              <p className="type-editorial text-[15px] leading-relaxed text-stone-800">
                                {transcription}
                              </p>
                            </div>
                          )}

                          {!hasResponse && (
                            <p className="type-editorial text-[13px] italic text-stone-500">
                              El cliente todavía no ha respondido esta pregunta.
                            </p>
                          )}
                        </div>

                        {editingId === item.id ? (
                          <div className="flex flex-col gap-3 border-t border-stone-900/10 pt-4">
                            <p className="type-tech text-stone-600">
                              Editar pregunta
                            </p>
                            <label className="flex flex-col gap-1">
                              <span className="type-ui text-sm text-stone-600">
                                Pregunta
                              </span>
                              <textarea
                                value={editPrompt}
                                onChange={(event) =>
                                  setEditPrompt(event.target.value)
                                }
                                maxLength={500}
                                className="type-ui min-h-[80px] w-full rounded-xl border border-stone-900/15 bg-background p-4 text-[15px] text-stone-900 transition-colors duration-300 placeholder:text-stone-500 focus:border-stone-900/45 focus:bg-background"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="type-ui text-sm text-stone-600">
                                Categoría
                              </span>
                              <select
                                value={editCategory}
                                onChange={(event) =>
                                  setEditCategory(
                                    event.target.value as
                                      | "branding"
                                      | "interior"
                                      | "general"
                                  )
                                }
                                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900"
                              >
                                <option value="branding">Branding</option>
                                <option value="interior">Interior</option>
                                <option value="general">General</option>
                              </select>
                            </label>
                            {editError && (
                              <p className="type-ui text-sm text-stone-600">
                                {editError}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => saveEdit(item)}
                                disabled={editSaving || !isActive}
                                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {editSaving ? "Guardando…" : "Guardar"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditing}
                                disabled={editSaving}
                                className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3 border-t border-stone-900/10 pt-4">
                            <button
                              type="button"
                              onClick={() => startEditing(item)}
                              disabled={!isActive}
                              className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteQuestion(item, hasResponse)}
                              disabled={
                                deletingQuestionId === item.id || !isActive
                              }
                              className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deletingQuestionId === item.id
                                ? "Eliminando…"
                                : "Eliminar"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="type-subtitle-caps mt-10 text-xl text-stone-900">
            Referencias
          </h2>
          {references.length === 0 ? (
            <p className="type-ui mt-3 text-sm text-stone-600">Todavía no hay referencias.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {references.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-stone-900/10 bg-surface/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="type-ui text-[15px] text-stone-800">
                      {item.file_name}
                    </p>
                    <p className="type-tech mt-1 text-stone-500">
                      {item.category} · {item.content_type} ·{" "}
                      {formatBytes(item.size_bytes)}
                    </p>
                    {item.note && (
                      <p className="type-editorial mt-1 text-sm text-stone-600">{item.note}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadReference(item)}
                    disabled={downloadingId === item.id}
                    className="type-ui min-h-[44px] shrink-0 rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:opacity-50"
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
          <div className="max-h-full max-w-full rounded-xl border border-stone-900/10 bg-background p-2">
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
