"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

interface Project {
  id: string;
  title: string;
  status: string;
  scope_type: string | null;
}

interface BriefItem {
  id: string;
  item_type: "question" | "reference";
  category: "branding" | "interior" | "general";
  prompt: string | null;
  answer: string | null;
  note: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminBriefPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<"branding" | "interior" | "general">(
    "branding"
  );
  const [creating, setCreating] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const isActive = project?.status === "active";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectRes, briefRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/brief`),
      ]);

      if (projectRes.ok) {
        setProject(await projectRes.json());
      } else {
        const data: unknown = await projectRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
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
              {questions.map((item, index) => (
                <div key={item.id} className="flex flex-col gap-3 p-4">
                  <p className="label-mono">
                    {item.category} ·{" "}
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="text-sm font-semibold">{item.prompt}</p>
                  <div>
                    <p className="label-mono">
                      {item.answer
                        ? "RESPUESTA DEL CLIENTE"
                        : "SIN RESPUESTA"}
                    </p>
                    {item.answer && (
                      <p className="mt-1 text-sm">{item.answer}</p>
                    )}
                  </div>
                </div>
              ))}
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
