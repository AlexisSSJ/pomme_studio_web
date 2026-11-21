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
  const [itemFeedback, setItemFeedback] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState<"branding" | "interior" | "general">(
    "branding"
  );
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isActive = project?.status === "active";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, briefRes] = await Promise.all([
        apiFetch("/api/v1/projects"),
        apiFetch(`/api/v1/projects/${projectId}/brief`),
      ]);

      if (projectsRes.ok) {
        const projects: Project[] = await projectsRes.json();
        setProject(
          projects.find((candidate) => candidate.id === projectId) ?? null
        );
      }

      if (briefRes.ok) {
        setItems(await briefRes.json());
      } else {
        const data: unknown = await briefRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el brief"));
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

  async function saveAnswer(itemId: string) {
    const answer = (answers[itemId] ?? "").trim();
    if (!answer) {
      setItemFeedback((prev) => ({
        ...prev,
        [itemId]: "La respuesta no puede estar vacía",
      }));
      return;
    }

    setSavingId(itemId);
    setItemFeedback((prev) => ({ ...prev, [itemId]: "Guardando…" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/items/${itemId}`,
        { method: "PATCH", body: JSON.stringify({ answer }) }
      );
      if (res.ok) {
        const updated: BriefItem = await res.json();
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );
        setAnswers((prev) => ({ ...prev, [updated.id]: updated.answer ?? "" }));
        setItemFeedback((prev) => ({
          ...prev,
          [itemId]: "Respuesta guardada",
        }));
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setItemFeedback((prev) => ({
          ...prev,
          [itemId]: extractDetail(data, "Error al guardar la respuesta"),
        }));
      }
    } catch {
      setItemFeedback((prev) => ({
        ...prev,
        [itemId]: "Error de conexión con el servidor",
      }));
    } finally {
      setSavingId(null);
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

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Brief</h1>
      {project && <p className="label-mono mt-1">{project.title}</p>}

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
                <div key={item.id} className="flex flex-col gap-3 p-4">
                  <p className="label-mono">
                    {item.category} ·{" "}
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="text-sm font-semibold">{item.prompt}</p>
                  <textarea
                    value={answers[item.id] ?? item.answer ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [item.id]: event.target.value,
                      }))
                    }
                    maxLength={10000}
                    className="min-h-[44px] border border-border bg-background p-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => saveAnswer(item.id)}
                    disabled={savingId === item.id || !isActive}
                    className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                  >
                    {savingId === item.id ? "Guardando…" : "Guardar respuesta"}
                    <span className="btn-brutal__arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                  {itemFeedback[item.id] && (
                    <p className="text-sm">{itemFeedback[item.id]}</p>
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
