"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";

interface NotificationPayload {
  project_id?: string | null;
  project_title?: string | null;
}

interface AppNotification {
  id: string;
  event_type: string;
  project_id: string | null;
  payload: NotificationPayload | null;
  read_at: string | null;
  created_at: string;
}

function formatEvent(eventType: string): string {
  return eventType === "brief.completed"
    ? "BRIEF COMPLETADO"
    : (eventType ?? "").toUpperCase();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value ?? "";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function NotificationsBell({
  role,
}: {
  /** Role from /auth/me: CLIENT goes to the portal, everyone else to admin. */
  role?: string | null;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/notifications?unread_only=true");
      if (res.ok) {
        const data: unknown = await res.json();
        setNotifications(Array.isArray(data) ? (data as AppNotification[]) : []);
      }
    } catch {
      // A transient failure must not break the layout; the next window focus retries.
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleNotification(item: AppNotification) {
    if (!item?.id) return;
    setPendingId(item.id);
    setMessage("");
    try {
      const res = await apiFetch(`/api/v1/notifications/${item.id}/read`, {
        method: "POST",
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "No se pudo marcar la notificación"));
        return;
      }
      setNotifications((prev) => prev.filter((candidate) => candidate.id !== item.id));
      setOpen(false);
      const projectId = item.payload?.project_id ?? item.project_id;
      if (projectId) {
        const base = role === "CLIENT" ? "/portal/projects" : "/admin/projects";
        router.push(`${base}/${projectId}/brief`);
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setPendingId(null);
    }
  }

  async function handleMarkAll() {
    setMarkingAll(true);
    setMessage("");
    try {
      const res = await apiFetch("/api/v1/notifications/read-all", {
        method: "POST",
      });
      if (res.ok) {
        setNotifications([]);
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "No se pudieron marcar las notificaciones"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setMarkingAll(false);
    }
  }

  const count = notifications.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Notificaciones${count > 0 ? `, ${count} sin leer` : ""}`}
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={() => setOpen((value) => !value)}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center border border-border bg-background p-2"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4" />
        </svg>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="label-mono absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center border border-border bg-foreground px-1 text-background"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notifications-panel"
          role="region"
          aria-label="Notificaciones"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[calc(100vw-2rem)] max-w-[360px] border border-border bg-background"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <p className="label-mono">
              NOTIFICACIONES{count > 0 ? ` · ${count}` : ""}
            </p>
            <button
              type="button"
              aria-label="Cerrar notificaciones"
              onClick={() => setOpen(false)}
              className="label-mono flex min-h-[44px] min-w-[44px] items-center justify-center"
            >
              ✕
            </button>
          </div>

          {message && (
            <p className="border-b border-border bg-surface p-3 text-xs">{message}</p>
          )}

          {count === 0 ? (
            <p className="label-mono p-3">SIN NOTIFICACIONES NUEVAS</p>
          ) : (
            <ul className="flex flex-col gap-px bg-border">
              {notifications.map((item) => (
                <li key={item.id} className="bg-background">
                  <button
                    type="button"
                    disabled={pendingId === item.id}
                    onClick={() => handleNotification(item)}
                    className="flex min-h-[44px] w-full flex-col gap-1 p-3 text-left disabled:opacity-60 sm:hover:bg-surface"
                  >
                    <span className="label-mono">{formatEvent(item.event_type)}</span>
                    <span className="text-sm font-semibold">
                      {item.payload?.project_title ?? "Proyecto"}
                    </span>
                    <span className="label-mono">{formatDate(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={count === 0 || markingAll}
              className="btn-brutal w-full"
            >
              <span>{markingAll ? "MARCANDO…" : "MARCAR TODAS LEÍDAS"}</span>
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
