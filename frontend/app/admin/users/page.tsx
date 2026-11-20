"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
}

const ROLES = ["SUPER_ADMIN", "LEAD_DESIGNER", "COLLABORATOR", "CLIENT"];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("CLIENT");
  const [message, setMessage] = useState("");

  const loadUsers = useCallback(async () => {
    const res = await apiFetch("/api/v1/admin/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Usuarios</h1>

      <form onSubmit={createUser} className="mt-4 border border-border bg-surface p-4">
        <p className="label-mono">Crear usuario</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <input
            type="text"
            placeholder="Nombre completo"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-brutal mt-3">
          Crear <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
        </button>
        {message && <p className="mt-2 text-sm">{message}</p>}
      </form>

      <div className="grid-brutal mt-6">
        {users.map((user) => (
          <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{user.email}</p>
              <p className="label-mono mt-1">
                {user.role} · {user.is_active ? "Activo" : "Inactivo"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={user.role}
                onChange={(e) => changeRole(user.id, e.target.value)}
                className="min-h-[44px] border border-border bg-background px-2 text-xs"
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
