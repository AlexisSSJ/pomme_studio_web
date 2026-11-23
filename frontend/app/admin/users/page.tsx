"use client";

import { useEffect, useState, useCallback } from "react";
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

const ROLES = ["SUPER_ADMIN", "LEAD_DESIGNER", "COLLABORATOR", "CLIENT"];

function formatRequestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es");
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("CLIENT");
  const [message, setMessage] = useState("");

  // Password-reset queue.
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [customPasswords, setCustomPasswords] = useState<Record<string, string>>(
    {}
  );
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
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    loadUsers();
    loadRequests();
  }, [loadUsers, loadRequests]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await apiFetch("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name: fullName, role }),
    });
    if (res.ok) {
      setMessage("Usuario creado");
      setEmail("");
      setPassword("");
      setFullName("");
      loadUsers();
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(data.detail || "Error al crear usuario");
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
        // The plaintext password is only ever available in this response.
        setApprovedPassword({
          email: request.user_email,
          password: data.temporary_password,
        });
        setCopied(false);
        setResetMessage("Contraseña temporal asignada");
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
        setResetMessage("Solicitud rechazada");
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
        "No se pudo copiar automáticamente. Selecciona el texto a mano."
      );
    }
  }

  return (
    <section>
      <h1 className="type-title text-xl">Usuarios</h1>

      <form onSubmit={createUser} className="mt-4 border border-border bg-surface p-4">
        <p className="type-subtitle-caps text-sm">Crear usuario</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <input
            type="text"
            placeholder="Nombre completo"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-brutal mt-3">
          Crear <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
        </button>
        {message && <p className="type-ui mt-2 text-sm">{message}</p>}
      </form>

      <div className="mt-6 border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="type-subtitle-caps text-sm">
            Solicitudes de restablecimiento
          </p>
          <p className="label-mono">
            {String(requests.length).padStart(2, "0")} pendiente
            {requests.length === 1 ? "" : "s"}
          </p>
        </div>

        {approvedPassword && (
          <div className="mt-3 border border-border bg-background p-3">
            <p className="label-mono">
              Contraseña temporal · {approvedPassword.email}
            </p>
            <p className="type-tech mt-2 select-all break-all text-sm normal-case tracking-normal">
              {approvedPassword.password}
            </p>
            <p className="type-ui mt-2 text-xs">
              Cópiala ahora: no volverá a mostrarse. Compártela por un canal
              seguro; el usuario deberá cambiarla al iniciar sesión.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyTemporaryPassword}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                {copied ? "Copiada" : "Copiar"}
                <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setApprovedPassword(null);
                  setCopied(false);
                }}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                Ocultar
              </button>
            </div>
          </div>
        )}

        {requests.length === 0 ? (
          <p className="label-mono mt-3">Sin solicitudes pendientes</p>
        ) : (
          <div className="grid-brutal mt-3">
            {requests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="type-ui text-sm font-semibold">
                    {request.user_email}
                  </p>
                  <p className="label-mono mt-1">
                    Solicitada {formatRequestedAt(request.requested_at)}
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
                    className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approveRequest(request)}
                      disabled={busyRequestId === request.id}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      {busyRequestId === request.id
                        ? "Asignando…"
                        : "Asignar temporal"}
                      <span className="btn-brutal__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectRequest(request)}
                      disabled={busyRequestId === request.id}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {resetMessage && (
          <p className="type-ui mt-3 text-sm">{resetMessage}</p>
        )}
      </div>

      <div className="grid-brutal mt-6">
        {users.map((user) => (
          <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="type-ui text-sm font-semibold">{user.email}</p>
              <p className="label-mono mt-1">
                {user.role} · {user.is_active ? "Activo" : "Inactivo"}
              </p>
              {user.must_change_password && (
                <span className="label-mono mt-2 inline-block border border-border bg-surface px-2 py-1">
                  Cambio de contraseña pendiente
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={user.role}
                onChange={(e) => changeRole(user.id, e.target.value)}
                className="type-ui min-h-[44px] border border-border bg-background px-2 text-xs"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                onClick={() => toggleStatus(user.id, user.is_active)}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                {user.is_active ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
