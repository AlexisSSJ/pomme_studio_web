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
  const [clients, setClients] = useState<
    Array<{ id: string; email: string; full_name: string | null }>
  >([]);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
        loadProjects(
          me?.role === "COLLABORATOR" ? "/api/v1/projects" : "/api/v1/admin/projects"
        );
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
    <section className="brief-editorial">
      <div className="mb-8 flex flex-col gap-4 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-tech text-stone-600">PORTAFOLIO ACTIVO</p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">Proyectos</h1>
        </div>
        {(me?.role === "SUPER_ADMIN" || me?.role === "LEAD_DESIGNER") && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="group type-ui inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
          >
            <span>+ Nuevo proyecto</span>
            <span aria-hidden="true" className="arrow-glide">↗</span>
          </button>
        )}
      </div>

      {showModal && (
        <div className="animate-backdrop-enter brief-editorial fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-[2px]">
          <div className="animate-modal-enter w-full max-w-lg rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial">
            <p className="type-tech text-stone-500">ALTA DE PROYECTO</p>
            <h2 className="type-title mt-1 mb-5 text-xl text-stone-900">Crear nuevo proyecto</h2>
            <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="type-tech text-stone-600">Título del proyecto</span>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ej: Residencia Polanco / Rebranding Estudio"
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 outline-none transition-colors focus:border-stone-900/45"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="type-tech text-stone-600">Tipo de alcance (Scope)</span>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 outline-none transition-colors focus:border-stone-900/45"
                >
                  <option value="branding">Branding</option>
                  <option value="interior">Interior</option>
                  <option value="integral">Integral</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="type-tech text-stone-600">Cliente inicial (opcional)</span>
                <select
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 outline-none transition-colors focus:border-stone-900/45"
                >
                  <option value="">-- Sin cliente asignado --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name ? `${c.full_name} (${c.email})` : c.email}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2 flex items-center justify-end gap-3 border-t border-stone-900/10 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                >
                  {creatingProject ? "Creando…" : "Crear proyecto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {message && (
        <p className="animate-slide-down type-ui mb-6 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-800">
          {message}
        </p>
      )}

      {loading && projects.length === 0 ? (
        <p className="type-ui text-sm text-stone-600">Cargando…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-base italic text-stone-600">
            Todavía no hay proyectos registrados.
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
                <p className="type-tech text-stone-500">
                  Rondas {project.remaining_rounds}/{project.included_rounds} ·{" "}
                  <span
                    className={
                      project.balance_paid ? "text-[#44544A]" : "text-stone-500"
                    }
                  >
                    {project.balance_paid ? "Pago validado" : "Pago pendiente"}
                  </span>
                </p>
              </div>
              <Link
                href={`/admin/projects/${project.id}`}
                className="group type-ui inline-flex min-h-[42px] shrink-0 whitespace-nowrap items-center justify-center gap-2 self-start rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background sm:self-auto"
              >
                <span>Abrir proyecto</span>
                <span aria-hidden="true" className="arrow-glide">↗</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
