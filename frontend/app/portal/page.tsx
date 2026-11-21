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

export default function PortalProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/projects");
      if (res.ok) {
        setProjects(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar proyectos"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Mis proyectos</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

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
