"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

interface ClientOption {
  id: string;
  email: string;
  full_name: string | null;
}

interface ProjectMember {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  assigned_role: "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT";
  created_at: string;
}

interface TeamUser {
  id: string;
  email: string;
  full_name: string | null;
  role: "LEAD_DESIGNER" | "COLLABORATOR";
}

const ROLE_LABELS: Record<ProjectMember["assigned_role"], string> = {
  LEAD_DESIGNER: "Lead designer",
  COLLABORATOR: "Colaborador",
  CLIENT: "Cliente",
};

export default function AdminProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [message, setMessage] = useState("");
  const [teamError, setTeamError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedTeamUserId, setSelectedTeamUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [assigningLead, setAssigningLead] = useState(false);

  const leadOptions = team.filter((user) => user.role === "LEAD_DESIGNER");
  const availableTeamUsers = team.filter(
    (user) => !members.some((member) => member.user_id === user.id)
  );
  const currentLeadMissing =
    project?.lead_designer_id !== null &&
    project?.lead_designer_id !== undefined &&
    !leadOptions.some((user) => user.id === project.lead_designer_id);

  const load = useCallback(async () => {
    setLoading(true);
    let teamLoadError = "";
    try {
      const [resProject, resClients, resMembers, resTeam] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch("/api/v1/admin/clients").catch(() => null),
        apiFetch(`/api/v1/admin/projects/${projectId}/members`).catch(
          () => null
        ),
        apiFetch("/api/v1/admin/team").catch(() => null),
      ]);
      if (resProject.ok) {
        setProject(await resProject.json());
      } else {
        const data: unknown = await resProject.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }
      if (resClients && resClients.ok) {
        const data: unknown = await resClients.json().catch(() => null);
        if (Array.isArray(data)) setClients(data as ClientOption[]);
      }
      if (resMembers?.ok) {
        const data: unknown = await resMembers.json().catch(() => null);
        setMembers(Array.isArray(data) ? (data as ProjectMember[]) : []);
      } else if (resMembers) {
        // 403 for collaborators who are not part of the project team.
        const data: unknown = await resMembers.json().catch(() => ({}));
        teamLoadError = extractDetail(
          data,
          "Error al cargar el equipo del proyecto"
        );
        setMembers([]);
      } else {
        teamLoadError = "No se pudo cargar el equipo del proyecto";
        setMembers([]);
      }
      if (resTeam?.ok) {
        const data: unknown = await resTeam.json().catch(() => null);
        setTeam(Array.isArray(data) ? (data as TeamUser[]) : []);
      } else if (resTeam) {
        const data: unknown = await resTeam.json().catch(() => ({}));
        const detail = extractDetail(data, "Error al cargar el equipo interno");
        teamLoadError = teamLoadError ? `${teamLoadError} · ${detail}` : detail;
        setTeam([]);
      } else {
        const detail = "No se pudo cargar el equipo interno";
        teamLoadError = teamLoadError ? `${teamLoadError} · ${detail}` : detail;
        setTeam([]);
      }
      setTeamError(teamLoadError);
    } catch {
      setMessage("Error de conexión con el servidor");
      setMembers([]);
      setTeam([]);
      setTeamError("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function activateProject() {
    setActivating(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/activate`,
        { method: "POST" }
      );
      if (res.ok) {
        setMessage("Proyecto activado");
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al activar proyecto"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setActivating(false);
    }
  }

  async function validateFinalPayment() {
    setValidating(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/validate-final-payment`,
        { method: "POST" }
      );
      if (res.ok) {
        setMessage("Pago final validado");
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al validar pago final"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setValidating(false);
    }
  }

  async function assignClient(clientId: string) {
    setAssigning(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/client`,
        {
          method: "PATCH",
          body: JSON.stringify({ client_id: clientId || null }),
        }
      );
      if (res.ok) {
        setMessage("Cliente asignado correctamente");
        load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al asignar cliente"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setAssigning(false);
    }
  }

  async function addMember() {
    if (!selectedTeamUserId) {
      setTeamError("Selecciona un miembro del equipo para añadirlo");
      return;
    }
    setAddingMember(true);
    setTeamError("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/members`,
        {
          method: "POST",
          body: JSON.stringify({
            user_id: selectedTeamUserId,
            assigned_role: "COLLABORATOR",
          }),
        }
      );
      if (res.ok) {
        setMessage("Colaborador añadido al proyecto");
        setSelectedTeamUserId("");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setTeamError(extractDetail(data, "Error al añadir colaborador"));
      }
    } catch {
      setTeamError("Error de conexión con el servidor");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeMember(member: ProjectMember) {
    setRemovingMemberId(member.user_id);
    setTeamError("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/members/${member.user_id}`,
        { method: "DELETE" }
      );
      // 204 No Content: there is no JSON body to parse.
      if (res.status === 204 || res.ok) {
        setMessage("Miembro quitado del proyecto");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setTeamError(extractDetail(data, "Error al quitar el miembro"));
      }
    } catch {
      setTeamError("Error de conexión con el servidor");
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function assignLead(leadDesignerId: string) {
    if (!leadDesignerId) return;
    setAssigningLead(true);
    setTeamError("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/lead`,
        {
          method: "PATCH",
          body: JSON.stringify({ lead_designer_id: leadDesignerId }),
        }
      );
      if (res.ok) {
        setMessage("Responsable actualizado");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setTeamError(extractDetail(data, "Error al actualizar el responsable"));
      }
    } catch {
      setTeamError("Error de conexión con el servidor");
    } finally {
      setAssigningLead(false);
    }
  }

  return (
    <section className="brief-editorial">
      {/* Editorial ficha header: micro-label and title over a rule. */}
      <div className="mb-8 border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-600">Resumen del proyecto</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          {project?.title ?? "Proyecto"}
        </h1>
      </div>

      {message && (
        <p className="type-ui mb-4 rounded-xl border border-stone-900/15 bg-surface/75 p-4 text-sm text-stone-700">
          {message}
        </p>
      )}

      {loading && !project ? (
        <p className="type-ui mt-4 text-sm text-stone-600">Cargando…</p>
      ) : project ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
              <p className="type-tech text-stone-600">01 · Estado</p>
              <p className="type-editorial mt-2 text-lg tabular-nums text-stone-900">
                {project.status}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
              <p className="type-tech text-stone-600">02 · Scope</p>
              <p className="type-editorial mt-2 text-lg tabular-nums text-stone-900">
                {project.scope_type || "sin scope"}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
              <p className="type-tech text-stone-600">03 · Rondas de cambios</p>
              <p className="type-editorial mt-2 text-lg tabular-nums text-stone-900">
                {project.remaining_rounds}/{project.included_rounds}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
              <p className="type-tech text-stone-600">04 · Pago final</p>
              <p className="type-editorial mt-2 text-lg tabular-nums text-stone-900">
                {project.balance_paid ? "PAGADO" : "PENDIENTE"}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {project.status === "draft" && (
              <button
                type="button"
                onClick={activateProject}
                disabled={activating}
                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activating ? "Activando…" : "Activar proyecto ↗"}
              </button>
            )}
            {project.status !== "draft" && !project.balance_paid && (
              <button
                type="button"
                onClick={validateFinalPayment}
                disabled={validating}
                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validating ? "Validando…" : "Validar pago final ↗"}
              </button>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6">
            <p className="type-tech text-stone-600">Cliente del proyecto</p>
            <label className="mt-3 flex flex-col gap-1">
              <span className="type-ui text-sm text-stone-600">
                Cliente asignado
              </span>
              <select
                value={project.client_id || ""}
                onChange={(event) => assignClient(event.target.value)}
                disabled={assigning}
                className="type-ui min-h-[44px] w-full rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 sm:w-auto sm:min-w-[320px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">-- Sin cliente asignado --</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.full_name
                      ? `${client.full_name} (${client.email})`
                      : client.email}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6">
            <h2 className="type-subtitle-caps text-xl text-stone-900">
              Equipo del proyecto
            </h2>

            {teamError && (
              <p className="type-ui mt-3 rounded-xl border border-stone-900/15 bg-background/60 p-3 text-sm text-stone-700">
                {teamError}
              </p>
            )}

            {!teamError && (
              <div className="mt-4 flex flex-col gap-3">
                {members.length === 0 ? (
                  <p className="type-editorial text-[15px] italic text-stone-500">
                    Todavía no hay miembros en el equipo de este proyecto.
                  </p>
                ) : (
                  members.map((member, index) => {
                    const isClient = member.assigned_role === "CLIENT";
                    const isAssignedLead =
                      member.assigned_role === "LEAD_DESIGNER" &&
                      member.user_id === project.lead_designer_id;
                    const isRemoving = removingMemberId === member.user_id;

                    return (
                      <div
                        key={member.id}
                        className="flex flex-col gap-3 rounded-xl border border-stone-900/10 bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="type-tech w-8 shrink-0 pt-1 text-stone-500">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <p className="type-editorial text-[15px] text-stone-900">
                              {member.full_name || member.email}
                            </p>
                            {member.full_name && (
                              <p className="type-editorial truncate text-sm text-stone-600">
                                {member.email}
                              </p>
                            )}
                            <p className="type-tech mt-1 text-stone-600">
                              {ROLE_LABELS[member.assigned_role]}
                            </p>
                          </div>
                        </div>

                        {isClient ? (
                          <span className="type-editorial shrink-0 text-[11px] italic text-stone-500">
                            Se cambia desde Cliente del proyecto
                          </span>
                        ) : isAssignedLead ? (
                          <span className="type-editorial shrink-0 text-[11px] italic text-stone-500">
                            Se reasigna desde Responsable
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeMember(member)}
                            disabled={removingMemberId !== null}
                            className="type-ui min-h-[44px] shrink-0 rounded-lg border border-stone-900/20 px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRemoving ? "Quitando…" : "Quitar ✕"}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <div className="mt-5 border-t border-stone-900/10 pt-5">
              <p className="type-tech text-stone-600">Responsable</p>
              <label className="mt-3 flex flex-col gap-1">
                <span className="type-ui text-sm text-stone-600">
                  Lead designer del proyecto
                </span>
                <select
                  value={project.lead_designer_id || ""}
                  onChange={(event) => assignLead(event.target.value)}
                  disabled={assigningLead}
                  className="type-ui min-h-[44px] w-full rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 sm:w-auto sm:min-w-[320px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">-- Sin responsable asignado --</option>
                  {currentLeadMissing && project.lead_designer_id && (
                    <option value={project.lead_designer_id}>
                      Responsable actual (no disponible en el equipo)
                    </option>
                  )}
                  {leadOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name
                        ? `${user.full_name} (${user.email})`
                        : user.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 border-t border-stone-900/10 pt-5">
              <p className="type-tech text-stone-600">Añadir colaborador</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="type-ui text-sm text-stone-600">
                    Miembro del equipo
                  </span>
                  <select
                    value={selectedTeamUserId}
                    onChange={(event) =>
                      setSelectedTeamUserId(event.target.value)
                    }
                    disabled={addingMember}
                    className="type-ui min-h-[44px] w-full rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">-- Selecciona un miembro del equipo --</option>
                    {availableTeamUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name
                          ? `${user.full_name} (${user.email})`
                          : user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={addMember}
                  disabled={addingMember || !selectedTeamUserId}
                  className="type-ui min-h-[44px] shrink-0 rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addingMember ? "Añadiendo…" : "Añadir colaborador ↗"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
