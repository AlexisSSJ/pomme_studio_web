"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";

export interface BriefReportData {
  id: string;
  project_id: string;
  brief_id: string;
  status: "draft" | "generated" | "edited";
  content_markdown: string;
  model_used: string | null;
  generated_by: string | null;
  updated_by: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BriefReportPanelProps {
  projectId: string;
  projectTitle?: string;
  briefSubmittedAt?: string | null;
  answeredQuestions: number;
  totalQuestions: number;
}

function slugify(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (cleaned || "brief").slice(0, 60);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`t-${keyIdx++}`}>
          {text.slice(lastIndex, match.index)}
        </Fragment>
      );
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-stone-950">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`c-${keyIdx++}`}
          className="border border-stone-900/15 bg-surface px-1.5 py-0.5 font-mono text-[12px] text-stone-900"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`i-${keyIdx++}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`e-${keyIdx++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

function SafeMarkdownRenderer({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const trimmed = lines[idx].trim();

    if (!trimmed) {
      idx++;
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(
        <hr key={`hr-${idx}`} className="my-5 border-t border-stone-900/20" />
      );
      idx++;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h3
          key={`h1-${idx}`}
          className="type-title mt-2 border-b border-stone-900/20 pb-3 text-2xl text-stone-950"
        >
          {renderInlineMarkdown(trimmed.slice(2).trim())}
        </h3>
      );
      idx++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h4
          key={`h2-${idx}`}
          className="type-subtitle-caps mt-7 border-b border-stone-900/15 pb-2 text-base text-stone-950"
        >
          {renderInlineMarkdown(trimmed.slice(3).trim())}
        </h4>
      );
      idx++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h5
          key={`h3-${idx}`}
          className="type-ui mt-5 text-sm font-semibold uppercase tracking-wide text-stone-900"
        >
          {renderInlineMarkdown(trimmed.slice(4).trim())}
        </h5>
      );
      idx++;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (idx < lines.length && lines[idx].trim().startsWith("> ")) {
        quoteLines.push(lines[idx].trim().slice(2).trim());
        idx++;
      }
      blocks.push(
        <blockquote
          key={`bq-${idx}`}
          className="my-4 border-l-2 border-stone-900 bg-surface/70 px-4 py-3 text-sm italic text-stone-700"
        >
          {renderInlineMarkdown(quoteLines.join(" "))}
        </blockquote>
      );
      continue;
    }

    if (/^(?:[-*+])\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (idx < lines.length && /^(?:[-*+])\s+/.test(lines[idx].trim())) {
        listItems.push(lines[idx].trim().replace(/^(?:[-*+])\s+/, ""));
        idx++;
      }
      blocks.push(
        <ul key={`ul-${idx}`} className="my-3 space-y-2 pl-1">
          {listItems.map((li, liIdx) => (
            <li
              key={liIdx}
              className="flex items-start gap-3 text-[15px] leading-relaxed text-stone-800"
            >
              <span
                aria-hidden="true"
                className="type-tech mt-1.5 shrink-0 text-stone-500"
              >
                —
              </span>
              <span>{renderInlineMarkdown(li)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (idx < lines.length && /^\d+\.\s+/.test(lines[idx].trim())) {
        listItems.push(lines[idx].trim().replace(/^\d+\.\s+/, ""));
        idx++;
      }
      blocks.push(
        <ol key={`ol-${idx}`} className="my-3 space-y-2 pl-1">
          {listItems.map((li, liIdx) => (
            <li
              key={liIdx}
              className="flex items-start gap-3 text-[15px] leading-relaxed text-stone-800"
            >
              <span className="type-tech mt-1 shrink-0 text-stone-500">
                {String(liIdx + 1).padStart(2, "0")}.
              </span>
              <span>{renderInlineMarkdown(li)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    idx++;
    while (
      idx < lines.length &&
      lines[idx].trim() &&
      !/^(?:#{1,3}\s|> |[-*+]\s|\d+\.\s|[-*_]{3,}$)/.test(lines[idx].trim())
    ) {
      paragraphLines.push(lines[idx].trim());
      idx++;
    }
    blocks.push(
      <p
        key={`p-${idx}`}
        className="type-editorial my-3 text-[15px] leading-relaxed text-stone-800"
      >
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}

export default function BriefReportPanel({
  projectId,
  projectTitle,
  briefSubmittedAt,
  answeredQuestions,
  totalQuestions,
}: BriefReportPanelProps) {
  const [report, setReport] = useState<BriefReportData | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "md" | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const hasUnsavedChanges = Boolean(
    report && draftMarkdown !== report.content_markdown
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/brief/report`);
      if (res.ok) {
        const data: BriefReportData = await res.json();
        setReport(data);
        setDraftMarkdown(data.content_markdown);
      } else if (res.status === 404) {
        setReport(null);
        setDraftMarkdown("");
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setError(extractDetail(body, "Error al consultar el reporte del brief"));
      }
    } catch {
      setError("Error de conexión al consultar el reporte del brief");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function runGenerate() {
    setConfirmRegenerate(false);
    setGenerating(true);
    setError("");
    setFeedback("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/brief/report/generate`,
        { method: "POST", body: JSON.stringify({}) }
      );
      if (res.ok) {
        const data: BriefReportData = await res.json();
        setReport(data);
        setDraftMarkdown(data.content_markdown);
        setMode("preview");
        setFeedback("Reporte ejecutivo generado y guardado ✓");
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setError(
          extractDetail(
            body,
            `No se pudo generar el reporte con IA (HTTP ${res.status})`
          )
        );
      }
    } catch {
      setError(
        "No se pudo conectar con el servidor al generar el reporte con IA. Intenta nuevamente en unos segundos."
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleGenerateClick() {
    if (report && (report.status === "edited" || hasUnsavedChanges)) {
      setConfirmRegenerate(true);
      return;
    }
    runGenerate();
  }

  async function handleSave() {
    if (!draftMarkdown.trim()) {
      setError("El contenido del reporte no puede estar vacío");
      return;
    }
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/brief/report`, {
        method: "PATCH",
        body: JSON.stringify({ content_markdown: draftMarkdown }),
      });
      if (res.ok) {
        const updated: BriefReportData = await res.json();
        setReport(updated);
        setDraftMarkdown(updated.content_markdown);
        setFeedback("Cambios guardados en el reporte ✓");
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setError(extractDetail(body, "No se pudieron guardar los cambios"));
      }
    } catch {
      setError("Error de conexión al guardar el reporte");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(format: "pdf" | "md") {
    setExporting(format);
    setError("");
    try {
      const url = await apiFetchBlobUrl(
        `/api/v1/projects/${projectId}/brief/report/export?format=${format}`
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `brief-report-${slugify(projectTitle || projectId)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Error al exportar el reporte en ${format.toUpperCase()}`
      );
    } finally {
      setExporting(null);
    }
  }

  const statusLabel = !report
    ? "Sin generar"
    : report.status === "edited"
      ? "Editado por el equipo"
      : "Generado con IA";

  return (
    <div className="mt-10 rounded-2xl border border-stone-900/20 bg-surface/65 p-5 md:p-7">
      <div className="flex flex-col gap-4 border-b border-stone-900/15 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="type-tech text-stone-600">
            02 · Síntesis ejecutiva con IA
          </p>
          <h2 className="type-subtitle-caps mt-1.5 text-xl text-stone-950">
            Reporte Ejecutivo del Brief
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={`type-tech inline-flex items-center gap-2 rounded-lg border px-3 py-1 ${
                report
                  ? "border-[#5F7161]/40 bg-[#EEF2EC] text-[#44544A]"
                  : "border-stone-900/15 bg-background text-stone-600"
              }`}
            >
              <span
                aria-hidden="true"
                className={`dot-organic h-1.5 w-1.5 shrink-0 ${
                  report ? "bg-[#5F7161]" : "bg-stone-500"
                }`}
              />
              {statusLabel}
            </span>
            {briefSubmittedAt && (
              <span className="type-tech text-stone-600">
                Enviado a revisión · {formatTimestamp(briefSubmittedAt)}
              </span>
            )}
            {report?.updated_at && (
              <span className="type-tech text-stone-500">
                Actualizado · {formatTimestamp(report.updated_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={generating}
            className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? "Generando síntesis…"
              : report
                ? "Regenerar con IA ↗"
                : "Generar Reporte IA ↗"}
          </button>

          {report && (
            <>
              <button
                type="button"
                onClick={() => handleExport("pdf")}
                disabled={exporting !== null}
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/25 bg-background px-4 py-2 text-xs text-stone-900 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === "pdf" ? "Exportando PDF…" : "Descargar PDF ↗"}
              </button>
              <button
                type="button"
                onClick={() => handleExport("md")}
                disabled={exporting !== null}
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/25 bg-background px-4 py-2 text-xs text-stone-900 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === "md" ? "Exportando .md…" : "Descargar .md ↗"}
              </button>
            </>
          )}
        </div>
      </div>

      {confirmRegenerate && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-stone-900/30 bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-ui text-xs text-stone-800">
            Este reporte contiene ediciones del equipo. ¿Deseas sobrescribirlo con
            una nueva síntesis generada por IA?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runGenerate}
              className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-4 py-2 text-xs text-background hover:bg-stone-800"
            >
              Confirmar regeneración
            </button>
            <button
              type="button"
              onClick={() => setConfirmRegenerate(false)}
              className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 hover:bg-stone-900 hover:text-background"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="type-ui mt-4 rounded-xl border border-stone-900/30 bg-background p-4 text-xs text-stone-900">
          {error}
        </p>
      )}

      {feedback && (
        <p className="type-editorial mt-4 text-sm italic text-[#44544A]">
          {feedback}
        </p>
      )}

      {loading ? (
        <p className="type-ui mt-5 text-sm text-stone-600">
          Consultando reporte ejecutivo…
        </p>
      ) : !report ? (
        <div className="mt-5 rounded-xl border border-dashed border-stone-900/20 bg-background/70 p-6">
          <p className="type-editorial text-base text-stone-800">
            Aún no se ha generado el reporte ejecutivo del brief.
          </p>
          <p className="type-ui mt-2 text-xs leading-relaxed text-stone-600">
            Al hacer clic en <strong>Generar Reporte IA</strong> (o cuando el
            cliente envíe el brief a revisión), se analizarán las{" "}
            {answeredQuestions} de {totalQuestions} respuestas registradas,
            transcripciones de audio e imágenes de referencia para producir una
            síntesis editable y descargable en PDF o Markdown.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-900/15 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={`type-ui min-h-[44px] rounded-lg px-4 py-2 text-xs transition-colors ${
                  mode === "preview"
                    ? "bg-stone-900 text-background"
                    : "border border-stone-900/20 bg-background text-stone-700 hover:border-stone-900"
                }`}
              >
                Vista previa
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={`type-ui min-h-[44px] rounded-lg px-4 py-2 text-xs transition-colors ${
                  mode === "edit"
                    ? "bg-stone-900 text-background"
                    : "border border-stone-900/20 bg-background text-stone-700 hover:border-stone-900"
                }`}
              >
                Editar Markdown
              </button>
            </div>
            {hasUnsavedChanges && (
              <span className="type-tech text-stone-700">
                Cambios sin guardar
              </span>
            )}
          </div>

          {mode === "preview" ? (
            <div className="mt-4 rounded-xl border border-stone-900/15 bg-background p-5 md:p-7">
              <SafeMarkdownRenderer content={draftMarkdown} />
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <label className="sr-only" htmlFor="brief-report-markdown-editor">
                Contenido Markdown del reporte ejecutivo
              </label>
              <textarea
                id="brief-report-markdown-editor"
                value={draftMarkdown}
                onChange={(e) => setDraftMarkdown(e.target.value)}
                rows={18}
                maxLength={100000}
                className="min-h-[380px] w-full rounded-xl border border-stone-900/25 bg-background p-4 font-mono text-[13px] leading-relaxed text-stone-900 focus:border-stone-900"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="type-tech text-stone-500">
                  {draftMarkdown.length.toLocaleString("es-MX")} caracteres ·
                  Markdown
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  {hasUnsavedChanges && (
                    <button
                      type="button"
                      onClick={() => setDraftMarkdown(report.content_markdown)}
                      disabled={saving}
                      className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 hover:bg-stone-900 hover:text-background disabled:opacity-50"
                    >
                      Descartar cambios
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges}
                    className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Guardando…" : "Guardar cambios ↗"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
