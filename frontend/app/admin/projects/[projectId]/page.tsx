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

export default function AdminProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resProject, resClients] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch("/api/v1/admin/clients").catch(() => null),
      ]);
      if (resProject.ok) {
        setProject(await resProject.json());
      } else {
        const data: unknown = await resProject.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }
      if (resClients && resClients.ok) {
        setClients(await resClients.json());
      }
    } catch {
      setMessage("Error de conexión con el servidor");
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

  return (
    <section>
      <h1 className="type-title text-xl">Resumen del proyecto</h1>

      {message && (
        <p className="type-ui mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {loading && !project ? (
        <p className="type-ui mt-4 text-sm">Cargando…</p>
      ) : project ? (
        <>
          <div className="grid-brutal mt-4 grid-cols-1 sm:grid-cols-2">
            <div className="p-4">
              <p className="label-mono">01 · Estado</p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{project.status}</p>
            </div>
            <div className="p-4">
              <p className="label-mono">02 · Scope</p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {project.scope_type || "sin scope"}
              </p>
            </div>
            <div className="p-4">
              <p className="label-mono">03 · Rondas de cambios</p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {project.remaining_rounds}/{project.included_rounds}
              </p>
            </div>
            <div className="p-4">
              <p className="label-mono">04 · Pago final</p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {project.balance_paid ? "PAGADO" : "PENDIENTE"}
              </p>
            </div>
          </div>

          <div className="mt-4 border border-border bg-surface p-4">
            <p className="label-mono">Cliente del proyecto</p>
            <select
              value={project.client_id || ""}
              onChange={(event) => assignClient(event.target.value)}
              disabled={assigning}
              className="type-ui mt-2 min-h-[44px] w-full border border-border bg-background px-3 text-sm sm:w-auto sm:min-w-[320px]"
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
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {project.status === "draft" && (
              <button
                type="button"
                onClick={activateProject}
                disabled={activating}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                {activating ? "Activando…" : "Activar proyecto"}
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            )}
            {project.status !== "draft" && !project.balance_paid && (
              <button
                type="button"
                onClick={validateFinalPayment}
                disabled={validating}
                className="btn-brutal min-h-[44px] px-3 text-xs"
              >
                {validating ? "Validando…" : "Validar pago final"}
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
