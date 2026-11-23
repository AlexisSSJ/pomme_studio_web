"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import { clearToken, getToken, isAuthenticated } from "@/lib/auth";

// Same-origin by default (Next.js rewrites proxy /api/v1/* to the backend).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setChecked(true);
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("La nueva contraseña debe ser distinta de la actual.");
      return;
    }

    setLoading(true);

    try {
      const token = getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      // Raw fetch on purpose: the endpoint answers 401 for a wrong current
      // password, and apiFetch would clear the token and leave the page on
      // any 401. Here the session stays valid and the detail renders inline.
      const res = await fetch(`${API_BASE}/api/v1/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(extractDetail(data, "No se pudo cambiar la contraseña"));
        return;
      }

      // Re-read the profile so the destination uses the fresh role and the
      // server has already cleared the mandatory-change flag.
      const meRes = await apiFetch("/api/v1/auth/me");
      if (meRes.ok) {
        const me: { role: string } = await meRes.json();
        router.push(me.role === "CLIENT" ? "/portal" : "/admin");
        return;
      }
      router.push("/admin");
    } catch {
      setError("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }

  if (!checked) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4">
        <p className="type-ui text-sm">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4">
      <div className="border border-border bg-background p-6 sm:p-8">
        <p className="label-mono">Pomme Studio / Acceso</p>
        <h1 className="type-title mt-3 text-2xl">Cambiar contraseña</h1>
        <p className="type-ui mt-3 text-sm">
          Por seguridad, reemplaza tu contraseña actual —o la temporal asignada
          por el estudio— antes de continuar.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="type-ui text-xs">Contraseña actual</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-ui text-xs">Nueva contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
            <span className="label-mono">Mínimo 8 caracteres</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-ui text-xs">Confirmar nueva contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </label>

          {error && (
            <p role="alert" className="border border-border bg-surface p-3 text-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-brutal w-full justify-center"
          >
            {loading ? "Guardando…" : "Guardar contraseña"}
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </button>
        </form>

        {/* Escape hatch: expired tokens or users without their current
            password must always be able to start over from the login page. */}
        <button
          type="button"
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
          className="type-ui mt-4 flex min-h-[44px] w-full items-center justify-center text-sm underline"
        >
          Volver a iniciar sesión
        </button>
      </div>
    </main>
  );
}
