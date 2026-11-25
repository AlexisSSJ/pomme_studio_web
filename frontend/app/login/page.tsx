"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { extractDetail } from "@/lib/api";
import { setToken } from "@/lib/auth";

// Same-origin by default (Next.js serves /api/v1/* or proxies via API_PROXY_TARGET).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const RESET_ACK =
  "Si la cuenta existe, tu solicitud fue enviada al estudio. El equipo te contactará.";

interface DevAccount {
  role: string;
  email: string;
  full_name: string;
  specialty: string | null;
  label: string;
  summary: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // First-run admin setup state (shown only when no SUPER_ADMIN exists and
  // ADMIN_EMAIL / ADMIN_PASSWORD are not configured in server env).
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapName, setBootstrapName] = useState("Administrador");
  const [bootstrapEmail, setBootstrapEmail] = useState("");
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapConfirm, setBootstrapConfirm] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapLoading, setBootstrapLoading] = useState(false);

  // "¿Olvidaste tu contraseña?" flow: reveals the reset-request form.
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Dev Mode quick role login state (rendered only when server enables Dev Mode).
  const [devEnabled, setDevEnabled] = useState(false);
  const [devSeeded, setDevSeeded] = useState(false);
  const [devAccounts, setDevAccounts] = useState<DevAccount[]>([]);
  const [devLoadingRole, setDevLoadingRole] = useState<string | null>(null);
  const [devSeeding, setDevSeeding] = useState(false);
  const [devMessage, setDevMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function checkStartupStatus() {
      try {
        const [bootRes, devRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/auth/bootstrap-status`).catch(() => null),
          fetch(`${API_BASE}/api/v1/auth/dev-status`).catch(() => null),
        ]);
        if (bootRes?.ok) {
          const data: { needs_setup?: boolean } = await bootRes.json();
          if (active && data.needs_setup === true) {
            setNeedsBootstrap(true);
          }
        }
        if (devRes?.ok) {
          const data: {
            enabled?: boolean;
            seeded?: boolean;
            accounts?: DevAccount[];
          } = await devRes.json();
          if (active && data.enabled === true) {
            setDevEnabled(true);
            setDevSeeded(Boolean(data.seeded));
            setDevAccounts(Array.isArray(data.accounts) ? data.accounts : []);
          }
        }
      } catch {
        // External backends without these endpoints show standard login.
      }
    }
    void checkStartupStatus();
    return () => {
      active = false;
    };
  }, []);

  async function handleDevQuickLogin(role: string) {
    setDevLoadingRole(role);
    setDevMessage("");
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDevMessage(
          extractDetail(data, "No se pudo iniciar sesión en modo dev")
        );
        return;
      }
      if (typeof data.access_token === "string") {
        setToken(data.access_token);
        const resolvedRole = data.user?.role ?? role;
        router.push(resolvedRole === "CLIENT" ? "/portal" : "/admin/projects");
      }
    } catch {
      setDevMessage("Error de conexión con el servidor");
    } finally {
      setDevLoadingRole(null);
    }
  }

  async function handleDevSeed(reset: boolean) {
    setDevSeeding(true);
    setDevMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDevSeeded(true);
        setNeedsBootstrap(false);
        setDevMessage(
          reset
            ? `Datos de prueba reiniciados (${data.projects_count ?? 3} proyectos listos) ✓`
            : `Datos de prueba cargados (${data.projects_count ?? 3} proyectos listos) ✓`
        );
      } else {
        setDevMessage(
          extractDetail(data, "No se pudieron cargar los datos de prueba")
        );
      }
    } catch {
      setDevMessage("Error de conexión al cargar datos de prueba");
    } finally {
      setDevSeeding(false);
    }
  }

  async function handleBootstrapSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBootstrapError("");

    if (!bootstrapEmail.trim()) {
      setBootstrapError("Ingresa un email o usuario para el administrador.");
      return;
    }
    if (bootstrapPassword.length < 8) {
      setBootstrapError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (bootstrapPassword !== bootstrapConfirm) {
      setBootstrapError("Las contraseñas no coinciden.");
      return;
    }

    setBootstrapLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/bootstrap-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: bootstrapName.trim() || "Administrador",
          email: bootstrapEmail.trim(),
          password: bootstrapPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setNeedsBootstrap(false);
        }
        setBootstrapError(
          extractDetail(data, "No se pudo crear el usuario administrador")
        );
        return;
      }

      if (typeof data.access_token === "string") {
        setToken(data.access_token);
        router.push("/admin");
        return;
      }
      setNeedsBootstrap(false);
    } catch {
      setBootstrapError("Error de conexión con el servidor");
    } finally {
      setBootstrapLoading(false);
    }
  }

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
        setResetError(
          extractDetail(data, "No se pudo enviar la solicitud")
        );
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
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4 py-8">
      <div className="border border-border bg-background p-6 sm:p-8">
        <p className="label-mono">
          {needsBootstrap
            ? "Pomme Studio / Configuración inicial"
            : "Pomme Studio / Admin"}
        </p>

        {needsBootstrap ? (
          <>
            <h1 className="type-title mt-3 text-2xl">
              Crear usuario administrador
            </h1>
            <p className="type-ui mt-3 text-sm">
              Aún no existe una cuenta Super Admin. Define tu usuario y
              contraseña inicial para reclamar el panel del estudio.
            </p>

            <form
              onSubmit={handleBootstrapSubmit}
              className="mt-6 flex flex-col gap-4"
            >
              <label className="flex flex-col gap-1">
                <span className="type-ui text-xs">Nombre completo</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={bootstrapName}
                  onChange={(e) => setBootstrapName(e.target.value)}
                  required
                  className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="type-ui text-xs">Email de administrador</span>
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="admin@pommestudio.com"
                  value={bootstrapEmail}
                  onChange={(e) => setBootstrapEmail(e.target.value)}
                  required
                  className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="type-ui text-xs">Contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={bootstrapPassword}
                  onChange={(e) => setBootstrapPassword(e.target.value)}
                  required
                  minLength={8}
                  className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
                <span className="label-mono">Mínimo 8 caracteres</span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="type-ui text-xs">Confirmar contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={bootstrapConfirm}
                  onChange={(e) => setBootstrapConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="min-h-[44px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </label>

              {bootstrapError && (
                <p
                  role="alert"
                  className="border border-border bg-surface p-3 text-sm"
                >
                  {bootstrapError}
                </p>
              )}

              <button
                type="submit"
                disabled={bootstrapLoading}
                className="btn-brutal w-full justify-center"
              >
                {bootstrapLoading ? "Creando…" : "Crear Super Admin y entrar"}
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            </form>
          </>
        ) : (
          <>
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
                <p className="border border-border bg-surface p-3 text-sm">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-brutal w-full justify-center"
              >
                {loading ? "Entrando…" : "Entrar"}
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            </form>

            <button
              type="button"
              onClick={toggleReset}
              aria-expanded={showReset}
              className="type-ui mt-4 flex min-h-[44px] w-full items-center justify-center text-sm underline"
            >
              {showReset
                ? "Volver al inicio de sesión"
                : "¿Olvidaste tu contraseña?"}
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
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              </form>
            )}
          </>
        )}
      </div>

      {devEnabled && devAccounts.length > 0 && (
        <section
          aria-label="Acceso rápido modo desarrollo"
          className="mt-6 border border-border bg-surface p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <p className="label-mono text-foreground">
              MODO DEV · ACCESO RÁPIDO POR ROL
            </p>
            <span className="label-mono border border-border bg-background px-2 py-0.5 text-foreground">
              {devSeeded ? "SANDBOX ACTIVO" : "LISTO PARA PROBAR"}
            </span>
          </div>

          <p className="type-ui mt-3 text-xs leading-relaxed text-foreground/80">
            Entra con un clic como cualquier rol. Se crean automáticamente 3
            proyectos de prueba (<strong>Casa Bruma</strong>,{" "}
            <strong>Atelier Nube</strong> y <strong>Galería Piedra</strong>) con
            Brief, Reporte IA, FF&amp;E y Assets versionados.
          </p>

          <div className="grid-brutal mt-4 grid-cols-1 sm:grid-cols-2">
            {devAccounts.map((acc) => (
              <button
                key={acc.role}
                type="button"
                onClick={() => handleDevQuickLogin(acc.role)}
                disabled={devLoadingRole !== null || devSeeding}
                className="flex min-h-[84px] flex-col justify-between bg-background p-3.5 text-left transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="label-mono">{acc.label}</span>
                  <span className="label-mono" aria-hidden="true">
                    {devLoadingRole === acc.role ? "…" : "↗"}
                  </span>
                </div>
                <div className="mt-2">
                  <p className="text-sm font-medium">{acc.full_name}</p>
                  <p className="mt-0.5 text-[11px] leading-snug opacity-75">
                    {acc.summary}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => handleDevSeed(devSeeded)}
              disabled={devSeeding || devLoadingRole !== null}
              className="label-mono min-h-[44px] border border-border bg-background px-3.5 text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
            >
              {devSeeding
                ? "Preparando datos…"
                : devSeeded
                  ? "Reiniciar proyectos de prueba ↺"
                  : "Cargar proyectos de prueba ↗"}
            </button>
          </div>

          {devMessage && (
            <p className="mt-3 border border-border bg-background p-3 text-xs text-foreground">
              {devMessage}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
