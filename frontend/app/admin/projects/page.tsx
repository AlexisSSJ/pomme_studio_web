"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [clients, setClients] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [assigningClientId, setAssigningClientId] = useState<string | null>(null);

  // New project modal state
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newScope, setNewScope] = useState<string>("branding");
  const [newClientId, setNewClientId] = useState<string>("");
  const [creatingProject, setCreatingProject] = useState(false);

  const loadProjects = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const [resProj, resClients] = await Promise.all([
        apiFetch(path),
        apiFetch("/api/v1/admin/clients").catch(() => null),
      ]);
      if (resProj.ok) {
        setProjects(await resProj.json());
      } else {
        const data: unknown = await resProj.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar proyectos"));
      }
      if (resClients && resClients.ok) {
        setClients(await resClients.json());
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      let role: string | null = null;
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (res.ok) {
          const meData: Me = await res.json();
          setMe(meData);
          role = meData.role;
        }
      } catch {
        // Silent: role-gated UI falls back to hidden controls.
      }

      // COLLABORATOR cannot list every project; the membership endpoint
      // scopes the list to the projects they belong to.
      await loadProjects(
        role === "COLLABORATOR" ? "/api/v1/projects" : "/api/v1/admin/projects"
      );
    }

    load();
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
        loadProjects("/api/v1/admin/projects");
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

  async function validateFinalPayment(projectId: string) {
    setValidatingId(projectId);
    setMessage("");
    try {
      const res = await apiFetch(`/api/v1/admin/projects/${projectId}/validate-final-payment`, {
        method: "POST",
      });
      if (res.ok) {
        setMessage("Pago final validado");
        loadProjects("/api/v1/admin/projects");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al validar pago final"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setValidatingId(null);
    }
  }

  async function assignClient(projectId: string, clientId: string) {
    setAssigningClientId(projectId);
    setMessage("");
    try {
      const res = await apiFetch(`/api/v1/admin/projects/${projectId}/client`, {
        method: "PATCH",
        body: JSON.stringify({ client_id: clientId || null }),
      });
      if (res.ok) {
        setMessage("Cliente asignado correctamente");
        loadProjects("/api/v1/admin/projects");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al asignar cliente"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setAssigningClientId(null);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      setMessage("El título del proyecto es obligatorio");
      return;
    }
    setCreatingProject(true);
    setMessage("");
    try {
      const res = await apiFetch("/api/v1/admin/projects", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          scope_type: newScope,
          client_id: newClientId || null,
          included_rounds: 3,
          remaining_rounds: 3,
        }),
      });
      if (res.ok) {
        setMessage("Proyecto creado exitosamente");
        setNewTitle("");
        setNewClientId("");
        setShowModal(false);
        loadProjects(me?.role === "COLLABORATOR" ? "/api/v1/projects" : "/api/v1/admin/projects");
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al crear el proyecto"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setCreatingProject(false);
    }
  }

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl tracking-tightest">Proyectos</h1>
        {(me?.role === "SUPER_ADMIN" || me?.role === "LEAD_DESIGNER") && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="btn-brutal min-h-[44px] px-4 text-xs bg-foreground text-background self-start"
          >
            + Nuevo proyecto
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </button>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-border bg-surface p-6 shadow-none">
            <h2 className="text-lg tracking-tightest mb-4">Crear nuevo proyecto</h2>
            <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="label-mono">Título del proyecto</span>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ej: Residencia Polanco / Rebranding Estudio"
                  className="min-h-[44px] border border-border bg-background px-3 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="label-mono">Tipo de alcance (Scope)</span>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className="min-h-[44px] border border-border bg-background px-3 text-sm"
                >
                  <option value="branding">Branding</option>
                  <option value="interior">Interior</option>
                  <option value="integral">Integral</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="label-mono">Cliente inicial (opcional)</span>
                <select
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  className="min-h-[44px] border border-border bg-background px-3 text-sm"
                >
                  <option value="">-- Sin cliente asignado --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name ? `${c.full_name} (${c.email})` : c.email}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-brutal min-h-[44px] px-4 text-xs bg-background"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="btn-brutal min-h-[44px] px-4 text-xs bg-foreground text-background"
                >
                  {creatingProject ? "Creando…" : "Crear proyecto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
      )}

      {loading && projects.length === 0 ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : projects.length === 0 ? (
        <p className="mt-4 text-sm">Todavía no hay proyectos.</p>
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
                <div className="mt-2 flex items-center gap-2">
                  <span className="label-mono">Cliente:</span>
                  <select
                    value={project.client_id || ""}
                    onChange={(e) => assignClient(project.id, e.target.value)}
                    disabled={assigningClientId === project.id}
                    className="border border-border bg-background px-2 py-1 text-xs min-h-[36px]"
                  >
                    <option value="">-- Sin cliente asignado --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name ? `${c.full_name} (${c.email})` : c.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {me?.role === "SUPER_ADMIN" && project.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => activateProject(project.id)}
                    disabled={activatingId === project.id}
                    className="btn-brutal min-h-[44px] px-3 text-xs"
                  >
                    {activatingId === project.id ? "Activando…" : "Activar proyecto"}
                    <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                  </button>
                )}
                {me?.role === "SUPER_ADMIN" && project.status !== "draft" && !project.balance_paid && (
                  <button
                    type="button"
                    onClick={() => validateFinalPayment(project.id)}
                    disabled={validatingId === project.id}
                    className="btn-brutal min-h-[44px] px-3 text-xs"
                  >
                    {validatingId === project.id ? "Validando…" : "Validar pago final"}
                    <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                  </button>
                )}
                <Link
                  href={`/admin/projects/${project.id}/brief`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Brief
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </Link>
                <Link
                  href={`/admin/projects/${project.id}/moodboard`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Moodboard
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </Link>
                <Link
                  href={`/admin/projects/${project.id}/etapas`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Etapas
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </Link>
                <Link
                  href={`/admin/projects/${project.id}/especificaciones`}
                  className="btn-brutal min-h-[44px] px-3 text-xs"
                >
                  Especificaciones
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
