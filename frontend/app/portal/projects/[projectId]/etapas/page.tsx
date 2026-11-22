"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import { deliverableStatusLabel } from "@/components/DeliverableViewer";

interface Project {
  id: string;
  title: string;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
}

interface Stage {
  id: string;
  project_id: string;
  name: string;
  order_index: number;
  status: "locked" | "active" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface Deliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  status: "in_review" | "changes_requested" | "approved";
  is_final_handover: boolean;
}

interface StageRow {
  stage: Stage;
  deliverables: Deliverable[];
}

const STAGE_STATUS_LABELS: Record<Stage["status"], string> = {
  locked: "Bloqueada",
  active: "En curso",
  approved: "Aprobada",
};

export default function EtapasPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<StageRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [stageFeedback, setStageFeedback] = useState<Record<string, string>>(
    {}
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectRes, stagesRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/stages`),
      ]);

      if (projectRes.ok) {
        setProject(await projectRes.json());
      } else {
        const data: unknown = await projectRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }

      let stages: Stage[] = [];
      if (stagesRes.ok) {
        stages = await stagesRes.json();
      } else {
        const data: unknown = await stagesRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las etapas"));
      }

      const deliverableLists = await Promise.all(
        stages.map((stage) =>
          apiFetch(
            `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`
          ).then(async (res) => {
            if (!res.ok) return [];
            return (await res.json()) as Deliverable[];
          })
        )
      );

      setRows(
        stages.map((stage, index) => ({
          stage,
          deliverables: deliverableLists[index],
        }))
      );
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function approveStage(stage: Stage) {
    if (approvingId) return;
    if (confirmingId !== stage.id) {
      setConfirmingId(stage.id);
      setStageFeedback((prev) => ({ ...prev, [stage.id]: "" }));
      return;
    }

    setApprovingId(stage.id);
    setStageFeedback((prev) => ({ ...prev, [stage.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/approve`,
        { method: "POST" }
      );
      if (res.ok) {
        setConfirmingId(null);
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]: extractDetail(data, "Error al aprobar la etapa"),
        }));
        setConfirmingId(null);
      }
    } catch {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Error de conexión con el servidor",
      }));
      setConfirmingId(null);
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Etapas</h1>
      {project && <p className="label-mono mt-1">{project.title}</p>}
      {project && (
        <p className="label-mono mt-1">
          RONDAS DE CAMBIOS RESTANTES · {project.remaining_rounds}
        </p>
      )}

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      {loading && rows.length === 0 && !message ? (
        <p className="mt-4 text-sm">Cargando…</p>
      ) : rows.length === 0 && !message ? (
        <p className="mt-4 text-sm">Todavía no hay etapas en este proyecto.</p>
      ) : (
        <div className="grid-brutal mt-4">
          {rows.map(({ stage, deliverables }, index) => (
            <article key={stage.id} className="flex flex-col gap-3 p-4">
              <p className="label-mono">
                {String(index + 1).padStart(2, "0")} ·{" "}
                {STAGE_STATUS_LABELS[stage.status]}
              </p>
              <p className="text-sm font-semibold">{stage.name}</p>

              {stage.status === "locked" && (
                <p className="text-sm">
                  Se desbloquea al aprobar la etapa anterior.
                </p>
              )}

              {deliverables.length > 0 && (
                <div className="flex flex-col gap-2">
                  {deliverables.map((deliverable) => (
                    <Link
                      key={deliverable.id}
                      href={`/portal/projects/${projectId}/entregables/${deliverable.id}`}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      <span className="truncate">
                        {deliverable.title} · V{deliverable.version} ·{" "}
                        {deliverableStatusLabel(deliverable.status)}
                        {deliverable.is_final_handover ? " · ENTREGA FINAL" : ""}
                        {deliverable.is_final_handover && project && !project.balance_paid ? " · PAGO PENDIENTE" : ""}
                      </span>
                      <span className="btn-brutal__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {stage.status === "active" && (
                <button
                  type="button"
                  onClick={() => approveStage(stage)}
                  disabled={approvingId !== null}
                  className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                >
                  {approvingId === stage.id
                    ? "Aprobando…"
                    : confirmingId === stage.id
                      ? "Confirmar aprobación"
                      : "Aprobar etapa"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}

              {stageFeedback[stage.id] && (
                <p className="border border-border bg-surface p-3 text-sm">
                  {stageFeedback[stage.id]}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
