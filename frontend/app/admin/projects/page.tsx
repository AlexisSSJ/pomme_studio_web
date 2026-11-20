"use client";

import { useEffect, useState, useCallback } from "react";
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

interface Me {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/admin/projects");
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
    async function loadMe() {
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (res.ok) {
          setMe(await res.json());
        }
      } catch {
        // Silent: role-gated UI falls back to hidden controls.
      }
    }

    loadMe();
    loadProjects();
  }, [loadProjects]);

  async function activateProject(projectId: string) {
    setActivatingId(projectId);
    setMessage("");
    try {
      const res = await apiFetch(`/api/v1/admin/projects/${projectId}/activate`, {
        method: "POST",
      });
      if (res.ok) {
        setMessage("Proyecto activado");
        loadProjects();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al activar proyecto"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setActivatingId(null);
    }
  }

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Proyectos</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
      )}

      {loading && projects.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
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
                <p className="label-mono mt-1">
                  Rondas {project.remaining_rounds}/{project.included_rounds} ·{" "}
                  {project.balance_paid ? "PAGADO" : "PENDIENTE"}
                </p>
              </div>
              {me?.role === "SUPER_ADMIN" && project.status === "draft" && (
                <button
                  onClick={() => activateProject(project.id)}
                  disabled={activatingId === project.id}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  {activatingId === project.id ? "Activando…" : "Activar proyecto"}
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
