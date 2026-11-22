"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, extractDetail } from "@/lib/api";

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

interface PendingBriefInfo {
  has_pending: boolean;
  total_questions: number;
  answered_questions: number;
  progress: number;
  status: string;
  pending_briefs?: Array<{ project_id: string; project_title: string; progress: number }>;
}

export default function PortalProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingBrief, setPendingBrief] = useState<PendingBriefInfo | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadPortalData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, pendingRes] = await Promise.all([
        apiFetch("/api/v1/projects"),
        apiFetch("/api/v1/brief/pending").catch(() => null),
      ]);

      if (projectsRes.ok) {
        setProjects(await projectsRes.json());
      } else {
        const data: unknown = await projectsRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar proyectos"));
      }

      if (pendingRes && pendingRes.ok) {
        setPendingBrief(await pendingRes.json());
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Portal de Clientes</h1>

      {/* Indicador de Brief Pendiente */}
      {pendingBrief && pendingBrief.has_pending && (
        <div className="mt-4 border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="label-mono">⚠️ Atención requerida</p>
            <p className="text-sm font-semibold mt-1">
              Tienes un brief pendiente de completar ({pendingBrief.progress}% completado).
            </p>
            <p className="text-xs text-muted mt-0.5">
              {pendingBrief.answered_questions} de {pendingBrief.total_questions} preguntas respondidas.
            </p>
          </div>
          {pendingBrief.pending_briefs && pendingBrief.pending_briefs.length > 0 && (
            <Link
              href={`/portal/projects/${pendingBrief.pending_briefs[0].project_id}/brief`}
              className="btn-brutal min-h-[44px] px-4 text-xs bg-foreground text-background inline-flex items-center justify-center gap-2"
            >
              <span>Continuar Brief</span>
              <span aria-hidden="true">↗</span>
            </Link>
          )}
        </div>
      )}

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <h2 className="text-lg tracking-tightest mt-8">Mis proyectos</h2>

      {loading && projects.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : projects.length === 0 ? (
        <p className="mt-4 text-sm">
          Todavía no tienes proyectos asignados.
        </p>
      ) : (
        <div className="grid-brutal mt-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold">{project.title}</p>
                <p className="label-mono mt-1">
                  {project.status} · {project.scope_type || "sin scope"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/portal/projects/${project.id}/brief`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Brief
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
                <Link
                  href={`/portal/projects/${project.id}/moodboard`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Moodboard
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
                <Link
                  href={`/portal/projects/${project.id}/etapas`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Etapas
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
                <Link
                  href={`/portal/projects/${project.id}/especificaciones`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Catálogo FF&E
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
                <Link
                  href={`/portal/projects/${project.id}/reuniones`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Reuniones
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
