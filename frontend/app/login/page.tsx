"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/auth";

// Same-origin by default (Next.js rewrites proxy /api/v1/* to the backend).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const RESET_ACK =
  "Si la cuenta existe, tu solicitud fue enviada al estudio. El equipo te contactará.";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // "¿Olvidaste tu contraseña?" flow: reveals the reset-request form.
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Credenciales inválidas");
        return;
      }

      const data: {
        access_token: string;
        must_change_password?: boolean;
      } = await res.json();
      setToken(data.access_token);

      // A temporary password must be replaced before any guarded page:
      // the backend answers 403 on everything except the auth endpoints.
      if (data.must_change_password) {
        router.push("/change-password");
        return;
      }

      // Route by role: clients land on their portal, the team on admin.
      // If the role cannot be confirmed, fall back to admin (its layout
      // re-checks the role server-side and redirects clients anyway).
      try {
        const meRes = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        if (meRes.ok) {
          const me: { role: string } = await meRes.json();
          router.push(me.role === "CLIENT" ? "/portal" : "/admin");
          return;
        }
      } catch {
        // Fall through to the default admin destination.
      }
      router.push("/admin");
    } catch {
      setError("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetMessage("");
    setResetLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/v1/auth/password-reset-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: resetEmail }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResetError(data.detail || "No se pudo enviar la solicitud");
        return;
      }

      setResetMessage(RESET_ACK);
      setResetEmail("");
    } catch {
      setResetError("Error de conexión con el servidor");
    } finally {
      setResetLoading(false);
    }
  }

  function toggleReset() {
    setShowReset((open) => !open);
    setResetError("");
    setResetMessage("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4">
      <div className="border border-border bg-background p-6 sm:p-8">
        <p className="label-mono">Pomme Studio / Admin</p>
        <h1 className="type-title mt-3 text-2xl">Iniciar sesión</h1>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="type-ui text-xs">Usuario o email</span>
            <input
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-ui text-xs">Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </label>

          {error && (
            <p className="border border-border bg-surface p-3 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-brutal w-full justify-center"
          >
            {loading ? "Entrando…" : "Entrar"}
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </button>
        </form>

        <button
          type="button"
          onClick={toggleReset}
          aria-expanded={showReset}
          className="type-ui mt-4 flex min-h-[44px] w-full items-center justify-center text-sm underline"
        >
          {showReset ? "Volver al inicio de sesión" : "¿Olvidaste tu contraseña?"}
        </button>

        {showReset && (
          <form
            onSubmit={handleResetRequest}
            className="mt-4 flex flex-col gap-4 border-t border-border pt-4"
          >
            <div>
              <p className="type-subtitle-caps text-sm">Recuperar acceso</p>
              <p className="type-ui mt-2 text-xs">
                Envía una solicitud al estudio y el equipo asignará una
                contraseña temporal.
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="type-ui text-xs">Email de la cuenta</span>
              <input
                type="email"
                autoComplete="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </label>

            {resetError && (
              <p className="border border-border bg-surface p-3 text-sm">
                {resetError}
              </p>
            )}

            {resetMessage && (
              <p className="border border-border bg-surface p-3 text-sm">
                {resetMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={resetLoading}
              className="btn-brutal w-full justify-center"
            >
              {resetLoading ? "Enviando…" : "Enviar solicitud"}
              <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
