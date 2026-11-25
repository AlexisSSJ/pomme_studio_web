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
    <section className="brief-editorial">
      <div className="mb-8 border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-600">ESPACIO DEL CLIENTE</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Portal de Clientes
        </h1>
      </div>

      {/* Indicador de Brief Pendiente */}
      {pendingBrief && pendingBrief.has_pending && (
        <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-stone-900/15 bg-background p-5 shadow-editorial sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex-1">
            <p className="type-tech text-stone-500">ATENCIÓN REQUERIDA</p>
            <p className="type-editorial mt-1.5 text-base font-medium text-stone-900">
              Tienes un brief pendiente de completar ({pendingBrief.progress}% completado).
            </p>
            <p className="type-tech mt-1 text-stone-600">
              {pendingBrief.answered_questions} de {pendingBrief.total_questions} preguntas respondidas.
            </p>
            <div className="mt-3 h-[2px] w-full max-w-md overflow-hidden rounded-full bg-stone-900/10">
              <div
                className="h-full bg-stone-900 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, pendingBrief.progress))}%` }}
              />
            </div>
          </div>
          {pendingBrief.pending_briefs && pendingBrief.pending_briefs.length > 0 && (
            <Link
              href={`/portal/projects/${pendingBrief.pending_briefs[0].project_id}/brief`}
              className="type-ui inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 sm:self-center"
            >
              <span>Continuar Brief</span>
              <span aria-hidden="true">↗</span>
            </Link>
          )}
        </div>
      )}

      {message && (
        <p className="type-ui mb-6 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-800">
          {message}
        </p>
      )}

      <div className="mb-4">
        <p className="type-tech text-stone-500">PROYECTOS ASIGNADOS</p>
        <h2 className="type-title mt-1 text-xl text-stone-900">Mis proyectos</h2>
      </div>

      {loading && projects.length === 0 ? (
        <p className="type-ui text-sm text-stone-600">Cargando…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-base italic text-stone-600">
            Todavía no tienes proyectos asignados.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-900/10 rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
          {projects.map((project, idx) => (
            <div
              key={project.id}
              className="flex flex-col gap-4 px-6 py-5 transition-colors hover:bg-surface/35 sm:flex-row sm:items-center sm:justify-between md:px-7"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="type-tech text-stone-400">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true" className="text-stone-300">
                    ·
                  </span>
                  <span className="type-tech text-stone-700">
                    {project.status}
                  </span>
                  <span aria-hidden="true" className="text-stone-300">
                    ·
                  </span>
                  <span className="type-tech text-stone-500">
                    {project.scope_type || "Sin scope"}
                  </span>
                </div>
                <p className="type-editorial truncate text-xl text-stone-900">
                  {project.title}
                </p>
              </div>
              <Link
                href={`/portal/projects/${project.id}`}
                className="type-ui inline-flex min-h-[42px] shrink-0 whitespace-nowrap items-center justify-center gap-2 self-start rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background sm:self-auto"
              >
                <span>Abrir proyecto</span>
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
