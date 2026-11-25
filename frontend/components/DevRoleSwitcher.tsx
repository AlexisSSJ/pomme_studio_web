"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/auth";
import { extractDetail } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface DevAccount {
  role: string;
  email: string;
  full_name: string;
  specialty: string | null;
  label: string;
  summary: string;
}

interface DevRoleSwitcherProps {
  currentRole: string | null;
  onRoleSwitched?: (nextRole: string) => void;
}

export default function DevRoleSwitcher({
  currentRole,
  onRoleSwitched,
}: DevRoleSwitcherProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [accounts, setAccounts] = useState<DevAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDevStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/dev-status`);
        if (!res.ok) return;
        const data: { enabled?: boolean; accounts?: DevAccount[] } =
          await res.json();
        if (active && data.enabled) {
          setEnabled(true);
          setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        }
      } catch {
        // Hidden whenever dev mode is unavailable.
      }
    }
    void loadDevStatus();
    return () => {
      active = false;
    };
  }, []);

  if (!enabled || accounts.length === 0) {
    return null;
  }

  async function switchToRole(role: string) {
    setBusyRole(role);
    setStatusMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        setStatusMessage(extractDetail(body, "No se pudo cambiar de rol"));
        return;
      }
      const data: { access_token: string; user?: { role: string } } =
        await res.json();
      setToken(data.access_token);
      const nextRole = data.user?.role ?? role;
      setOpen(false);
      onRoleSwitched?.(nextRole);
      router.push(nextRole === "CLIENT" ? "/portal" : "/admin/projects");
    } catch {
      setStatusMessage("Error de conexión al cambiar de rol");
    } finally {
      setBusyRole(null);
    }
  }

  async function handleResetSeed() {
    setSeeding(true);
    setStatusMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        setStatusMessage("Proyectos de prueba restaurados ✓");
        onRoleSwitched?.(currentRole ?? "SUPER_ADMIN");
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setStatusMessage(extractDetail(body, "No se pudieron restaurar"));
      }
    } catch {
      setStatusMessage("Error de conexión");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
      {open && (
        <div className="animate-popover-enter w-[300px] origin-bottom-right border border-ink bg-background p-4">
          <div className="flex items-center justify-between gap-2 border-b border-ink pb-2">
            <p className="label-mono text-ink">MODO DEV · CAMBIAR ROL</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar selector dev"
              className="label-mono flex min-h-[36px] min-w-[36px] items-center justify-center border border-ink text-ink transition-colors duration-150 hover:bg-ink hover:text-background"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2">
            {accounts.map((acc) => {
              const isCurrent = currentRole === acc.role;
              return (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => switchToRole(acc.role)}
                  disabled={busyRole !== null}
                  className={`group flex min-h-[44px] flex-col items-start justify-center border border-ink px-3 py-2 text-left transition-[background-color,color,transform] duration-150 active:scale-[0.985] ${
                    isCurrent
                      ? "bg-ink text-background"
                      : "bg-background text-ink hover:bg-surface"
                  } disabled:opacity-50`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="label-mono">{acc.label}</span>
                    <span className="label-mono arrow-glide">
                      {busyRole === acc.role
                        ? "Entrando…"
                        : isCurrent
                          ? "ACTUAL"
                          : "↗"}
                    </span>
                  </div>
                  <span
                    className={`mt-0.5 text-xs ${
                      isCurrent ? "text-background/80" : "text-ink/70"
                    }`}
                  >
                    {acc.full_name}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-ink/25 pt-3">
            <button
              type="button"
              onClick={handleResetSeed}
              disabled={seeding}
              className="label-mono min-h-[44px] w-full border border-ink bg-surface px-3 text-ink transition-colors duration-150 hover:bg-ink hover:text-background disabled:opacity-50"
            >
              {seeding
                ? "Restaurando datos…"
                : "Reiniciar proyectos de prueba ↺"}
            </button>
          </div>

          {statusMessage && (
            <p className="animate-slide-down mt-2 text-xs text-ink">
              {statusMessage}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="label-mono min-h-[44px] border border-ink bg-ink px-4 text-background transition-[background-color,color,transform] duration-150 hover:bg-background hover:text-ink active:scale-[0.98]"
      >
        DEV · {currentRole ?? "ROL"} {open ? "↓" : "↑"}
      </button>
    </div>
  );
}
