"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import { useProtectedMediaUrl } from "@/lib/useProtectedMediaUrl";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";

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
  brief_sent_at: string | null;
  created_at: string;
}

interface BriefImage {
  id: string;
  url: string;
  position: number;
  content_type: string | null;
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
  images?: BriefImage[];
  audio_url: string | null;
  audio_transcription: string | null;
  transcription?: string | null;
  response_type: string | null;
  progress?: number | null;
  client_confirmed?: boolean;
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

function ImagePreview({
  image,
  index,
  deleting,
  onZoom,
  onDelete,
}: {
  image: BriefImage;
  index: number;
  deleting: boolean;
  onZoom: (src: string, alt: string) => void;
  onDelete: () => void;
}) {
  const src = useProtectedMediaUrl(image?.url);
  // Fixed denominator: every question accepts up to two images (as in admin).
  const label = `${String(index + 1).padStart(2, "0")}/02`;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-stone-900/10 bg-background">
      <button
        type="button"
        onClick={() => src && onZoom(src, `Imagen de respuesta ${label}`)}
        disabled={!src}
        aria-label={`Ampliar imagen ${label}`}
        className="flex min-h-[160px] w-full items-center justify-center border-b border-stone-900/10 bg-surface/50 p-2"
      >
        {src ? (
          <img
            src={src}
            alt={`Imagen de respuesta ${label}`}
            className="max-h-48 w-full object-contain"
          />
        ) : (
          <span className="label-mono text-stone-500">
            Cargando imagen…
          </span>
        )}
      </button>
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="label-mono text-stone-500">
          {label}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-3 text-[11px] text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:opacity-50"
        >
          {deleting ? "Eliminando…" : "Eliminar ✕"}
        </button>
      </div>
    </div>
  );
}

export default function BriefPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const answersRef = useRef<Record<string, string>>({});
  const transcriptionsRef = useRef<Record<string, string>>({});
  const [itemFeedback, setItemFeedback] = useState<Record<string, string>>({});
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<Record<string, string>>({});
  const [progressData, setProgressData] = useState<{ progress: number; total_questions: number; answered_questions: number; status: string } | null>(null);

  // Accordion UI state (pure view state; does not touch autosave logic).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandInitRef = useRef(false);
  const [savingAll, setSavingAll] = useState(false);
  const [flowMessage, setFlowMessage] = useState("");

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
  // The studio releases the brief explicitly: until then the client only sees
  // references and a waiting state, and answer actions are hard-disabled.
  const briefSent = Boolean(project?.brief_sent_at);
  // Null/undefined-safe: the questionnaire must never render answerable while
  // the send timestamp is unknown (initial load) or absent.
  const awaitingBrief = !project?.brief_sent_at;

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
          if (!item?.id) return;
          const localAnswer = answersRef.current[item.id];
          const localTranscription = transcriptionsRef.current[item.id];
          const serverAnswer = item.answer;
          const serverTranscription = item.audio_transcription || item.transcription;
          // The refs are the UI source of truth for pending (debounced) edits.
          // A reload triggered by an image/audio upload or delete must not
          // overwrite them with stale server values: the pending 800ms timer
          // reads these refs when it fires, so that would discard text the
          // client typed inside the debounce window. Local keys win, including
          // an intentional empty string (the client cleared the field).
          if (localAnswer !== undefined || serverAnswer) {
            ansMap[item.id] = localAnswer !== undefined ? localAnswer : serverAnswer!;
          }
          if (localTranscription !== undefined || serverTranscription) {
            trMap[item.id] = localTranscription !== undefined ? localTranscription : serverTranscription!;
          }
        });
        answersRef.current = ansMap;
        transcriptionsRef.current = trMap;
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

  const triggerAutosave = useCallback((itemId: string) => {
    // Never queue an answer before the studio releases the brief.
    if (!briefSent) return;
    setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Guardando…" }));
    if (autosaveTimers.current[itemId]) {
      clearTimeout(autosaveTimers.current[itemId]);
    }
    autosaveTimers.current[itemId] = setTimeout(async () => {
      try {
        // Send the latest answer + transcription together: both fields share
        // the same 800ms debounce so neither edit can overwrite the other.
        const body: Record<string, string> = {
          answer: answersRef.current[itemId] ?? "",
        };
        const transcription = transcriptionsRef.current[itemId];
        if (transcription !== undefined) {
          body.transcription = transcription;
        }
        const res = await apiFetch(
          `/api/v1/projects/${projectId}/brief/items/${itemId}/autosave`,
          { method: "PATCH", body: JSON.stringify(body) }
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
  }, [projectId, briefSent]);

  function handleAnswerChange(itemId: string, value: string) {
    answersRef.current = { ...answersRef.current, [itemId]: value };
    setAnswers(answersRef.current);
    triggerAutosave(itemId);
  }

  function handleTranscriptionChange(itemId: string, value: string) {
    transcriptionsRef.current = { ...transcriptionsRef.current, [itemId]: value };
    setTranscriptions(transcriptionsRef.current);
    triggerAutosave(itemId);
  }

  // Audio recording handlers
  async function startRecording(itemId: string) {
    if (!briefSent) return;
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
    if (!briefSent) return;
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
        const transcription = updated?.audio_transcription || updated?.transcription;
        const nextTranscriptions = { ...transcriptionsRef.current };
        if (transcription) {
          nextTranscriptions[itemId] = transcription;
        } else {
          delete nextTranscriptions[itemId];
        }
        transcriptionsRef.current = nextTranscriptions;
        setTranscriptions(nextTranscriptions);
        if (typeof updated?.progress === "number") {
          setProgressData((prev) => prev ? { ...prev, progress: updated.progress! } : null);
        }
        setItemFeedback((prev) => ({
          ...prev,
          [itemId]: transcription
            ? "Audio y transcripción guardados"
            : "Audio guardado — transcripción no disponible",
        }));
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
    if (!briefSent) return;
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
        if (typeof updated?.progress === "number") {
          setProgressData((prev) => prev ? { ...prev, progress: updated.progress! } : null);
        }
        setItemFeedback((prev) => ({ ...prev, [itemId]: "Imagen guardada correctamente" }));
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({
          ...prev,
          [itemId]: res.status === 409
            ? "Máximo 2 imágenes por pregunta"
            : extractDetail(data, "Error al subir imagen"),
        }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al subir imagen" }));
    }
  }

  async function deleteImageResponse(itemId: string, imageId: string) {
    setDeletingImageId(imageId);
    setItemFeedback((prev) => ({ ...prev, [itemId]: "Eliminando imagen…" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}/images/${imageId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        setZoomedImage(null);
        if (typeof updated?.progress === "number") {
          setProgressData((prev) => prev ? { ...prev, progress: updated.progress! } : null);
        }
        setItemFeedback((prev) => ({ ...prev, [itemId]: "Imagen eliminada" }));
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({ ...prev, [itemId]: extractDetail(data, "Error al eliminar imagen") }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al eliminar imagen" }));
    } finally {
      setDeletingImageId(null);
    }
  }

  async function deleteAudioResponse(itemId: string) {
    setDeletingAudioId(itemId);
    setItemFeedback((prev) => ({ ...prev, [itemId]: "Eliminando nota de voz…" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}/audio`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        // The server dropped the transcription mirrors; drop the local ones
        // too so a reload (or a pending autosave) does not revive them.
        const nextTranscriptions = { ...transcriptionsRef.current };
        delete nextTranscriptions[itemId];
        transcriptionsRef.current = nextTranscriptions;
        setTranscriptions(nextTranscriptions);
        if (typeof updated?.progress === "number") {
          setProgressData((prev) => prev ? { ...prev, progress: updated.progress! } : null);
        }
        setItemFeedback((prev) => ({ ...prev, [itemId]: "Nota de voz eliminada" }));
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({ ...prev, [itemId]: extractDetail(data, "Error al eliminar la nota de voz") }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al eliminar la nota de voz" }));
    } finally {
      setDeletingAudioId(null);
    }
  }

  async function confirmQuestion(itemId: string, confirmed: boolean) {
    if (!briefSent) return;
    setConfirmingId(itemId);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}/confirm`,
        { method: "POST", body: JSON.stringify({ confirmed }) }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        setItemFeedback((prev) => ({
          ...prev,
          [itemId]: confirmed ? "Pregunta confirmada" : "Pregunta reabierta",
        }));
        // Confirming advances to the next question (like "Siguiente pregunta");
        // on the last question the row stays open showing its confirmed state.
        if (confirmed) {
          goToNextQuestion(itemId);
        }
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({ ...prev, [itemId]: extractDetail(data, "Error al confirmar la pregunta") }));
      }
    } catch {
      setItemFeedback((prev) => ({ ...prev, [itemId]: "Error de red al confirmar" }));
    } finally {
      setConfirmingId(null);
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

  // A question counts as answered with text, transcription, audio or images.
  function questionAnswered(item: BriefItem): boolean {
    const answer = (answers[item.id] ?? item.answer ?? "").trim();
    const transcription = (
      transcriptions[item.id] ??
      item.transcription ??
      item.audio_transcription ??
      ""
    ).trim();
    return Boolean(
      answer || transcription || item.audio_url || (item.images?.length ?? 0) > 0
    );
  }

  const answeredCount =
    progressData?.answered_questions ??
    questions.filter(questionAnswered).length;
  const totalCount = progressData?.total_questions ?? questions.length;
  const confirmedCount = questions.filter((q) => q.client_confirmed).length;
  const allConfirmed =
    questions.length > 0 && questions.every((q) => q.client_confirmed);
  const isSaving = Object.values(autosaveStatus).some(
    (status) => status === "Guardando…"
  );

  // Open the first unanswered question once, after the initial load.
  useEffect(() => {
    if (expandInitRef.current) return;
    const qs = items.filter((it) => it.item_type === "question");
    if (qs.length === 0) return;
    expandInitRef.current = true;
    const firstPending = qs.find(
      (q) =>
        !(
          (q.answer ?? "").trim() ||
          (q.audio_transcription ?? q.transcription ?? "").trim() ||
          q.audio_url ||
          (q.images?.length ?? 0) > 0
        )
    );
    setExpandedId((firstPending ?? qs[0]).id);
  }, [items]);

  function scrollToQuestion(itemId: string) {
    requestAnimationFrame(() => {
      document
        .getElementById(`brief-question-${itemId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function goToNextQuestion(currentId: string) {
    const index = questions.findIndex((q) => q.id === currentId);
    const next = questions[index + 1];
    if (!next) return;
    setExpandedId(next.id);
    scrollToQuestion(next.id);
  }

  // Flush pending debounced autosaves immediately (same PATCH endpoint).
  async function saveProgressNow() {
    if (!briefSent) return;
    const pendingIds = Object.keys(autosaveTimers.current);
    if (pendingIds.length === 0) {
      setFlowMessage("Todo el progreso ya está guardado");
      return;
    }
    setSavingAll(true);
    setFlowMessage("");
    let hadError = false;
    for (const itemId of pendingIds) {
      clearTimeout(autosaveTimers.current[itemId]);
      delete autosaveTimers.current[itemId];
      try {
        const body: Record<string, string> = {
          answer: answersRef.current[itemId] ?? "",
        };
        const transcription = transcriptionsRef.current[itemId];
        if (transcription !== undefined) {
          body.transcription = transcription;
        }
        const res = await apiFetch(
          `/api/v1/projects/${projectId}/brief/items/${itemId}/autosave`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
        if (res.ok) {
          const result = await res.json();
          setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Guardado" }));
          if (result.progress !== undefined) {
            setProgressData((prev) =>
              prev
                ? {
                    ...prev,
                    progress: result.progress,
                    answered_questions:
                      result.answered_questions ?? prev.answered_questions,
                    status: result.status ?? prev.status,
                  }
                : prev
            );
          }
        } else {
          hadError = true;
          setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Error al guardar" }));
        }
      } catch {
        hadError = true;
        setAutosaveStatus((prev) => ({ ...prev, [itemId]: "Error de red" }));
      }
    }
    setSavingAll(false);
    setFlowMessage(
      hadError
        ? "Hubo un error al guardar; reintenta"
        : "Progreso guardado"
    );
  }

  // The backend completes the brief and notifies collaborators automatically
  // once every question is answered; the client's explicit confirmation seal
  // is what gates the "Enviar Brief" button in the UI.
  function handleSendBrief() {
    if (!briefSent) return;
    if (allConfirmed) {
      setFlowMessage("Brief enviado ✓ — el estudio ya fue notificado");
      return;
    }
    const unconfirmed = questions.filter((q) => !q.client_confirmed);
    const target = unconfirmed[0];
    if (target) {
      setExpandedId(target.id);
      scrollToQuestion(target.id);
      setFlowMessage(
        `Faltan ${unconfirmed.length} pregunta${unconfirmed.length === 1 ? "" : "s"} por confirmar`
      );
    }
  }

  return (
    <section className="brief-editorial">
      {/* Editorial ficha header: micro-label, serif title, architectural progress line. */}
      <div className="mb-8 border-b border-stone-900/15 pb-6">
        <p className="label-mono text-stone-500">
          01 · Brief del proyecto
        </p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          {project?.title ?? "Brief"}
        </h1>
        <div className="mt-5 flex flex-col gap-2">
          <div className="h-[2px] w-full bg-stone-200">
            <div
              className="h-full bg-stone-800 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-tech text-stone-500">
              {answeredCount} / {totalCount} respondidas · {progressPercent}% ·{" "}
              {confirmedCount} confirmadas
            </span>
            <span className="type-editorial text-[11px] italic text-stone-500">
              {isSaving ? "Guardando…" : "Progreso autoguardado"}
            </span>
          </div>
        </div>
      </div>

      {message && (
        <p className="mb-4 rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          {message}
        </p>
      )}

      {project && project.status !== "active" && (
        <p className="mb-4 rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          Este proyecto no está activo: la edición del brief está deshabilitada.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">Cargando…</p>
      ) : (
        <>
          {awaitingBrief ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6">
              <p className="type-tech text-stone-500">Brief en preparación</p>
              <p className="type-editorial text-lg leading-snug text-stone-950 md:text-xl">
                El estudio está preparando tu brief. Podrás responder cuando el equipo lo confirme y envíe.
              </p>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="type-ui min-h-[44px] self-start rounded-lg border border-stone-900/25 px-5 py-2 text-xs text-stone-800 transition-colors duration-300 hover:border-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
          ) : (
            <>
              <h2 className="type-subtitle-caps text-xl text-stone-900">
                Cuestionario
              </h2>
              {questions.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">
                  Todavía no hay preguntas del estudio.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {questions.map((item, index) => {
                    // Legacy / incomplete records must never break the view.
                    const images = item?.images ?? [];
                    const imageCount = Math.min(images.length, 2);
                    const nextImageLabel = String(Math.min(imageCount + 1, 2)).padStart(2, "0");
                    const transcription =
                      transcriptions[item.id] ??
                      item.transcription ??
                      item.audio_transcription ??
                      "";
                    const hasTranscription = Boolean(transcription.trim());
                    const expanded = expandedId === item.id;
                    const answered = questionAnswered(item);
                    const confirmed = Boolean(item.client_confirmed);
                    const isLast = index === questions.length - 1;
                    return (
                      <div
                        key={item.id}
                        id={`brief-question-${item.id}`}
                        className={`scroll-mt-4 rounded-2xl border transition-all duration-300 ${
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
                          aria-controls={`brief-panel-${item.id}`}
                          onClick={() => setExpandedId(expanded ? null : item.id)}
                          className="flex min-h-[44px] w-full cursor-pointer items-center gap-4 text-left"
                        >
                          <span className="label-mono text-stone-600">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`flex-1 ${
                              expanded
                                ? "type-editorial text-lg leading-snug text-stone-950 md:text-xl"
                                : "text-[15px] font-normal text-stone-800 md:text-base"
                            }`}
                          >
                            {item.prompt}
                          </span>
                          {!expanded && confirmed && (
                            <span className="hidden items-center gap-2 type-editorial text-[11px] italic text-[#44544A] sm:flex">
                              <span
                                aria-hidden="true"
                                className="dot-organic h-1.5 w-1.5 shrink-0 bg-[#5F7161]"
                              />
                              Confirmada
                            </span>
                          )}
                          {!expanded && !confirmed && answered && (
                            <span className="hidden type-editorial text-[11px] italic text-stone-500 sm:inline">
                              Respondida
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
                            id={`brief-panel-${item.id}`}
                            className="mt-5 flex flex-col gap-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="type-tech text-stone-500">
                                {item.category}
                              </span>
                              {autosaveStatus[item.id] && (
                                <span className="type-editorial text-[11px] italic text-stone-500">
                                  {autosaveStatus[item.id]}
                                </span>
                              )}
                            </div>

                            <textarea
                              value={answers[item.id] ?? item.answer ?? ""}
                              onChange={(event) =>
                                handleAnswerChange(item.id, event.target.value)
                              }
                              placeholder="Escribe tu respuesta aquí (autoguardado en tiempo real)..."
                              maxLength={10000}
                              className="type-ui min-h-[120px] w-full rounded-xl border border-stone-900/15 bg-surface/70 p-4 text-[15px] text-stone-900 transition-colors duration-300 placeholder:text-stone-500 focus:border-stone-900/45 focus:bg-background"
                            />

                            {/* Multimodal response: images, voice and editable transcription */}
                            <div className="flex flex-col gap-3 border-t border-stone-900/10 pt-4">
                              <p className="type-tech text-stone-500">
                                Respuesta multimodal
                              </p>

                              {imageCount > 0 && (
                                <div className="grid grid-cols-2 gap-3">
                                  {images.slice(0, 2).map((image, imageIndex) => (
                                    <ImagePreview
                                      key={image?.id ?? imageIndex}
                                      image={image}
                                      index={imageIndex}
                                      deleting={deletingImageId === image?.id}
                                      onZoom={(src, alt) => setZoomedImage({ src, alt })}
                                      onDelete={() =>
                                        image?.id && deleteImageResponse(item.id, image.id)
                                      }
                                    />
                                  ))}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-3">
                                {recordingId === item.id ? (
                                  <button
                                    type="button"
                                    onClick={stopRecording}
                                    className="type-ui flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-900 bg-stone-900 px-3 py-2 text-xs text-background transition-colors duration-300"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="dot-organic h-1.5 w-1.5 animate-pulse bg-background"
                                    />
                                    Grabando — detener
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => startRecording(item.id)}
                                    disabled={!isActive}
                                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-3 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {item.audio_url
                                      ? "Regrabar nota de voz"
                                      : "Grabar audio"}
                                  </button>
                                )}

                                <label
                                  aria-disabled={imageCount >= 2 || !isActive}
                                  className={`flex min-h-[44px] items-center gap-2 rounded-xl border border-dashed border-stone-900/20 px-4 py-2 transition-colors duration-300 ${
                                    imageCount >= 2 || !isActive
                                      ? "cursor-not-allowed opacity-50"
                                      : "cursor-pointer hover:border-stone-900/45"
                                  }`}
                                >
                                  <span className="label-mono text-stone-600">
                                    Añadir imagen {nextImageLabel}/02
                                  </span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    disabled={imageCount >= 2 || !isActive}
                                    className="sr-only"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) uploadImageResponse(item.id, f);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>

                              {(item.audio_url || hasTranscription) && (
                                <div className="flex flex-col gap-3 rounded-xl border border-stone-900/15 bg-surface/50 p-4">
                                  {item.audio_url && (
                                    <div className="flex flex-col gap-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="type-tech text-stone-500">
                                          Nota de voz
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => deleteAudioResponse(item.id)}
                                          disabled={deletingAudioId === item.id}
                                          className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-3 text-[11px] text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:opacity-50"
                                        >
                                          {deletingAudioId === item.id
                                            ? "Eliminando…"
                                            : "Eliminar ✕"}
                                        </button>
                                      </div>
                                      {/* key forces a remount (fresh blob fetch) after re-recording:
                                          the /media URL is stable across uploads. */}
                                      <VoiceNotePlayer
                                        key={item.updated_at ?? item.id}
                                        url={item.audio_url}
                                      />
                                    </div>
                                  )}
                                  <div className="flex flex-col gap-2 border-t border-stone-900/10 pt-3">
                                    <label
                                      htmlFor={`transcription-${item.id}`}
                                      className="type-ui text-xs text-stone-500"
                                    >
                                      Transcripción editable
                                    </label>
                                    <textarea
                                      id={`transcription-${item.id}`}
                                      value={transcription}
                                      onChange={(event) =>
                                        handleTranscriptionChange(item.id, event.target.value)
                                      }
                                      placeholder={
                                        hasTranscription ? undefined : "Escribe tu respuesta…"
                                      }
                                      maxLength={10000}
                                      className="type-ui min-h-[100px] w-full rounded-xl border border-stone-900/15 bg-background p-4 text-[15px] text-stone-900 transition-colors duration-300 placeholder:text-stone-500 focus:border-stone-900/45 focus:bg-background"
                                    />
                                    {!hasTranscription && (
                                      <p className="type-editorial text-[11px] italic text-stone-500">
                                        Transcripción no disponible — escribe tu respuesta
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {itemFeedback[item.id] && (
                              <p className="text-xs text-stone-500">
                                {itemFeedback[item.id]}
                              </p>
                            )}

                            {!confirmed && !answered && (
                              <p className="type-editorial text-[11px] italic text-stone-500">
                                Añade una respuesta para poder confirmar la pregunta.
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-3 border-t border-stone-900/10 pt-4">
                              <button
                                type="button"
                                onClick={() => confirmQuestion(item.id, !confirmed)}
                                disabled={confirmingId === item.id || (!confirmed && !answered)}
                                className={`type-ui min-h-[44px] rounded-lg px-4 py-2 text-xs transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                                  confirmed
                                    ? "bg-[#5F7161] text-background hover:bg-[#4E5D50]"
                                    : "border border-[#5F7161]/50 text-[#44544A] hover:bg-[#5F7161] hover:text-white"
                                }`}
                              >
                                {confirmingId === item.id
                                  ? "Guardando…"
                                  : confirmed
                                    ? "Confirmada ✓ — reabrir"
                                    : "Confirmar respuesta ✓"}
                              </button>
                              {!isLast && (
                                <button
                                  type="button"
                                  onClick={() => goToNextQuestion(item.id)}
                                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white"
                                >
                                  Siguiente pregunta →
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Flow actions: flush autosave / confirm completion. */}
              {questions.length > 0 && (
                <div className="mt-6 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={saveProgressNow}
                      disabled={savingAll}
                      className="type-ui min-h-[44px] rounded-lg border border-stone-900/25 px-5 py-2 text-xs text-stone-800 transition-colors duration-300 hover:border-stone-900 disabled:opacity-50"
                    >
                      {savingAll ? "Guardando…" : "Guardar progreso"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendBrief}
                      className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800"
                    >
                      {allConfirmed ? "Brief enviado ✓" : "Enviar Brief"}
                    </button>
                  </div>
                  {flowMessage && (
                    <p className="type-editorial text-[13px] italic text-stone-600">
                      {flowMessage}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <h2 className="type-subtitle-caps mt-10 text-xl text-stone-900">
            Referencias
          </h2>
          <form
            onSubmit={uploadReference}
            className="mt-4 flex flex-col gap-4 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6"
          >
            <label className="flex flex-col gap-1">
              <span className="type-ui text-xs text-stone-500">
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

            <label className="flex flex-col gap-1">
              <span className="type-ui text-xs text-stone-500">
                Nota (opcional)
              </span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 placeholder:text-stone-500"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-stone-900/20 bg-background/60 px-4 transition-colors duration-300 hover:border-stone-900/45">
              <span className="truncate label-mono text-stone-600">
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

            {uploadMessage && (
              <p className="text-sm text-stone-600">{uploadMessage}</p>
            )}

            <button
              type="submit"
              disabled={uploading || !isActive || !file}
              className="type-ui min-h-[44px] self-start rounded-lg border border-stone-900/25 px-5 py-2 text-xs text-stone-800 transition-colors duration-300 hover:border-stone-900 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? "Subiendo…" : "Subir referencia"}
            </button>
          </form>

          {references.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">Todavía no hay referencias.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {references.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-stone-900/10 bg-surface/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-[15px] font-normal text-stone-800">
                      {item.file_name}
                    </p>
                    <p className="label-mono mt-1 text-stone-500">
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

      {/* Full-screen image zoom: tap anywhere (or Esc) closes, no hover needed. */}
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
