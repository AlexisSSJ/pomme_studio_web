"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/auth";

// Same-origin by default (Next.js rewrites proxy /api/v1/* to the backend).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

      const data = await res.json();
      setToken(data.access_token);

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
      </div>
    </main>
  );
}
