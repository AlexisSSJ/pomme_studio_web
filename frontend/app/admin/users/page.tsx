"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { apiFetch, extractDetail } from "@/lib/api";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
}

interface PasswordResetRequest {
  id: string;
  user_id: string;
  user_email: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface ApprovedPassword {
  email: string;
  password: string;
}

type UsersTab = "directory" | "resets";

const ROLES = ["SUPER_ADMIN", "LEAD_DESIGNER", "COLLABORATOR", "CLIENT"];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  LEAD_DESIGNER: "Lead Designer",
  COLLABORATOR: "Colaborador",
  CLIENT: "Cliente",
};

function formatRequestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState<UsersTab>("directory");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Create user modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("CLIENT");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [modalMessage, setModalMessage] = useState("");

  // Password-reset queue
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [customPasswords, setCustomPasswords] = useState<
    Record<string, string>
  >({});
  const [approvedPassword, setApprovedPassword] =
    useState<ApprovedPassword | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await apiFetch("/api/v1/admin/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  const loadRequests = useCallback(async () => {
    const res = await apiFetch(
      "/api/v1/admin/password-reset-requests?status=pending"
    );
    if (res.ok) {
      setRequests(await res.json());
    } else {
      setResetMessage("No se pudieron cargar las solicitudes");
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadRequests();
  }, [loadUsers, loadRequests]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setModalMessage("");
    try {
      const res = await apiFetch("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name: fullName, role }),
      });
      if (res.ok) {
        setMessage("Usuario creado correctamente.");
        setEmail("");
        setPassword("");
        setFullName("");
        setRole("CLIENT");
        setShowCreateModal(false);
        loadUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setModalMessage(data.detail || "Error al crear usuario");
      }
    } catch {
      setModalMessage("Error de conexión con el servidor");
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(userId: string, newRole: string) {
    await apiFetch(`/api/v1/admin/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole }),
    });
    loadUsers();
  }

  async function toggleStatus(userId: string, isActive: boolean) {
    await apiFetch(`/api/v1/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !isActive }),
    });
    loadUsers();
  }

  async function approveRequest(request: PasswordResetRequest) {
    const customPassword = (customPasswords[request.id] ?? "").trim();
    setResetMessage("");
    setBusyRequestId(request.id);

    try {
      const res = await apiFetch(
        `/api/v1/admin/password-reset-requests/${request.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify(
            customPassword ? { temporary_password: customPassword } : {}
          ),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (res.ok && typeof data.temporary_password === "string") {
        setApprovedPassword({
          email: request.user_email,
          password: data.temporary_password,
        });
        setCopied(false);
        setResetMessage("Contraseña temporal asignada.");
        setCustomPasswords((prev) => {
          const next = { ...prev };
          delete next[request.id];
          return next;
        });
      } else {
        setResetMessage(
          extractDetail(data, "Error al asignar la contraseña temporal")
        );
      }
    } catch {
      setResetMessage("Error de conexión con el servidor");
    } finally {
      setBusyRequestId(null);
      loadRequests();
      loadUsers();
    }
  }

  async function rejectRequest(request: PasswordResetRequest) {
    setResetMessage("");
    setBusyRequestId(request.id);

    try {
      const res = await apiFetch(
        `/api/v1/admin/password-reset-requests/${request.id}/reject`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResetMessage(extractDetail(data, "Error al rechazar la solicitud"));
      } else {
        setResetMessage("Solicitud rechazada.");
        setCustomPasswords((prev) => {
          const next = { ...prev };
          delete next[request.id];
          return next;
        });
      }
    } catch {
      setResetMessage("Error de conexión con el servidor");
    } finally {
      setBusyRequestId(null);
      loadRequests();
      loadUsers();
    }
  }

  async function copyTemporaryPassword() {
    if (!approvedPassword) return;
    try {
      await navigator.clipboard.writeText(approvedPassword.password);
      setCopied(true);
    } catch {
      setResetMessage(
        "No se pudo copiar automáticamente. Selecciona el texto manualmente."
      );
    }
  }

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.full_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, roleFilter, searchQuery]);

  return (
    <section className="brief-editorial space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-5 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-tech text-stone-500">Control de acceso</p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
            Usuarios
          </h1>
        </div>

        <button
          type="button"
          onClick={() => {
            setModalMessage("");
            setShowCreateModal(true);
          }}
          className="type-ui min-h-[44px] shrink-0 whitespace-nowrap self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 sm:self-auto"
        >
          + Nuevo usuario
        </button>
      </div>

      {message && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3">
          <p className="type-ui text-sm text-stone-800">{message}</p>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Cerrar mensaje"
            className="type-tech text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Tabbed Workspace */}
      <div className="rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-900/10 px-6 md:px-7">
          <div role="tablist" className="flex items-center gap-6">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "directory"}
              onClick={() => setActiveTab("directory")}
              className={`type-ui relative min-h-[48px] shrink-0 whitespace-nowrap py-3 text-sm transition-colors ${
                activeTab === "directory"
                  ? "font-medium text-stone-900"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              Directorio{" "}
              <span className="type-tech ml-1 text-stone-400">
                {users.length}
              </span>
              {activeTab === "directory" && (
                <span
                  aria-hidden="true"
                  className="animate-tab-indicator absolute inset-x-0 bottom-0 h-[2px] bg-stone-900"
                />
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "resets"}
              onClick={() => setActiveTab("resets")}
              className={`type-ui relative min-h-[48px] shrink-0 whitespace-nowrap py-3 text-sm transition-colors ${
                activeTab === "resets"
                  ? "font-medium text-stone-900"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              Restablecimientos{" "}
              <span
                className={`type-tech ml-1 ${
                  requests.length > 0 ? "text-stone-900" : "text-stone-400"
                }`}
              >
                {requests.length}
              </span>
              {activeTab === "resets" && (
                <span
                  aria-hidden="true"
                  className="animate-tab-indicator absolute inset-x-0 bottom-0 h-[2px] bg-stone-900"
                />
              )}
            </button>
          </div>
        </div>

        {/* TAB 1: DIRECTORY */}
        {activeTab === "directory" && (
          <div className="animate-panel-enter p-6 md:p-7">
            {/* Search & Role Filter */}
            <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface/80 p-1">
                <button
                  type="button"
                  onClick={() => setRoleFilter("all")}
                  className={`type-ui min-h-[36px] shrink-0 whitespace-nowrap rounded-lg px-3 text-xs transition-colors ${
                    roleFilter === "all"
                      ? "bg-background font-medium text-stone-900 shadow-editorial"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Todos ({users.length})
                </button>
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    className={`type-ui min-h-[36px] shrink-0 whitespace-nowrap rounded-lg px-3 text-xs transition-colors ${
                      roleFilter === r
                        ? "bg-background font-medium text-stone-900 shadow-editorial"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {ROLE_LABELS[r] ?? r}
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre o correo…"
                aria-label="Buscar usuarios"
                className="type-ui min-h-[42px] w-full rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 lg:w-64"
              />
            </div>

            {filteredUsers.length === 0 ? (
              <p className="type-editorial py-6 text-base italic text-stone-500">
                No se encontraron usuarios con esos filtros.
              </p>
            ) : (
              <div className="divide-y divide-stone-900/10">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="type-editorial truncate text-base text-stone-900">
                        {user.full_name || user.email}
                      </p>
                      <p className="type-tech mt-0.5 truncate text-stone-500">
                        {user.full_name ? `${user.email} · ` : ""}
                        <span
                          className={
                            user.is_active ? "text-[#44544A]" : "text-stone-400"
                          }
                        >
                          {user.is_active ? "Activo" : "Inactivo"}
                        </span>
                        {user.must_change_password
                          ? " · Cambio de contraseña pendiente"
                          : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={user.role}
                        aria-label={`Rol de ${user.email}`}
                        onChange={(e) => changeRole(user.id, e.target.value)}
                        className="type-ui min-h-[40px] rounded-lg border border-stone-900/15 bg-background px-3 text-xs text-stone-800 focus:border-stone-900/45"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r] ?? r}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => toggleStatus(user.id, user.is_active)}
                        className={`type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs transition-colors ${
                          user.is_active
                            ? "border border-stone-900/20 bg-background text-stone-700 hover:bg-stone-900 hover:text-background"
                            : "bg-stone-900 text-background hover:bg-stone-800"
                        }`}
                      >
                        {user.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PASSWORD RESET REQUESTS */}
        {activeTab === "resets" && (
          <div className="animate-panel-enter space-y-5 p-6 md:p-7">
            {approvedPassword && (
              <div className="animate-slide-down space-y-3 rounded-xl border border-[#5F7161]/40 bg-[#EEF2EC]/70 p-5">
                <p className="type-tech text-[#44544A]">
                  Contraseña temporal asignada · {approvedPassword.email}
                </p>
                <p className="type-tech select-all break-all text-base normal-case tracking-normal text-stone-900">
                  {approvedPassword.password}
                </p>
                <p className="type-ui text-xs text-stone-600">
                  Cópiala ahora: no volverá a mostrarse. El usuario deberá
                  cambiarla al iniciar sesión.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyTemporaryPassword}
                    className="type-ui min-h-[40px] rounded-lg bg-stone-900 px-4 text-xs text-background transition-colors hover:bg-stone-800"
                  >
                    {copied ? "Copiada ✓" : "Copiar contraseña"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setApprovedPassword(null);
                      setCopied(false);
                    }}
                    className="type-ui min-h-[40px] rounded-lg border border-stone-900/20 bg-background px-4 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                  >
                    Ocultar
                  </button>
                </div>
              </div>
            )}

            {resetMessage && (
              <p className="type-ui text-sm text-stone-700">{resetMessage}</p>
            )}

            {requests.length === 0 ? (
              <p className="type-editorial py-4 text-base italic text-stone-500">
                No hay solicitudes de restablecimiento pendientes.
              </p>
            ) : (
              <div className="divide-y divide-stone-900/10">
                {requests.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <p className="type-editorial text-base text-stone-900">
                        {request.user_email}
                      </p>
                      <p className="type-tech mt-0.5 text-stone-500">
                        Solicitada · {formatRequestedAt(request.requested_at)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        placeholder="Contraseña temporal (opcional)"
                        aria-label={`Contraseña temporal para ${request.user_email}`}
                        value={customPasswords[request.id] ?? ""}
                        onChange={(e) =>
                          setCustomPasswords((prev) => ({
                            ...prev,
                            [request.id]: e.target.value,
                          }))
                        }
                        minLength={8}
                        className="type-ui min-h-[42px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => approveRequest(request)}
                          disabled={busyRequestId === request.id}
                          className="type-ui min-h-[42px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-4 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                        >
                          {busyRequestId === request.id
                            ? "Asignando…"
                            : "Asignar temporal ↗"}
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectRequest(request)}
                          disabled={busyRequestId === request.id}
                          className="type-ui min-h-[42px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div
          className="animate-backdrop-enter brief-editorial fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-title"
        >
          <div className="animate-modal-enter w-full max-w-lg rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-stone-900/10 pb-4">
              <div>
                <p className="type-tech text-stone-500">Alta de cuenta</p>
                <h2
                  id="create-user-title"
                  className="type-title mt-1 text-xl text-stone-900"
                >
                  Crear nuevo usuario
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Cerrar ventana"
                className="type-ui flex h-10 w-10 items-center justify-center rounded-full border border-stone-900/15 text-stone-600 transition-colors hover:bg-stone-900 hover:text-background"
              >
                ✕
              </button>
            </div>

            <form onSubmit={createUser} className="space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">
                  Nombre completo
                </span>
                <input
                  type="text"
                  placeholder="Ej. Camila Morales"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">Email *</span>
                <input
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Contraseña inicial *
                  </span>
                  <input
                    type="password"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">Rol *</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r] ?? r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {modalMessage && (
                <p className="type-ui rounded-lg border border-stone-900/15 bg-surface/75 px-3.5 py-2.5 text-xs text-stone-800">
                  {modalMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 border-t border-stone-900/10 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                >
                  {creating ? "Creando…" : "Crear usuario ↗"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
