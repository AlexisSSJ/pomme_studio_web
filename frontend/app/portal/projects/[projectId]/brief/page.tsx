"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

interface Project {
  id: string;
  title: string;
  lead_id: string | null;
  client_id: string | null;
  lead_designer_id: string | null;
  scope_type: string | null;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
  created_at: string;
}

interface BriefItem {
  id: string;
  project_id: string;
  item_type: "question" | "reference";
  category: "branding" | "interior" | "general";
  prompt: string | null;
  answer: string | null;
  note: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  image_url: string | null;
  audio_url: string | null;
  audio_transcription: string | null;
  transcription?: string | null;
  response_type: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BriefPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [itemFeedback, setItemFeedback] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<Record<string, string>>({});
  const [progressData, setProgressData] = useState<{ progress: number; total_questions: number; answered_questions: number; status: string } | null>(null);

  const [category, setCategory] = useState<"branding" | "interior" | "general">(
    "branding"
  );
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio recording state
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const isActive = project?.status === "active";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, briefRes] = await Promise.all([
        apiFetch("/api/v1/projects"),
        apiFetch(`/api/v1/projects/${projectId}/brief`),
      ]);
      const pendingRes = await apiFetch(`/api/v1/projects/${projectId}/brief/pending`).catch(() => null);

      if (projectsRes.ok) {
        const projects: Project[] = await projectsRes.json();
        setProject(
          projects.find((candidate) => candidate.id === projectId) ?? null
        );
      }

      if (briefRes.ok) {
        const fetchedItems: BriefItem[] = await briefRes.json();
        setItems(fetchedItems);
        const ansMap: Record<string, string> = {};
        const trMap: Record<string, string> = {};
        fetchedItems.forEach((item) => {
          if (item.answer) ansMap[item.id] = item.answer;
          if (item.audio_transcription || item.transcription) {
            trMap[item.id] = item.audio_transcription || (item as any).transcription || "";
          }
        });
        setAnswers(ansMap);
        setTranscriptions(trMap);
      } else {
        const data: unknown = await briefRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el brief"));
      }

      if (pendingRes && pendingRes.ok) {
        const pData = await pendingRes.json();
        setProgressData(pData);
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

  // Debounced Autosave
  const autosaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const triggerAutosave = useCallback((itemId: string, answer: string) => {
    setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Guardando…" }));
    if (autosaveTimers.current[itemId]) {
      clearTimeout(autosaveTimers.current[itemId]);
    }
    autosaveTimers.current[itemId] = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/v1/projects/${projectId}/brief/items/${itemId}/autosave`,
          { method: "PATCH", body: JSON.stringify({ answer }) }
        );
        if (res.ok) {
          const result = await res.json();
          setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Guardado" }));
          if (result.progress !== undefined) {
            setProgressData((prev) => prev ? { ...prev, progress: result.progress, answered_questions: result.answered_questions ?? prev.answered_questions, status: result.status ?? prev.status } : null);
          }
        } else {
          setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Error al guardar" }));
        }
      } catch {
        setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Error de red" }));
      }
    }, 800);
  }, [projectId]);

  function handleAnswerChange(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    triggerAutosave(itemId, value);
  }

  // Audio recording handlers
  async function startRecording(itemId: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        await uploadAudioResponse(itemId, audioBlob);
      };

      mediaRecorder.start();
      setRecordingId(itemId);
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Grabando audio…" }));
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "No se pudo acceder al micrófono" }));
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recordingId) {
      mediaRecorderRef.current.stop();
      setRecordingId(null);
    }
  }

  async function uploadAudioResponse(itemId: string, blob: Blob) {
    setItemFeedback((prev) => ({ ...prev, [itemId]: "Subiendo y transcribiendo audio…" }));
    try {
      const form = new FormData();
      const audioFile = new File([blob], "voice_answer.webm", { type: "audio/webm" });
      form.append("file", audioFile);
      form.append("note", "Respuesta de audio del cliente");

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}/response-file`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        if (updated.audio_transcription) {
          setTranscriptions((prev) => ({ ...prev, [itemId]: updated.audio_transcription! }));
        }
        setItemFeedback((prev) => ({ ...prev, [itemId]: "Audio y transcripción guardados" }));
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({ ...prev, [itemId]: extractDetail(data, "Error al subir audio") }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al subir audio" }));
    }
  }

  // Image response upload
  async function uploadImageResponse(itemId: string, imageFile: File) {
    setItemFeedback((prev) => ({ ...prev, [itemId]: "Subiendo imagen de respuesta…" }));
    try {
      const form = new FormData();
      form.append("file", imageFile);
      form.append("note", "Imagen de referencia de respuesta");

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}/response-file`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        setItemFeedback((prev) => ({ ...prev, [itemId]: "Imagen guardada correctamente" }));
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({ ...prev, [itemId]: extractDetail(data, "Error al subir imagen") }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al subir imagen" }));
    }
  }

  async function uploadReference(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setUploadMessage("Selecciona un archivo");
      return;
    }

    setUploading(true);
    setUploadMessage("Subiendo…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      if (note.trim()) {
        form.append("note", note.trim());
      }

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/references`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        const created: BriefItem = await res.json();
        setItems((prev) => [...prev, created]);
        setUploadMessage("Referencia subida");
        setFile(null);
        setNote("");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setUploadMessage(extractDetail(data, "Error al subir la referencia"));
      }
    } catch {
      setUploadMessage("Error de conexión con el servidor");
    } finally {
      setUploading(false);
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

  const questions = items.filter((item) => item.item_type === "question");
  const references = items.filter((item) => item.item_type === "reference");

  const progressPercent = progressData?.progress ?? (questions.length > 0 ? Math.round((questions.filter(q => q.answer || answers[q.id]).length / questions.length) * 100) : 0);

  return (
    <section>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 mb-6">
        <div>
          <h1 className="text-xl tracking-tightest">Brief Inteligente</h1>
          {project && <p className="label-mono mt-1">{project.title}</p>}
        </div>
        {progressData && (
          <div className="flex flex-col gap-1 sm:text-right">
            <span className="label-mono">Progreso: {progressPercent}%</span>
            <div className="w-full sm:w-48 h-2 border border-border bg-background overflow-hidden">
              <div 
                className="h-full bg-foreground transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] text-muted">
              {progressData.answered_questions} de {progressData.total_questions} respondidas
            </span>
          </div>
        )}
      </div>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {project && project.status !== "active" && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          Este proyecto no está activo: la edición del brief está deshabilitada.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : (
        <>
          <h2 className="mt-6 text-lg tracking-tightest">Cuestionario</h2>
          {questions.length === 0 ? (
            <p className="mt-3 text-sm">
              Todavía no hay preguntas del estudio.
            </p>
          ) : (
            <div className="grid-brutal mt-3">
              {questions.map((item, index) => (
                <div key={item.id} className="flex flex-col gap-3 p-4 border border-border bg-surface">
                  <div className="flex items-center justify-between">
                    <p className="label-mono">
                      {item.category} ·{" "}
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    {autosaveStatus[item.id] && (
                      <span className="label-mono text-xs">
                        {autosaveStatus[item.id]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold">{item.prompt}</p>

                  <textarea
                    value={answers[item.id] ?? item.answer ?? ""}
                    onChange={(event) =>
                      handleAnswerChange(item.id, event.target.value)
                    }
                    placeholder="Escribe tu respuesta aquí (autoguardado en tiempo real)..."
                    maxLength={10000}
                    className="min-h-[100px] border border-border bg-background p-3 text-sm"
                  />

                  {/* Multimodal response section: Voice & Image */}
                  <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
                    {/* Audio Recorder */}
                    <div className="flex items-center gap-2">
                      {recordingId === item.id ? (
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="btn-brutal min-h-[36px] px-3 text-xs bg-foreground text-background"
                        >
                          ⏹ Detener grabación
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRecording(item.id)}
                          disabled={!isActive}
                          className="btn-brutal min-h-[36px] px-3 text-xs"
                        >
                          🎙 Grabar audio
                        </button>
                      )}
                    </div>

                    {/* Image Upload */}
                    <label className="btn-brutal min-h-[36px] px-3 text-xs cursor-pointer inline-flex items-center">
                      <span>🖼 Subir imagen/referencia</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadImageResponse(item.id, f);
                        }}
                      />
                    </label>
                  </div>

                  {/* Display uploaded media / transcription if any */}
                  {item.audio_url && (
                    <div className="mt-2 p-3 border border-border bg-background text-xs">
                      <p className="label-mono mb-1">Audio adjunto:</p>
                      <audio controls src={item.audio_url} className="w-full mt-1" />
                      {(transcriptions[item.id] || item.audio_transcription) && (
                        <div className="mt-2 pt-2 border-t border-border">
                          <p className="label-mono mb-1">Transcripción automática:</p>
                          <p className="text-sm italic">{transcriptions[item.id] || item.audio_transcription}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {item.image_url && (
                    <div className="mt-2 p-3 border border-border bg-background text-xs">
                      <p className="label-mono mb-1">Imagen de respuesta:</p>
                      <img src={item.image_url} alt="Respuesta visual" className="max-h-48 object-cover border border-border mt-1" />
                    </div>
                  )}

                  {itemFeedback[item.id] && (
                    <p className="text-xs text-muted mt-1">{itemFeedback[item.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <h2 className="mt-6 text-lg tracking-tightest">Referencias</h2>
          <form
            onSubmit={uploadReference}
            className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"
          >
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

            <label className="flex flex-col gap-1">
              <span className="label-mono">Nota (opcional)</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                className="min-h-[44px] border border-border bg-background px-3 text-sm"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 border border-border bg-background px-3">
              <span className="label-mono truncate">
                {file ? file.name : "Elegir archivo"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif,.pdf"
                onChange={(event) =>
                  setFile(event.target.files?.[0] ?? null)
                }
                className="sr-only"
              />
            </label>

            {uploadMessage && <p className="text-sm">{uploadMessage}</p>}

            <button
              type="submit"
              disabled={uploading || !isActive || !file}
              className="btn-brutal min-h-[44px] self-start px-3 text-xs"
            >
              {uploading ? "Subiendo…" : "Subir referencia"}
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          </form>

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
                    {downloadingId === item.id
                      ? "Descargando…"
                      : "Descargar"}
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
    </section>
  );
}
