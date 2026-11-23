"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";

interface Project {
  id: string;
  title: string;
  scope_type: string | null;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
  created_at: string;
}

interface BriefPending {
  has_pending_brief: boolean;
  progress: number;
  total_questions: number;
  answered_questions: number;
}

export default function PortalProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<BriefPending | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resProject = await apiFetch(`/api/v1/projects/${projectId}`);
      if (resProject.ok) {
        setProject(await resProject.json());
      } else {
        const data: unknown = await resProject.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }
      const resBrief = await apiFetch(
        `/api/v1/projects/${projectId}/brief/pending`
      ).catch(() => null);
      if (resBrief && resBrief.ok) {
        setBrief(await resBrief.json());
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

  return (
    <section>
      <h1 className="type-title text-xl">Resumen del proyecto</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {brief && brief.has_pending_brief && (
        <div className="mt-4 flex flex-col gap-3 border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="label-mono">⚠️ Brief pendiente</p>
            <p className="mt-1 text-sm font-semibold">
              {brief.progress}% completado · {brief.answered_questions} de{" "}
              {brief.total_questions} preguntas respondidas.
            </p>
          </div>
          <Link
            href={`/portal/projects/${projectId}/brief`}
            className="btn-brutal min-h-[44px] bg-foreground px-4 text-xs text-background inline-flex items-center justify-center gap-2"
          >
            <span>Continuar brief</span>
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      )}

      {loading && !project ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : project ? (
        <div className="grid-brutal mt-4 grid-cols-1 sm:grid-cols-2">
          <div className="p-4">
            <p className="label-mono">01 · Estado</p>
            <p className="type-tech mt-1">{project.status}</p>
          </div>
          <div className="p-4">
            <p className="label-mono">02 · Scope</p>
            <p className="type-tech mt-1">
              {project.scope_type || "sin scope"}
            </p>
          </div>
          <div className="p-4">
            <p className="label-mono">03 · Rondas de cambios</p>
            <p className="type-tech mt-1">
              {project.remaining_rounds}/{project.included_rounds}
            </p>
          </div>
          <div className="p-4">
            <p className="label-mono">04 · Pago final</p>
            <p className="type-tech mt-1">
              {project.balance_paid ? "PAGADO" : "PENDIENTE"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
