"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import { deliverableStatusLabel } from "@/components/DeliverableViewer";

type PortalStageTab = "deliverables" | "changes";

interface Project {
  id: string;
  title: string;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
}

interface Deliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  file_name: string;
  file_extension: string;
  size_bytes: number;
  is_image: boolean;
  asset_id: string;
  status: "in_review" | "changes_requested" | "approved";
  is_final_handover: boolean;
  file_url: string;
}

interface ChangeRequestItem {
  id: string;
  body: string;
  created_by_name: string | null;
  created_at: string;
}

interface ChangeRequest {
  id: string;
  stage_id: string;
  request_number: number;
  status: "open" | "in_progress" | "resolved";
  client_can_add_items: boolean;
  items: ChangeRequestItem[];
  requested_at: string;
  work_started_by_name: string | null;
  work_started_at: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  updated_deliverable: Deliverable | null;
  has_pending_internal_delivery: boolean;
}

interface Stage {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  order_index: number;
  status: "locked" | "active" | "approved";
  max_change_requests: number;
  used_change_requests: number;
  available_change_requests: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  deliverables: Deliverable[];
  change_requests: ChangeRequest[];
}

const STAGE_STATUS_LABELS: Record<Stage["status"], string> = {
  locked: "Bloqueada",
  active: "En curso",
  approved: "Aprobada",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortalEtapasPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Focused stage & active tab
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortalStageTab>("deliverables");

  // Accept deliverables (stage approval)
  const [confirmingApproveId, setConfirmingApproveId] = useState<string | null>(
    null
  );
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // New change request form per stage
  const [openChangeFormStageId, setOpenChangeFormStageId] = useState<
    string | null
  >(null);
  const [newChangeText, setNewChangeText] = useState<Record<string, string>>(
    {}
  );
  const [submittingChangeStageId, setSubmittingChangeStageId] = useState<
    string | null
  >(null);

  // Add item to existing OPEN change request
  const [appendTextByCr, setAppendTextByCr] = useState<Record<string, string>>(
    {}
  );
  const [appendingCrId, setAppendingCrId] = useState<string | null>(null);

  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
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

      if (stagesRes.ok) {
        const loadedStages = (await stagesRes.json()) as Stage[];
        const ordered = [...loadedStages].sort(
          (a, b) => a.order_index - b.order_index
        );
        setStages(ordered);
        setSelectedStageId((prev) => {
          if (prev && ordered.some((s) => s.id === prev)) return prev;
          const active = ordered.find((s) => s.status === "active");
          return active?.id ?? ordered[0]?.id ?? null;
        });
      } else {
        const data: unknown = await stagesRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las etapas"));
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

  function selectStage(stageId: string) {
    setSelectedStageId(stageId);
    setActiveTab("deliverables");
    setConfirmingApproveId(null);
    setOpenChangeFormStageId(null);
  }

  async function handleAcceptDeliverables(stage: Stage) {
    if (approvingId) return;
    if (confirmingApproveId !== stage.id) {
      setConfirmingApproveId(stage.id);
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
        setConfirmingApproveId(null);
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]:
            "Entregables aceptados y etapa aprobada. Se notificó al equipo del estudio.",
        }));
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]: extractDetail(data, "Error al aceptar los entregables"),
        }));
        setConfirmingApproveId(null);
      }
    } catch {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Error de conexión con el servidor",
      }));
      setConfirmingApproveId(null);
    } finally {
      setApprovingId(null);
    }
  }

  async function handleCreateChangeRequest(
    event: React.FormEvent,
    stage: Stage
  ) {
    event.preventDefault();
    const raw = (newChangeText[stage.id] ?? "").trim();
    if (!raw) {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Describe los cambios que necesitas antes de enviar.",
      }));
      return;
    }

    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setSubmittingChangeStageId(stage.id);
    setStageFeedback((prev) => ({ ...prev, [stage.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/change-requests`,
        {
          method: "POST",
          body: JSON.stringify({ items: lines }),
        }
      );
      if (res.ok) {
        setNewChangeText((prev) => ({ ...prev, [stage.id]: "" }));
        setOpenChangeFormStageId(null);
        setActiveTab("changes");
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]:
            "Solicitud de cambios enviada y notificada al equipo. Mientras no inicien trabajo, puedes añadir más detalles en esta ronda.",
        }));
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]: extractDetail(
            data,
            "No se pudo enviar la solicitud de cambios"
          ),
        }));
      }
    } catch {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setSubmittingChangeStageId(null);
    }
  }

  async function handleAppendChangeItem(
    event: React.FormEvent,
    stage: Stage,
    cr: ChangeRequest
  ) {
    event.preventDefault();
    const text = (appendTextByCr[cr.id] ?? "").trim();
    if (!text) {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Escribe el detalle del cambio adicional.",
      }));
      return;
    }

    setAppendingCrId(cr.id);
    setStageFeedback((prev) => ({ ...prev, [stage.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/change-requests/${cr.id}/items`,
        {
          method: "POST",
          body: JSON.stringify({ body: text }),
        }
      );
      if (res.ok) {
        setAppendTextByCr((prev) => ({ ...prev, [cr.id]: "" }));
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]:
            "Cambio adicional registrado en la ronda activa y notificado al equipo.",
        }));
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageFeedback((prev) => ({
          ...prev,
          [stage.id]: extractDetail(
            data,
            "No se pudo agregar el cambio adicional"
          ),
        }));
        await load();
      }
    } catch {
      setStageFeedback((prev) => ({
        ...prev,
        [stage.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setAppendingCrId(null);
    }
  }

  async function handleDownloadDeliverable(
    deliverable: Deliverable,
    key: string
  ) {
    if (deliverable.is_final_handover && project && !project.balance_paid) {
      return;
    }
    setDownloadingKey(key);
    try {
      const blobUrl = await apiFetchBlobUrl(
        `${deliverable.file_url}?download=true`
      );
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = deliverable.file_name || "entregable";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    } finally {
      setDownloadingKey(null);
    }
  }

  const selectedIndex = stages.findIndex((s) => s.id === selectedStageId);
  const stage = selectedIndex >= 0 ? stages[selectedIndex] : stages[0];
  const approvedCount = stages.filter((s) => s.status === "approved").length;
  const progressPct =
    stages.length > 0 ? Math.round((approvedCount / stages.length) * 100) : 0;

  const activeCr = stage?.change_requests.find(
    (cr) => cr.status === "open" || cr.status === "in_progress"
  );
  const canStartNewChangeRequest = Boolean(
    stage &&
      stage.status === "active" &&
      !activeCr &&
      stage.available_change_requests > 0
  );
  const reachedChangeLimit = Boolean(
    stage &&
      stage.status === "active" &&
      !activeCr &&
      stage.available_change_requests === 0
  );
  const isApproved = stage?.status === "approved";
  const isLocked = stage?.status === "locked";

  return (
    <section className="brief-editorial space-y-8">
      {/* Page Header */}
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">
          02 · Revisión de entregables y solicitud de cambios
        </p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Etapas del proyecto
        </h1>
        {project && (
          <p className="type-editorial mt-1.5 text-sm italic text-stone-600">
            {project.title}
          </p>
        )}
      </div>

      {message && (
        <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-700">
          {message}
        </p>
      )}

      {loading && stages.length === 0 && !message ? (
        <p className="type-ui text-sm text-stone-600">Cargando etapas…</p>
      ) : stages.length === 0 && !message ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-[15px] italic text-stone-600">
            Todavía no hay etapas configuradas en este proyecto.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress Overview & Phase Stepper Rail */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="type-tech text-stone-500">
                Avance del proyecto · {approvedCount} de {stages.length} etapas
                aprobadas
              </span>
              <span className="type-tech tabular-nums text-stone-600">
                {progressPct}%
              </span>
            </div>

            <div className="h-[2px] w-full overflow-hidden bg-stone-900/10">
              <div
                className="h-full bg-[#5F7161] transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
              {stages.map((item, idx) => {
                const isSelected = stage?.id === item.id;
                const itemApproved = item.status === "approved";
                const itemLocked = item.status === "locked";

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectStage(item.id)}
                    aria-pressed={isSelected}
                    className={`interactive-card flex min-h-[100px] flex-col justify-between rounded-xl border p-4 text-left ${
                      isSelected
                        ? "border-stone-900 bg-background shadow-editorial"
                        : itemApproved
                          ? "border-[#5F7161]/30 bg-[#EEF2EC]/35 hover:border-[#5F7161]/60"
                          : itemLocked
                            ? "border-stone-900/10 bg-surface/50 opacity-80 hover:opacity-100"
                            : "border-stone-900/15 bg-background/80 hover:border-stone-900/40"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="type-tech text-stone-500">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`type-tech ${
                          itemApproved
                            ? "text-[#44544A]"
                            : itemLocked
                              ? "text-stone-400"
                              : "text-stone-900"
                        }`}
                      >
                        {STAGE_STATUS_LABELS[item.status]}
                      </span>
                    </div>

                    <p className="type-editorial mt-2 line-clamp-2 text-[15px] font-medium leading-snug text-stone-900">
                      {item.name}
                    </p>

                    <p className="type-tech mt-3 text-[10px] text-stone-500">
                      {item.deliverables.length} entregables ·{" "}
                      {item.available_change_requests} cambios disp.
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Focused Stage Canvas */}
          {stage && (
            <article
              key={stage.id}
              className={`animate-panel-enter rounded-2xl border bg-background shadow-editorial ${
                isApproved ? "border-[#5F7161]/40" : "border-stone-900/15"
              }`}
            >
              {/* Stage Header + Clear Change Counter */}
              <div className="flex flex-col gap-5 border-b border-stone-900/10 px-6 py-6 md:flex-row md:items-start md:justify-between md:px-8 md:py-7">
                <div className="min-w-0 max-w-2xl space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="type-tech text-stone-500">
                      Etapa {String(selectedIndex + 1).padStart(2, "0")}
                    </span>
                    <span aria-hidden="true" className="text-stone-300">
                      ·
                    </span>
                    <span
                      className={`type-tech ${
                        isApproved
                          ? "text-[#44544A]"
                          : isLocked
                            ? "text-stone-400"
                            : "text-stone-900"
                      }`}
                    >
                      {STAGE_STATUS_LABELS[stage.status]}
                    </span>
                    {stage.approved_at && (
                      <>
                        <span aria-hidden="true" className="text-stone-300">
                          ·
                        </span>
                        <span className="type-tech text-[#44544A]">
                          Aprobada el {formatDate(stage.approved_at)}
                        </span>
                      </>
                    )}
                  </div>

                  <h2 className="type-title text-2xl text-stone-900 md:text-3xl">
                    {stage.name}
                  </h2>

                  {stage.description && (
                    <p className="type-editorial text-[15px] leading-relaxed text-stone-600">
                      {stage.description}
                    </p>
                  )}
                </div>

                {/* Clean Tabular Change Budget Display */}
                <div className="flex shrink-0 items-center gap-6 border-t border-stone-900/10 pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
                  <div>
                    <p className="type-tech text-stone-500">
                      Cambios disponibles
                    </p>
                    <p className="type-title mt-1 text-2xl tabular-nums text-stone-900">
                      {stage.available_change_requests}
                    </p>
                  </div>
                  <div className="h-9 w-px bg-stone-900/10" aria-hidden="true" />
                  <div>
                    <p className="type-tech text-stone-500">Usados</p>
                    <p className="type-title mt-1 text-2xl tabular-nums text-stone-500">
                      {stage.used_change_requests}/{stage.max_change_requests}
                    </p>
                  </div>
                </div>
              </div>

              {/* Locked Notice */}
              {isLocked && (
                <div className="border-b border-stone-900/10 bg-surface/50 px-6 py-4 md:px-8">
                  <p className="type-editorial text-sm italic text-stone-600">
                    Esta etapa se desbloqueará automáticamente cuando aceptes
                    los entregables de la etapa anterior.
                  </p>
                </div>
              )}

              {/* Focused Client Decision Strip (Only when Stage is Active) */}
              {stage.status === "active" && (
                <div className="space-y-4 border-b border-stone-900/10 bg-surface/45 px-6 py-5 md:px-8">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="type-tech text-stone-600">
                        Decisión de revisión
                      </p>
                      <p className="type-editorial text-[15px] text-stone-700">
                        {activeCr?.status === "open"
                          ? `La Ronda #${activeCr.request_number} está abierta: puedes seguir agregando detalles en "Cambios y ajustes" mientras el equipo no inicie trabajo.`
                          : activeCr?.status === "in_progress"
                            ? `El equipo ya está trabajando en la Ronda #${activeCr.request_number}. Te avisaremos al subir el entregable actualizado.`
                            : reachedChangeLimit
                              ? `Consumiste las ${stage.max_change_requests} solicitudes de cambios incluidas en esta etapa.`
                              : "Revisa los archivos publicados y decide si apruebas esta etapa o solicitas una ronda de ajustes."}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleAcceptDeliverables(stage)}
                        disabled={approvingId !== null}
                        className={`type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg px-5 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          confirmingApproveId === stage.id
                            ? "bg-[#44544A] text-background hover:bg-[#38463D]"
                            : "bg-stone-900 text-background hover:bg-stone-800"
                        }`}
                      >
                        {approvingId === stage.id
                          ? "Aceptando…"
                          : confirmingApproveId === stage.id
                            ? "Confirmar aceptación ✓"
                            : "Aceptar entregables ↗"}
                      </button>

                      {confirmingApproveId === stage.id && (
                        <button
                          type="button"
                          onClick={() => setConfirmingApproveId(null)}
                          className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                        >
                          Cancelar
                        </button>
                      )}

                      {canStartNewChangeRequest && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenChangeFormStageId((prev) =>
                              prev === stage.id ? null : stage.id
                            )
                          }
                          className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/25 bg-background px-5 py-2 text-xs text-stone-900 transition-colors hover:bg-stone-900 hover:text-background"
                        >
                          {openChangeFormStageId === stage.id
                            ? "Cerrar formulario"
                            : "Solicitar cambios"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline New Change Request Composer */}
                  {openChangeFormStageId === stage.id &&
                    canStartNewChangeRequest && (
                      <form
                        onSubmit={(e) => handleCreateChangeRequest(e, stage)}
                        className="animate-panel-enter space-y-3 border-t border-stone-900/10 pt-4"
                      >
                        <p className="type-tech text-stone-600">
                          Nueva solicitud de cambios · Consume 1 de{" "}
                          {stage.available_change_requests} disponibles
                        </p>
                        <textarea
                          value={newChangeText[stage.id] ?? ""}
                          onChange={(e) =>
                            setNewChangeText((prev) => ({
                              ...prev,
                              [stage.id]: e.target.value,
                            }))
                          }
                          rows={3}
                          maxLength={4000}
                          placeholder="Detalla los ajustes que necesitas (puedes escribir un cambio por línea)…"
                          className="type-ui w-full rounded-xl border border-stone-900/15 bg-background p-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                        />
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="submit"
                            disabled={submittingChangeStageId === stage.id}
                            className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                          >
                            {submittingChangeStageId === stage.id
                              ? "Enviando solicitud…"
                              : "Enviar solicitud ↗"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenChangeFormStageId(null)}
                            className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                </div>
              )}

              {stageFeedback[stage.id] && (
                <div className="animate-slide-down border-b border-[#5F7161]/25 bg-[#EEF2EC]/75 px-6 py-3.5 md:px-8">
                  <p className="type-ui text-sm text-[#44544A]">
                    {stageFeedback[stage.id]}
                  </p>
                </div>
              )}

              {/* Workspace Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-900/10 px-6 md:px-8">
                <div
                  role="tablist"
                  aria-label="Vistas de la etapa"
                  className="flex items-center gap-6 overflow-x-auto"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "deliverables"}
                    onClick={() => setActiveTab("deliverables")}
                    className={`type-ui relative min-h-[48px] shrink-0 whitespace-nowrap py-3 text-sm transition-colors ${
                      activeTab === "deliverables"
                        ? "font-medium text-stone-900"
                        : "text-stone-500 hover:text-stone-900"
                    }`}
                  >
                    Entregables{" "}
                    <span className="type-tech ml-1 text-stone-400">
                      {stage.deliverables.length}
                    </span>
                    {activeTab === "deliverables" && (
                      <span
                        aria-hidden="true"
                        className="animate-tab-indicator absolute inset-x-0 bottom-0 h-[2px] bg-stone-900"
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "changes"}
                    onClick={() => setActiveTab("changes")}
                    className={`type-ui relative min-h-[48px] shrink-0 whitespace-nowrap py-3 text-sm transition-colors ${
                      activeTab === "changes"
                        ? "font-medium text-stone-900"
                        : "text-stone-500 hover:text-stone-900"
                    }`}
                  >
                    Cambios y ajustes{" "}
                    <span className="type-tech ml-1 text-stone-400">
                      {stage.change_requests.length}
                    </span>
                    {activeTab === "changes" && (
                      <span
                        aria-hidden="true"
                        className="animate-tab-indicator absolute inset-x-0 bottom-0 h-[2px] bg-stone-900"
                      />
                    )}
                  </button>
                </div>

                <Link
                  href={`/portal/projects/${projectId}/assets`}
                  className="type-tech shrink-0 whitespace-nowrap py-2 text-stone-600 underline decoration-stone-900/25 underline-offset-4 transition-colors hover:text-stone-900"
                >
                  Abrir Librería de Assets <span className="arrow-glide">↗</span>
                </Link>
              </div>

              {/* Tab Content */}
              <div
                key={activeTab}
                className="animate-panel-enter px-6 py-6 md:px-8 md:py-7"
              >
                {/* TAB 1: DELIVERABLES */}
                {activeTab === "deliverables" && (
                  <>
                    {stage.deliverables.length === 0 ? (
                      <p className="type-editorial py-4 text-base italic text-stone-500">
                        El estudio aún no ha publicado entregables en esta
                        etapa.
                      </p>
                    ) : (
                      <div className="divide-y divide-stone-900/10">
                        {stage.deliverables.map((deliverable) => {
                          const lockedByPayment =
                            deliverable.is_final_handover &&
                            project !== null &&
                            !project.balance_paid;

                          return (
                            <div
                              key={deliverable.id}
                              className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-baseline gap-2">
                                  <p className="type-editorial text-lg text-stone-900">
                                    {deliverable.title}
                                  </p>
                                  <span className="type-tech text-stone-500">
                                    v{deliverable.version}
                                  </span>
                                  {deliverable.is_final_handover && (
                                    <span className="type-tech text-[#44544A]">
                                      · Entrega final
                                    </span>
                                  )}
                                </div>
                                <p className="type-tech text-stone-500">
                                  {deliverable.file_extension.toUpperCase()} ·{" "}
                                  {formatBytes(deliverable.size_bytes)} ·{" "}
                                  {deliverableStatusLabel(deliverable.status)}
                                  {lockedByPayment ? " · Saldo pendiente" : ""}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {deliverable.is_image && (
                                  <Link
                                    href={`/portal/projects/${projectId}/entregables/${deliverable.id}`}
                                    className="type-ui inline-flex min-h-[42px] shrink-0 whitespace-nowrap items-center rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                                  >
                                    Revisar con pines ↗
                                  </Link>
                                )}

                                {!lockedByPayment && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDownloadDeliverable(
                                        deliverable,
                                        deliverable.id
                                      )
                                    }
                                    disabled={downloadingKey === deliverable.id}
                                    className="type-ui min-h-[42px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                                  >
                                    {downloadingKey === deliverable.id
                                      ? "Descargando…"
                                      : "Descargar ↗"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* TAB 2: CHANGE REQUESTS LOG */}
                {activeTab === "changes" && (
                  <>
                    {stage.change_requests.length === 0 ? (
                      <div className="py-4">
                        <p className="type-editorial text-base italic text-stone-500">
                          Aún no se han registrado solicitudes de cambios en
                          esta etapa.
                        </p>
                        {canStartNewChangeRequest && (
                          <button
                            type="button"
                            onClick={() => setOpenChangeFormStageId(stage.id)}
                            className="type-ui mt-4 min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                          >
                            Solicitar cambios ({stage.available_change_requests}{" "}
                            disponibles)
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="divide-y divide-stone-900/15">
                        {stage.change_requests.map((cr) => (
                          <div
                            key={cr.id}
                            className="space-y-4 py-6 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <span className="type-title text-base text-stone-900">
                                  Ronda #{cr.request_number}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-stone-300"
                                >
                                  ·
                                </span>
                                <span
                                  className={`type-tech ${
                                    cr.status === "resolved"
                                      ? "text-[#44544A]"
                                      : "text-stone-700"
                                  }`}
                                >
                                  {cr.status === "open"
                                    ? "Abierta · Puedes agregar más cambios"
                                    : cr.status === "in_progress"
                                      ? "En progreso · Cambios bloqueados"
                                      : "Entregable actualizado"}
                                </span>
                              </div>
                              <span className="type-tech text-stone-500">
                                {formatDate(cr.requested_at)}
                              </span>
                            </div>

                            <ol className="divide-y divide-stone-900/10 border-y border-stone-900/10">
                              {cr.items.map((item, idx) => (
                                <li key={item.id} className="flex gap-4 py-3.5">
                                  <span className="type-tech mt-1 shrink-0 text-stone-400">
                                    {String(idx + 1).padStart(2, "0")}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="type-editorial text-[15px] leading-relaxed text-stone-900">
                                      {item.body}
                                    </p>
                                    <p className="type-tech mt-1 text-stone-400">
                                      {formatDate(item.created_at)}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ol>

                            {/* Append more items while team hasn't started work */}
                            {cr.status === "open" && cr.client_can_add_items && (
                              <form
                                onSubmit={(e) =>
                                  handleAppendChangeItem(e, stage, cr)
                                }
                                className="space-y-3 rounded-xl border border-stone-900/10 bg-surface/55 p-4"
                              >
                                <p className="type-tech text-stone-600">
                                  Agregar otro detalle a esta ronda (mientras el
                                  equipo no inicie el trabajo)
                                </p>
                                <textarea
                                  value={appendTextByCr[cr.id] ?? ""}
                                  onChange={(e) =>
                                    setAppendTextByCr((prev) => ({
                                      ...prev,
                                      [cr.id]: e.target.value,
                                    }))
                                  }
                                  rows={2}
                                  maxLength={2000}
                                  placeholder="Escribe otro ajuste o precisión para esta ronda…"
                                  className="type-ui w-full rounded-lg border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                                />
                                <button
                                  type="submit"
                                  disabled={appendingCrId === cr.id}
                                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                                >
                                  {appendingCrId === cr.id
                                    ? "Agregando…"
                                    : "Agregar a la ronda ↗"}
                                </button>
                              </form>
                            )}

                            {/* Locked notice once team starts work */}
                            {cr.status === "in_progress" && (
                              <p className="type-ui rounded-xl border border-stone-900/10 bg-surface/55 px-4 py-3 text-xs leading-relaxed text-stone-600">
                                <strong className="font-medium text-stone-900">
                                  Ronda en curso:
                                </strong>{" "}
                                {cr.work_started_by_name || "El equipo"} inició
                                los ajustes el {formatDate(cr.work_started_at)}.
                                Ya no es posible añadir nuevos cambios en esta
                                ronda.
                              </p>
                            )}

                            {/* Resolved with updated deliverable */}
                            {cr.status === "resolved" && (
                              <div className="space-y-3 rounded-xl border border-[#5F7161]/30 bg-[#EEF2EC]/60 p-4">
                                <p className="type-tech text-[#44544A]">
                                  Ajustes entregados ·{" "}
                                  {formatDate(cr.resolved_at)}
                                </p>
                                {cr.resolution_note && (
                                  <p className="type-editorial text-[15px] leading-relaxed text-stone-800">
                                    {cr.resolution_note}
                                  </p>
                                )}
                                {cr.updated_deliverable ? (
                                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#5F7161]/20 pt-3">
                                    <div>
                                      <p className="type-editorial text-base text-stone-900">
                                        {cr.updated_deliverable.title} (v
                                        {cr.updated_deliverable.version})
                                      </p>
                                      <p className="type-tech mt-0.5 text-stone-500">
                                        {cr.updated_deliverable.file_name}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          cr.updated_deliverable &&
                                          handleDownloadDeliverable(
                                            cr.updated_deliverable,
                                            `cr-${cr.id}`
                                          )
                                        }
                                        className="type-ui min-h-[40px] rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800"
                                      >
                                        Descargar actualizado ↗
                                      </button>
                                      <Link
                                        href={`/portal/projects/${projectId}/assets`}
                                        className="type-ui inline-flex min-h-[40px] items-center rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                                      >
                                        Ver en Assets ↗
                                      </Link>
                                    </div>
                                  </div>
                                ) : cr.has_pending_internal_delivery ? (
                                  <p className="type-editorial text-sm italic text-stone-600">
                                    El entregable actualizado está en revisión
                                    interna del Lead Designer antes de
                                    habilitarse para descarga.
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
