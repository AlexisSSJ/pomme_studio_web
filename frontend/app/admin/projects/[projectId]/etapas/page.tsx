"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import DeliverableViewer, {
  deliverableStatusLabel,
} from "@/components/DeliverableViewer";
import MeetingScheduler from "@/components/MeetingScheduler";

type UserRole = "SUPER_ADMIN" | "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT";
type AssetVisibility = "internal_only" | "client_visible" | "custom";
type SubtaskStatus = "pending" | "in_progress" | "done";
type StageTab = "deliverables" | "subtasks" | "changes";

interface Project {
  id: string;
  title: string;
  status: string;
  lead_designer_id: string | null;
  included_rounds: number;
  remaining_rounds: number;
}

interface Subtask {
  id: string;
  stage_id: string;
  title: string;
  description: string | null;
  status: SubtaskStatus;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Deliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  file_name: string;
  file_extension: string;
  content_type: string;
  size_bytes: number;
  is_image: boolean;
  asset_id: string;
  asset_version_id: string;
  change_request_id: string | null;
  status: "in_review" | "changes_requested" | "approved";
  is_client_visible: boolean;
  visibility: AssetVisibility;
  visible_roles: UserRole[];
  visible_user_ids: string[];
  is_final_handover: boolean;
  published_at: string | null;
  created_by_name: string | null;
  created_at: string;
  file_url: string;
}

interface ChangeRequestItem {
  id: string;
  body: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

interface ChangeRequest {
  id: string;
  project_id: string;
  stage_id: string;
  request_number: number;
  status: "open" | "in_progress" | "resolved";
  client_can_add_items: boolean;
  items: ChangeRequestItem[];
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  work_started_by_name: string | null;
  work_started_at: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  updated_deliverable: Deliverable | null;
  updated_asset: {
    id: string;
    title: string;
    version_number: number;
    file_name: string;
    file_url: string | null;
  } | null;
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
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  subtasks: Subtask[];
  deliverables: Deliverable[];
  change_requests: ChangeRequest[];
}

interface Me {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

interface MemberSummary {
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  assigned_role: string;
}

const ACCEPTED_EXTENSIONS =
  ".jpg,.jpeg,.png,.webp,.svg,.gif,.pdf,.ai,.fig,.zip,.psd,.sketch,.indd,.dwg,.dxf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";

const STAGE_STATUS_LABELS: Record<Stage["status"], string> = {
  locked: "Bloqueada",
  active: "En curso",
  approved: "Aprobada",
};

const SUBTASK_STATUS_LABELS: Record<SubtaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
};

const VISIBILITY_LABELS: Record<AssetVisibility, string> = {
  internal_only: "Solo interno",
  client_visible: "Visible cliente",
  custom: "Personalizada",
};

const GRANULAR_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "LEAD_DESIGNER", label: "Lead Designer" },
  { value: "COLLABORATOR", label: "Collaborator" },
  { value: "CLIENT", label: "Cliente" },
];

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

function nextSubtaskStatus(current: SubtaskStatus): SubtaskStatus {
  if (current === "pending") return "in_progress";
  if (current === "in_progress") return "done";
  return "pending";
}

function getStageDeletionAssessment(stage: Stage) {
  const subtasksWithProgress = stage.subtasks.filter(
    (s) => s.status === "in_progress" || s.status === "done"
  ).length;
  const isInProgressOrApproved =
    stage.status === "active" || stage.status === "approved";
  const hasProgress =
    subtasksWithProgress > 0 ||
    stage.deliverables.length > 0 ||
    stage.change_requests.length > 0 ||
    stage.used_change_requests > 0;
  return {
    isInProgressOrApproved,
    hasProgress,
    requiresDoubleConfirmation: isInProgressOrApproved || hasProgress,
    subtasksWithProgress,
    deliverablesCount: stage.deliverables.length,
    changeRequestsCount: stage.change_requests.length,
  };
}

function StageWorkspace({
  projectId,
  number,
  stage,
  me,
  members,
  canDeleteStage,
  onRequestDelete,
  onChanged,
}: {
  projectId: string;
  number: number;
  stage: Stage;
  me: Me | null;
  members: MemberSummary[];
  canDeleteStage: boolean;
  onRequestDelete: (stage: Stage) => void;
  onChanged: () => void;
}) {
  const canManageVisibility =
    me?.role === "LEAD_DESIGNER" || me?.role === "SUPER_ADMIN";
  const teamMembers = members.filter((m) => m.role !== "CLIENT");

  const openChangeCount = stage.change_requests.filter(
    (cr) => cr.status === "open" || cr.status === "in_progress"
  ).length;

  const [activeTab, setActiveTab] = useState<StageTab>(
    stage.status === "locked" ? "subtasks" : "deliverables"
  );
  const [showUploadForm, setShowUploadForm] = useState(false);

  // Reset transient panels when switching to a different stage
  useEffect(() => {
    setActiveTab(stage.status === "locked" ? "subtasks" : "deliverables");
    setShowUploadForm(false);
    setViewerDeliverableId(null);
    setActiveDeliveryCrId(null);
    setUploadMessage("");
    setSubtaskMsg("");
  }, [stage.id, stage.status]);

  // Subtasks state
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState("");
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [subtaskMsg, setSubtaskMsg] = useState("");

  // Deliverable upload state
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [changelog, setChangelog] = useState("");
  const [uploadVisibility, setUploadVisibility] =
    useState<AssetVisibility>("internal_only");
  const [uploadVisibleRoles, setUploadVisibleRoles] = useState<UserRole[]>([]);
  const [uploadVisibleUserIds, setUploadVisibleUserIds] = useState<string[]>(
    []
  );
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [viewerDeliverableId, setViewerDeliverableId] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Deliverable actions state
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpublishingConfirmId, setUnpublishingConfirmId] = useState<
    string | null
  >(null);
  const [handoverTogglingId, setHandoverTogglingId] = useState<string | null>(
    null
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deliverableMessages, setDeliverableMessages] = useState<
    Record<string, string>
  >({});

  // Change request team actions
  const [startingCrId, setStartingCrId] = useState<string | null>(null);
  const [activeDeliveryCrId, setActiveDeliveryCrId] = useState<string | null>(
    null
  );
  const [crDeliverTitle, setCrDeliverTitle] = useState("");
  const [crDeliverNote, setCrDeliverNote] = useState("");
  const [crDeliverFile, setCrDeliverFile] = useState<File | null>(null);
  const [crTargetAssetId, setCrTargetAssetId] = useState("");
  const [crDeliverVisibility, setCrDeliverVisibility] =
    useState<AssetVisibility>("client_visible");
  const [crDeliverBusy, setCrDeliverBusy] = useState(false);
  const [crFeedback, setCrFeedback] = useState<Record<string, string>>({});

  async function handleAddSubtask(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) {
      setSubtaskMsg("Escribe el nombre de la subtarea.");
      return;
    }
    setSubtaskBusy(true);
    setSubtaskMsg("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/subtasks`,
        {
          method: "POST",
          body: JSON.stringify({
            title: trimmed,
            assigned_to: newSubtaskAssignee || null,
          }),
        }
      );
      if (res.ok) {
        setNewSubtaskTitle("");
        setNewSubtaskAssignee("");
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setSubtaskMsg(extractDetail(data, "No se pudo agregar la subtarea"));
      }
    } catch {
      setSubtaskMsg("Error de conexión con el servidor");
    } finally {
      setSubtaskBusy(false);
    }
  }

  async function handleUpdateSubtask(
    subtaskId: string,
    patch: { status?: SubtaskStatus; assigned_to?: string | null }
  ) {
    setSubtaskMsg("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/subtasks/${subtaskId}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setSubtaskMsg(extractDetail(data, "No se pudo actualizar la subtarea"));
      }
    } catch {
      setSubtaskMsg("Error de conexión con el servidor");
    }
  }

  async function handleDeleteSubtask(subtaskId: string) {
    setSubtaskMsg("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/subtasks/${subtaskId}`,
        { method: "DELETE" }
      );
      if (res.ok || res.status === 204) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setSubtaskMsg(extractDetail(data, "No se pudo eliminar la subtarea"));
      }
    } catch {
      setSubtaskMsg("Error de conexión con el servidor");
    }
  }

  async function handlePublish(deliverable: Deliverable) {
    setPublishingId(deliverable.id);
    setDeliverableMessages((prev) => ({ ...prev, [deliverable.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverable.id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            visibility: "client_visible",
            is_final_handover: deliverable.is_final_handover,
          }),
        }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverable.id]: extractDetail(data, "Error al publicar entregable"),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverable.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setPublishingId(null);
    }
  }

  async function handleUnpublish(deliverableId: string) {
    setPublishingId(deliverableId);
    setUnpublishingConfirmId(null);
    setDeliverableMessages((prev) => ({ ...prev, [deliverableId]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverableId}/unpublish`,
        { method: "POST" }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverableId]: extractDetail(
            data,
            "Error al despublicar entregable"
          ),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverableId]: "Error de conexión con el servidor",
      }));
    } finally {
      setPublishingId(null);
    }
  }

  async function handleToggleHandover(deliverable: Deliverable) {
    setHandoverTogglingId(deliverable.id);
    setDeliverableMessages((prev) => ({ ...prev, [deliverable.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverable.id}/final-handover`,
        {
          method: "POST",
          body: JSON.stringify({
            is_final_handover: !deliverable.is_final_handover,
          }),
        }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverable.id]: extractDetail(
            data,
            "Error al actualizar entrega final"
          ),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverable.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setHandoverTogglingId(null);
    }
  }

  async function handleDownloadFile(url: string, fileName: string, key: string) {
    setDownloadingId(key);
    try {
      const blobUrl = await apiFetchBlobUrl(`${url}?download=true`);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Surface via deliverableMessages if applicable
    } finally {
      setDownloadingId(null);
    }
  }

  async function uploadDeliverable(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setUploadMessage("El título no puede estar vacío.");
      return;
    }
    if (!file) {
      setUploadMessage("Selecciona un archivo.");
      return;
    }
    if (
      canManageVisibility &&
      uploadVisibility === "custom" &&
      uploadVisibleRoles.length === 0 &&
      uploadVisibleUserIds.length === 0
    ) {
      setUploadMessage(
        "Para visibilidad personalizada selecciona al menos un rol o usuario."
      );
      return;
    }

    setUploading(true);
    setUploadMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", trimmedTitle);
      if (changelog.trim()) {
        form.append("changelog", changelog.trim());
      }
      if (canManageVisibility) {
        form.append("visibility", uploadVisibility);
        if (uploadVisibility === "custom") {
          form.append("visible_roles", JSON.stringify(uploadVisibleRoles));
          form.append("visible_user_ids", JSON.stringify(uploadVisibleUserIds));
        }
      }

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        setUploadMessage(
          "Entregable subido y sincronizado automáticamente en Librería de Assets."
        );
        setTitle("");
        setChangelog("");
        setFile(null);
        setUploadVisibleRoles([]);
        setUploadVisibleUserIds([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setShowUploadForm(false);
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setUploadMessage(extractDetail(data, "Error al subir el entregable"));
      }
    } catch {
      setUploadMessage("Error de conexión con el servidor");
    } finally {
      setUploading(false);
    }
  }

  async function handleStartWork(crId: string) {
    setStartingCrId(crId);
    setCrFeedback((prev) => ({ ...prev, [crId]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/change-requests/${crId}/start-work`,
        { method: "POST" }
      );
      if (res.ok) {
        setCrFeedback((prev) => ({
          ...prev,
          [crId]:
            "Inicio de trabajo confirmado. Se bloqueó el ingreso de nuevos cambios del cliente para esta ronda.",
        }));
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setCrFeedback((prev) => ({
          ...prev,
          [crId]: extractDetail(data, "No se pudo confirmar el inicio"),
        }));
      }
    } catch {
      setCrFeedback((prev) => ({
        ...prev,
        [crId]: "Error de conexión con el servidor",
      }));
    } finally {
      setStartingCrId(null);
    }
  }

  async function handleDeliverForChangeRequest(
    event: React.FormEvent,
    cr: ChangeRequest
  ) {
    event.preventDefault();
    if (!crDeliverFile) {
      setCrFeedback((prev) => ({
        ...prev,
        [cr.id]: "Adjunta el archivo del entregable actualizado.",
      }));
      return;
    }
    setCrDeliverBusy(true);
    setCrFeedback((prev) => ({ ...prev, [cr.id]: "" }));
    try {
      const form = new FormData();
      form.append("file", crDeliverFile);
      if (crDeliverTitle.trim()) {
        form.append("title", crDeliverTitle.trim());
      }
      if (crDeliverNote.trim()) {
        form.append("resolution_note", crDeliverNote.trim());
      }
      if (crTargetAssetId) {
        form.append("target_asset_id", crTargetAssetId);
      }
      if (canManageVisibility) {
        form.append("visibility", crDeliverVisibility);
      }

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/change-requests/${cr.id}/deliver`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        setActiveDeliveryCrId(null);
        setCrDeliverFile(null);
        setCrDeliverTitle("");
        setCrDeliverNote("");
        setCrTargetAssetId("");
        setCrFeedback((prev) => ({
          ...prev,
          [cr.id]:
            "Entregable actualizado adjuntado y sincronizado en Librería de Assets.",
        }));
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setCrFeedback((prev) => ({
          ...prev,
          [cr.id]: extractDetail(
            data,
            "Error al adjuntar el entregable actualizado"
          ),
        }));
      }
    } catch {
      setCrFeedback((prev) => ({
        ...prev,
        [cr.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setCrDeliverBusy(false);
    }
  }

  const completedSubtasks = stage.subtasks.filter(
    (s) => s.status === "done"
  ).length;
  const isApproved = stage.status === "approved";
  const isLocked = stage.status === "locked";

  return (
    <article
      className={`animate-panel-enter rounded-2xl border bg-background shadow-editorial ${
        isApproved ? "border-[#5F7161]/40" : "border-stone-900/15"
      }`}
    >
      {/* Focused Stage Header */}
      <div className="flex flex-col gap-5 border-b border-stone-900/10 px-6 py-6 md:flex-row md:items-start md:justify-between md:px-8 md:py-7">
        <div className="min-w-0 max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="type-tech text-stone-500">
              Etapa {String(number).padStart(2, "0")}
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

        {/* Clean Unboxed Tabular Metrics + Responsible Stage Action */}
        <div className="flex shrink-0 flex-col items-start gap-4 border-t border-stone-900/10 pt-4 md:items-end md:border-t-0 md:border-l md:pt-0 md:pl-6">
          <div className="flex items-center gap-6">
            <div>
              <p className="type-tech text-stone-500">Subtareas</p>
              <p className="type-title mt-1 text-xl tabular-nums text-stone-900">
                {completedSubtasks}/{stage.subtasks.length}
              </p>
            </div>
            <div className="h-8 w-px bg-stone-900/10" aria-hidden="true" />
            <div>
              <p className="type-tech text-stone-500">Cambios usados</p>
              <p className="type-title mt-1 text-xl tabular-nums text-stone-900">
                {stage.used_change_requests}/{stage.max_change_requests}
              </p>
            </div>
          </div>

          {canDeleteStage && (
            <button
              type="button"
              onClick={() => onRequestDelete(stage)}
              className="type-ui min-h-[38px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/15 bg-background px-3.5 py-1.5 text-xs text-stone-600 transition-colors hover:border-[#8C3B2B]/45 hover:bg-[#FBF3F1] hover:text-[#8C3B2B]"
            >
              Eliminar etapa
            </button>
          )}
        </div>
      </div>

      {/* Contextual Locked Notice */}
      {isLocked && (
        <div className="border-b border-stone-900/10 bg-surface/50 px-6 py-3.5 md:px-8">
          <p className="type-editorial text-sm italic text-stone-600">
            Etapa bloqueada para entregas: se habilita automáticamente cuando el
            cliente aprueba la etapa anterior. Mientras tanto, el equipo puede
            planificar subtareas.
          </p>
        </div>
      )}

      {/* Stage Workspace Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-900/10 px-6 md:px-8">
        <div
          role="tablist"
          aria-label="Secciones de la etapa"
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
            aria-selected={activeTab === "subtasks"}
            onClick={() => setActiveTab("subtasks")}
            className={`type-ui relative min-h-[48px] shrink-0 whitespace-nowrap py-3 text-sm transition-colors ${
              activeTab === "subtasks"
                ? "font-medium text-stone-900"
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            Subtareas{" "}
            <span className="type-tech ml-1 text-stone-400">
              {completedSubtasks}/{stage.subtasks.length}
            </span>
            {activeTab === "subtasks" && (
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
            Cambios{" "}
            <span
              className={`type-tech ml-1 ${
                openChangeCount > 0 ? "text-stone-900" : "text-stone-400"
              }`}
            >
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

        {/* Contextual Secondary Action per Tab */}
        <div className="flex items-center gap-3 py-2">
          {activeTab === "deliverables" && (
            <>
              <Link
                href={`/admin/projects/${projectId}/assets`}
                className="type-tech shrink-0 whitespace-nowrap text-stone-600 underline decoration-stone-900/25 underline-offset-4 transition-colors hover:text-stone-900"
              >
                Librería de Assets <span className="arrow-glide">↗</span>
              </Link>
              {!isLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadForm((prev) => !prev);
                    setUploadMessage("");
                  }}
                  className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800"
                >
                  {showUploadForm ? "Cerrar carga" : "+ Subir entregable"}
                </button>
              )}
            </>
          )}
          {activeTab === "subtasks" && (
            <span className="type-tech text-stone-400">
              Equipo interno · Lead y Collaborator
            </span>
          )}
          {activeTab === "changes" && (
            <span className="type-tech text-stone-500">
              {stage.available_change_requests} disponibles de{" "}
              {stage.max_change_requests}
            </span>
          )}
        </div>
      </div>

      {/* Tab Content Area */}
      <div key={activeTab} className="animate-panel-enter px-6 py-6 md:px-8 md:py-7">
        {/* TAB 1: DELIVERABLES */}
        {activeTab === "deliverables" && (
          <div className="space-y-6">
            {uploadMessage && (
              <p className="animate-slide-down type-ui rounded-xl border border-[#5F7161]/35 bg-[#EEF2EC]/75 px-4 py-3 text-sm text-[#44544A]">
                {uploadMessage}
              </p>
            )}

            {/* Collapsible Upload Form */}
            {showUploadForm && !isLocked && (
              <form
                onSubmit={uploadDeliverable}
                className="animate-panel-enter space-y-4 rounded-xl border border-stone-900/15 bg-surface/65 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="type-tech text-stone-700">
                    Nuevo entregable · Se sincroniza con Librería de Assets
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowUploadForm(false)}
                    className="type-tech text-stone-500 hover:text-stone-900"
                  >
                    Cancelar
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="type-ui text-xs text-stone-600">
                      Título del entregable
                    </span>
                    <input
                      type="text"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={255}
                      placeholder="Ej. Propuesta conceptual v1"
                      className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="type-ui text-xs text-stone-600">
                      Nota de versión (opcional)
                    </span>
                    <input
                      type="text"
                      value={changelog}
                      onChange={(event) => setChangelog(event.target.value)}
                      maxLength={500}
                      placeholder="Resumen breve del archivo…"
                      className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-stone-900/25 bg-background px-4 transition-colors hover:border-stone-900/50">
                    <span className="type-ui truncate text-sm text-stone-700">
                      {file
                        ? `${file.name} (${formatBytes(file.size)})`
                        : "Seleccionar archivo (imagen, PDF, plano…)"}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_EXTENSIONS}
                      onChange={(event) =>
                        setFile(event.target.files?.[0] ?? null)
                      }
                      className="sr-only"
                    />
                  </label>

                  {canManageVisibility ? (
                    <select
                      value={uploadVisibility}
                      onChange={(e) =>
                        setUploadVisibility(e.target.value as AssetVisibility)
                      }
                      aria-label="Visibilidad del entregable"
                      className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                    >
                      <option value="internal_only">
                        Visibilidad: Solo equipo interno
                      </option>
                      <option value="client_visible">
                        Visibilidad: Publicar para cliente
                      </option>
                      <option value="custom">
                        Visibilidad: Personalizada por rol / usuario
                      </option>
                    </select>
                  ) : (
                    <div className="flex items-center rounded-lg border border-stone-900/10 bg-background/70 px-3.5 py-2">
                      <span className="type-tech text-stone-500">
                        Se sube como interno · El Lead define visibilidad
                      </span>
                    </div>
                  )}
                </div>

                {canManageVisibility && uploadVisibility === "custom" && (
                  <div className="space-y-2.5 border-t border-stone-900/10 pt-3">
                    <p className="type-tech text-stone-600">
                      Roles o usuarios con acceso
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {GRANULAR_ROLE_OPTIONS.map((opt) => {
                        const active = uploadVisibleRoles.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setUploadVisibleRoles((prev) =>
                                prev.includes(opt.value)
                                  ? prev.filter((r) => r !== opt.value)
                                  : [...prev, opt.value]
                              )
                            }
                            className={`type-ui min-h-[40px] rounded-lg border px-3 text-xs transition-colors ${
                              active
                                ? "border-stone-900 bg-stone-900 text-background"
                                : "border-stone-900/20 bg-background text-stone-700 hover:border-stone-900/45"
                            }`}
                          >
                            {active ? "✓ " : "+ "}
                            {opt.label}
                          </button>
                        );
                      })}
                      {members.map((m) => {
                        const active = uploadVisibleUserIds.includes(m.user_id);
                        return (
                          <button
                            key={m.user_id}
                            type="button"
                            onClick={() =>
                              setUploadVisibleUserIds((prev) =>
                                prev.includes(m.user_id)
                                  ? prev.filter((id) => id !== m.user_id)
                                  : [...prev, m.user_id]
                              )
                            }
                            className={`type-ui min-h-[40px] rounded-lg border px-3 text-xs transition-colors ${
                              active
                                ? "border-stone-900 bg-stone-900 text-background"
                                : "border-stone-900/20 bg-background text-stone-700 hover:border-stone-900/45"
                            }`}
                          >
                            {active ? "✓ " : "+ "}
                            {m.full_name || m.email}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                  >
                    {uploading ? "Subiendo…" : "Guardar y sincronizar ↗"}
                  </button>
                </div>
              </form>
            )}

            {/* Deliverables Hairline List */}
            {stage.deliverables.length === 0 ? (
              <div className="flex flex-col items-start justify-between gap-4 py-6 sm:flex-row sm:items-center">
                <div>
                  <p className="type-editorial text-base text-stone-700">
                    Aún no hay entregables cargados en esta etapa.
                  </p>
                  <p className="type-ui mt-1 text-xs text-stone-500">
                    Cualquier archivo que subas aquí aparecerá automáticamente
                    en la Librería de Assets sin duplicarse.
                  </p>
                </div>
                {!isLocked && !showUploadForm && (
                  <button
                    type="button"
                    onClick={() => setShowUploadForm(true)}
                    className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                  >
                    + Subir primer entregable
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-stone-900/10">
                {stage.deliverables.map((deliverable) => {
                  const viewerOpen = viewerDeliverableId === deliverable.id;
                  const isBusy =
                    publishingId === deliverable.id ||
                    handoverTogglingId === deliverable.id;
                  const msg = deliverableMessages[deliverable.id];
                  const confirmingUnpublish =
                    unpublishingConfirmId === deliverable.id;

                  return (
                    <div key={deliverable.id} className="py-5 first:pt-0 last:pb-0">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                            {deliverableStatusLabel(deliverable.status)} ·{" "}
                            <span
                              className={
                                deliverable.is_client_visible
                                  ? "text-[#44544A]"
                                  : "text-stone-500"
                              }
                            >
                              {VISIBILITY_LABELS[deliverable.visibility]}
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadFile(
                                deliverable.file_url,
                                deliverable.file_name,
                                deliverable.id
                              )
                            }
                            disabled={downloadingId === deliverable.id}
                            className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-3.5 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background disabled:opacity-50"
                          >
                            {downloadingId === deliverable.id
                              ? "Descargando…"
                              : "Descargar ↗"}
                          </button>

                          {deliverable.is_image && (
                            <button
                              type="button"
                              onClick={() =>
                                setViewerDeliverableId((prev) =>
                                  prev === deliverable.id
                                    ? null
                                    : deliverable.id
                                )
                              }
                              aria-expanded={viewerOpen}
                              className={`type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs transition-colors ${
                                viewerOpen
                                  ? "border-stone-900 bg-stone-900 text-background"
                                  : "border-stone-900/20 bg-background text-stone-800 hover:bg-stone-900 hover:text-background"
                              }`}
                            >
                              {viewerOpen ? "Ocultar pines" : "Pines"}
                            </button>
                          )}

                          {canManageVisibility && (
                            <>
                              {!deliverable.is_client_visible ? (
                                <button
                                  type="button"
                                  onClick={() => handlePublish(deliverable)}
                                  disabled={isBusy}
                                  className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-3.5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                                >
                                  {publishingId === deliverable.id
                                    ? "Publicando…"
                                    : "Publicar al cliente"}
                                </button>
                              ) : confirmingUnpublish ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUnpublish(deliverable.id)
                                  }
                                  disabled={isBusy}
                                  className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-3.5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                                >
                                  {publishingId === deliverable.id
                                    ? "Ocultando…"
                                    : "Confirmar interno"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setUnpublishingConfirmId(deliverable.id)
                                  }
                                  disabled={isBusy}
                                  className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/15 bg-background px-3.5 py-2 text-xs text-stone-600 transition-colors hover:border-stone-900/40 hover:text-stone-900 disabled:opacity-50"
                                >
                                  Pasar a interno
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleToggleHandover(deliverable)}
                                disabled={isBusy}
                                className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/15 bg-background px-3.5 py-2 text-xs text-stone-600 transition-colors hover:border-stone-900/40 hover:text-stone-900 disabled:opacity-50"
                              >
                                {handoverTogglingId === deliverable.id
                                  ? "Actualizando…"
                                  : deliverable.is_final_handover
                                    ? "Quitar entrega final"
                                    : "Entrega final"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {msg && (
                        <p className="type-ui mt-2 text-xs text-red-700">
                          {msg}
                        </p>
                      )}

                      {viewerOpen && deliverable.is_image && (
                        <div className="mt-5 border-t border-stone-900/10 pt-5">
                          <DeliverableViewer
                            projectId={projectId}
                            deliverableId={deliverable.id}
                            canReview={false}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SUBTASKS */}
        {activeTab === "subtasks" && (
          <div className="space-y-6">
            {stage.subtasks.length === 0 ? (
              <p className="type-editorial py-3 text-base italic text-stone-500">
                Sin subtareas registradas todavía. Agrega los pasos clave para
                coordinar al equipo en esta fase.
              </p>
            ) : (
              <div className="divide-y divide-stone-900/10">
                {stage.subtasks.map((sub) => {
                  const done = sub.status === "done";
                  const inProgress = sub.status === "in_progress";

                  return (
                    <div
                      key={sub.id}
                      className="flex flex-col gap-3 py-3.5 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSubtask(sub.id, {
                              status: nextSubtaskStatus(sub.status),
                            })
                          }
                          aria-label={`Cambiar estado de ${sub.title}`}
                          title={`Estado actual: ${SUBTASK_STATUS_LABELS[sub.status]}`}
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] transition-colors ${
                            done
                              ? "border-[#5F7161] bg-[#5F7161] text-background"
                              : inProgress
                                ? "border-stone-900 bg-surface text-stone-900"
                                : "border-stone-900/25 bg-background text-transparent hover:border-stone-900"
                          }`}
                        >
                          {done ? "✓" : inProgress ? "–" : "·"}
                        </button>

                        <div className="min-w-0">
                          <p
                            className={`type-editorial text-[16px] leading-snug ${
                              done
                                ? "text-stone-400 line-through"
                                : "text-stone-900"
                            }`}
                          >
                            {sub.title}
                          </p>
                          {sub.description && (
                            <p className="type-ui mt-0.5 text-xs text-stone-500">
                              {sub.description}
                            </p>
                          )}
                          <p className="type-tech mt-1 text-stone-400">
                            {SUBTASK_STATUS_LABELS[sub.status]}
                            {sub.assigned_to_name
                              ? ` · ${sub.assigned_to_name}`
                              : " · Sin asignar"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pl-9 sm:pl-0">
                        <select
                          aria-label={`Estado de subtarea ${sub.title}`}
                          value={sub.status}
                          onChange={(e) =>
                            handleUpdateSubtask(sub.id, {
                              status: e.target.value as SubtaskStatus,
                            })
                          }
                          className="type-ui min-h-[40px] rounded-lg border border-stone-900/15 bg-background px-3 text-xs text-stone-700 focus:border-stone-900/45"
                        >
                          <option value="pending">Pendiente</option>
                          <option value="in_progress">En curso</option>
                          <option value="done">Completada</option>
                        </select>

                        {teamMembers.length > 0 && (
                          <select
                            aria-label={`Responsable de subtarea ${sub.title}`}
                            value={sub.assigned_to ?? ""}
                            onChange={(e) =>
                              handleUpdateSubtask(sub.id, {
                                assigned_to: e.target.value || null,
                              })
                            }
                            className="type-ui min-h-[40px] rounded-lg border border-stone-900/15 bg-background px-3 text-xs text-stone-700 focus:border-stone-900/45"
                          >
                            <option value="">Sin asignar</option>
                            {teamMembers.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.full_name || m.email}
                              </option>
                            ))}
                          </select>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteSubtask(sub.id)}
                          aria-label={`Eliminar subtarea ${sub.title}`}
                          className="type-ui flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-900/15 text-xs text-stone-500 transition-colors hover:border-stone-900 hover:bg-stone-900 hover:text-background"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick Inline Subtask Creator */}
            <form
              onSubmit={handleAddSubtask}
              className="flex flex-col gap-2.5 border-t border-stone-900/10 pt-5 sm:flex-row"
            >
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                maxLength={255}
                placeholder="Añadir nueva subtarea…"
                className="type-ui min-h-[44px] flex-1 rounded-lg border border-stone-900/15 bg-surface/45 px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 focus:bg-background"
              />
              {teamMembers.length > 0 && (
                <select
                  value={newSubtaskAssignee}
                  onChange={(e) => setNewSubtaskAssignee(e.target.value)}
                  aria-label="Asignar nueva subtarea"
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-xs text-stone-700 focus:border-stone-900/45"
                >
                  <option value="">Responsable (opcional)</option>
                  {teamMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="submit"
                disabled={subtaskBusy}
                className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
              >
                {subtaskBusy ? "Agregando…" : "Agregar"}
              </button>
            </form>
            {subtaskMsg && (
              <p className="type-ui text-xs text-stone-700">{subtaskMsg}</p>
            )}
          </div>
        )}

        {/* TAB 3: SHARED CHANGE REQUESTS */}
        {activeTab === "changes" && (
          <div className="space-y-6">
            {stage.change_requests.length === 0 ? (
              <div className="py-5">
                <p className="type-editorial text-base italic text-stone-500">
                  El cliente aún no ha solicitado cambios en esta etapa.
                </p>
                <p className="type-tech mt-1.5 text-stone-400">
                  Límite configurado: {stage.max_change_requests} rondas de
                  ajustes.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-900/15">
                {stage.change_requests.map((cr) => {
                  const isDeliverOpen = activeDeliveryCrId === cr.id;

                  return (
                    <div
                      key={cr.id}
                      className="space-y-4 py-6 first:pt-0 last:pb-0"
                    >
                      {/* Round Header */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="type-title text-base text-stone-900">
                            Ronda #{cr.request_number}
                          </span>
                          <span aria-hidden="true" className="text-stone-300">
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
                              ? "Abierta (cliente puede agregar cambios)"
                              : cr.status === "in_progress"
                                ? "En progreso (cambios bloqueados)"
                                : "Resuelta"}
                          </span>
                        </div>
                        <span className="type-tech text-stone-500">
                          {cr.requested_by_name || "Cliente"} ·{" "}
                          {formatDate(cr.requested_at)}
                        </span>
                      </div>

                      {/* Ordered Items (clean hairline list, no card nesting) */}
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

                      {cr.work_started_at && (
                        <p className="type-tech text-stone-500">
                          Trabajo iniciado por{" "}
                          {cr.work_started_by_name || "equipo"} ·{" "}
                          {formatDate(cr.work_started_at)}
                        </p>
                      )}

                      {crFeedback[cr.id] && (
                        <p className="type-ui rounded-xl border border-[#5F7161]/35 bg-[#EEF2EC]/75 px-4 py-3 text-xs text-[#44544A]">
                          {crFeedback[cr.id]}
                        </p>
                      )}

                      {/* Team Workflow Actions */}
                      {cr.status !== "resolved" && (
                        <div className="flex flex-wrap items-center gap-2.5">
                          {cr.status === "open" && (
                            <button
                              type="button"
                              onClick={() => handleStartWork(cr.id)}
                              disabled={startingCrId === cr.id}
                              className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                            >
                              {startingCrId === cr.id
                                ? "Confirmando…"
                                : "Iniciar trabajo y bloquear ronda"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setActiveDeliveryCrId((prev) =>
                                prev === cr.id ? null : cr.id
                              )
                            }
                            className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                          >
                            {isDeliverOpen
                              ? "Cerrar entrega"
                              : "Adjuntar entregable actualizado ↗"}
                          </button>
                        </div>
                      )}

                      {/* Resolution Upload Form */}
                      {isDeliverOpen && cr.status !== "resolved" && (
                        <form
                          onSubmit={(e) => handleDeliverForChangeRequest(e, cr)}
                          className="space-y-4 rounded-xl border border-stone-900/15 bg-surface/65 p-5"
                        >
                          <p className="type-tech text-stone-700">
                            Adjuntar entregable actualizado · Sincroniza con
                            Librería de Assets
                          </p>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1.5">
                              <span className="type-ui text-xs text-stone-600">
                                Título del entregable actualizado
                              </span>
                              <input
                                type="text"
                                value={crDeliverTitle}
                                onChange={(e) =>
                                  setCrDeliverTitle(e.target.value)
                                }
                                placeholder={`${stage.name} — Ajuste #${cr.request_number}`}
                                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                              />
                            </label>

                            {stage.deliverables.length > 0 && (
                              <label className="flex flex-col gap-1.5">
                                <span className="type-ui text-xs text-stone-600">
                                  Versionar asset existente (opcional)
                                </span>
                                <select
                                  value={crTargetAssetId}
                                  onChange={(e) =>
                                    setCrTargetAssetId(e.target.value)
                                  }
                                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                                >
                                  <option value="">
                                    Crear nuevo asset en librería
                                  </option>
                                  {stage.deliverables.map((d) => (
                                    <option key={d.id} value={d.asset_id}>
                                      Nueva versión de: {d.title} (v{d.version})
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>

                          <label className="flex flex-col gap-1.5">
                            <span className="type-ui text-xs text-stone-600">
                              Nota de resolución visible para el cliente
                            </span>
                            <textarea
                              value={crDeliverNote}
                              onChange={(e) => setCrDeliverNote(e.target.value)}
                              rows={2}
                              placeholder="Detalla los ajustes incorporados en esta versión…"
                              className="type-ui w-full rounded-lg border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                            />
                          </label>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-stone-900/25 bg-background px-4 transition-colors hover:border-stone-900/50">
                              <span className="type-ui truncate text-sm text-stone-700">
                                {crDeliverFile
                                  ? `${crDeliverFile.name} (${formatBytes(crDeliverFile.size)})`
                                  : "Elegir archivo actualizado"}
                              </span>
                              <input
                                type="file"
                                accept={ACCEPTED_EXTENSIONS}
                                onChange={(e) =>
                                  setCrDeliverFile(e.target.files?.[0] ?? null)
                                }
                                className="sr-only"
                              />
                            </label>

                            {canManageVisibility ? (
                              <select
                                value={crDeliverVisibility}
                                onChange={(e) =>
                                  setCrDeliverVisibility(
                                    e.target.value as AssetVisibility
                                  )
                                }
                                aria-label="Visibilidad del entregable actualizado"
                                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                              >
                                <option value="client_visible">
                                  Visible para cliente (recomendado)
                                </option>
                                <option value="internal_only">
                                  Solo equipo interno
                                </option>
                              </select>
                            ) : (
                              <div className="flex items-center rounded-lg border border-stone-900/10 bg-background/70 px-3.5 py-2">
                                <span className="type-tech text-stone-500">
                                  Se guarda interno hasta publicación del Lead
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex justify-end">
                            <button
                              type="submit"
                              disabled={crDeliverBusy}
                              className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                            >
                              {crDeliverBusy
                                ? "Publicando entrega…"
                                : "Resolver ronda y vincular entregable ↗"}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Resolved Delivery Summary */}
                      {cr.status === "resolved" && (
                        <div className="space-y-3 rounded-xl border border-[#5F7161]/30 bg-[#EEF2EC]/60 p-4">
                          <p className="type-tech text-[#44544A]">
                            Resuelto por {cr.resolved_by_name || "Equipo"} ·{" "}
                            {formatDate(cr.resolved_at)}
                          </p>
                          {cr.resolution_note && (
                            <p className="type-editorial text-[15px] leading-relaxed text-stone-800">
                              {cr.resolution_note}
                            </p>
                          )}
                          {cr.updated_deliverable && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#5F7161]/20 pt-3">
                              <div>
                                <p className="type-editorial text-base text-stone-900">
                                  {cr.updated_deliverable.title} (v
                                  {cr.updated_deliverable.version})
                                </p>
                                <p className="type-tech mt-0.5 text-stone-500">
                                  {cr.updated_deliverable.file_name} ·{" "}
                                  {
                                    VISIBILITY_LABELS[
                                      cr.updated_deliverable.visibility
                                    ]
                                  }
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    cr.updated_deliverable &&
                                    handleDownloadFile(
                                      cr.updated_deliverable.file_url,
                                      cr.updated_deliverable.file_name,
                                      `cr-${cr.id}`
                                    )
                                  }
                                  className="type-ui min-h-[40px] rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800"
                                >
                                  Descargar ↗
                                </button>
                                <Link
                                  href={`/admin/projects/${projectId}/assets`}
                                  className="type-ui inline-flex min-h-[40px] items-center rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                                >
                                  Ver en Assets ↗
                                </Link>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function AdminEtapasPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Selected stage for clean focused view
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  // Modals / Drawers
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMeetingPanel, setShowMeetingPanel] = useState(false);

  // Create stage form
  const [stageName, setStageName] = useState("");
  const [stageDescription, setStageDescription] = useState("");
  const [stageMaxChanges, setStageMaxChanges] = useState("2");
  const [stageOrder, setStageOrder] = useState("0");
  const [stageInitialSubtasks, setStageInitialSubtasks] = useState("");
  const [creatingStage, setCreatingStage] = useState(false);
  const [stageMessage, setStageMessage] = useState("");

  // Delete stage modal (1-step when locked without progress, 2-step double confirmation when active or has progress)
  const [deleteTargetStage, setDeleteTargetStage] = useState<Stage | null>(
    null
  );
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deletingStage, setDeletingStage] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const canCreateStages =
    me?.role === "LEAD_DESIGNER" || me?.role === "SUPER_ADMIN";

  const canDeleteStages = useMemo(() => {
    if (!me) return false;
    if (me.role === "SUPER_ADMIN") return true;
    if (me.role !== "LEAD_DESIGNER") return false;
    if (project?.lead_designer_id && project.lead_designer_id === me.id) {
      return true;
    }
    return members.some(
      (m) => m.user_id === me.id && m.assigned_role === "LEAD_DESIGNER"
    );
  }, [me, project?.lead_designer_id, members]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, projectRes, stagesRes, membersRes] = await Promise.all([
        apiFetch("/api/v1/auth/me"),
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/stages`),
        apiFetch(`/api/v1/projects/${projectId}/members-summary`),
      ]);

      if (meRes.ok) {
        setMe(await meRes.json());
      }
      if (membersRes.ok) {
        const mData: unknown = await membersRes.json();
        if (Array.isArray(mData)) setMembers(mData as MemberSummary[]);
      }

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
        setStageOrder(String(ordered.length));
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

  async function createStage(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = stageName.trim();
    if (!trimmedName) {
      setStageMessage("El nombre / objetivo de la etapa es obligatorio.");
      return;
    }
    if (stageMaxChanges.trim() === "") {
      setStageMessage(
        "El límite máximo de solicitudes de cambios es obligatorio."
      );
      return;
    }
    const parsedMaxChanges = Number(stageMaxChanges);
    if (!Number.isInteger(parsedMaxChanges) || parsedMaxChanges < 0) {
      setStageMessage(
        "El límite máximo de solicitudes de cambios debe ser un entero mayor o igual a 0."
      );
      return;
    }
    const parsedOrder = Number.parseInt(stageOrder, 10);
    if (Number.isNaN(parsedOrder) || parsedOrder < 0) {
      setStageMessage("El orden debe ser un entero mayor o igual a 0.");
      return;
    }

    const subtasks = stageInitialSubtasks
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setCreatingStage(true);
    setStageMessage("");
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/stages`, {
        method: "POST",
        body: JSON.stringify({
          name: trimmedName,
          description: stageDescription.trim() || null,
          max_change_requests: parsedMaxChanges,
          order_index: parsedOrder,
          subtasks,
        }),
      });
      if (res.ok) {
        const created = (await res.json().catch(() => null)) as Stage | null;
        setStageName("");
        setStageDescription("");
        setStageMaxChanges("2");
        setStageInitialSubtasks("");
        setShowCreateModal(false);
        setMessage("Etapa creada correctamente.");
        if (created?.id) {
          setSelectedStageId(created.id);
        }
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageMessage(extractDetail(data, "Error al crear la etapa"));
      }
    } catch {
      setStageMessage("Error de conexión con el servidor");
    } finally {
      setCreatingStage(false);
    }
  }

  function openDeleteModal(stage: Stage) {
    setDeleteTargetStage(stage);
    setDeleteStep(1);
    setDeleteConfirmName("");
    setDeleteConfirmChecked(false);
    setDeleteError("");
  }

  function closeDeleteModal() {
    if (deletingStage) return;
    setDeleteTargetStage(null);
    setDeleteStep(1);
    setDeleteConfirmName("");
    setDeleteConfirmChecked(false);
    setDeleteError("");
  }

  async function confirmDeleteStage() {
    if (!deleteTargetStage) return;
    const assessment = getStageDeletionAssessment(deleteTargetStage);
    if (assessment.requiresDoubleConfirmation) {
      if (deleteStep === 1) {
        setDeleteStep(2);
        setDeleteError("");
        return;
      }
      if (
        deleteConfirmName.trim().toLowerCase() !==
        deleteTargetStage.name.trim().toLowerCase()
      ) {
        setDeleteError(
          "El nombre escrito no coincide exactamente con el de la etapa."
        );
        return;
      }
      if (!deleteConfirmChecked) {
        setDeleteError(
          "Marca la casilla de confirmación para eliminar esta etapa definitivamente."
        );
        return;
      }
    }

    setDeletingStage(true);
    setDeleteError("");
    try {
      const payload = assessment.requiresDoubleConfirmation
        ? {
            confirm_double: true,
            confirm_stage_name: deleteConfirmName.trim(),
          }
        : {};
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${deleteTargetStage.id}`,
        {
          method: "DELETE",
          body: JSON.stringify(payload),
        }
      );
      if (res.ok) {
        const result = (await res.json().catch(() => null)) as {
          deleted_stage_name?: string;
          promoted_stage_id?: string | null;
          promoted_stage_name?: string | null;
        } | null;
        const removedName =
          result?.deleted_stage_name || deleteTargetStage.name;
        setDeleteTargetStage(null);
        setDeleteStep(1);
        setDeleteConfirmName("");
        setDeleteConfirmChecked(false);
        if (result?.promoted_stage_id) {
          setSelectedStageId(result.promoted_stage_id);
          setMessage(
            `Etapa "${removedName}" eliminada. Se habilitó automáticamente "${result.promoted_stage_name ?? "la siguiente etapa"}".`
          );
        } else {
          setSelectedStageId(null);
          setMessage(`Etapa "${removedName}" eliminada correctamente.`);
        }
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeleteError(extractDetail(data, "No se pudo eliminar la etapa"));
      }
    } catch {
      setDeleteError("Error de conexión con el servidor");
    } finally {
      setDeletingStage(false);
    }
  }

  const sortedStagesForMeetings = useMemo(
    () =>
      stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        order_index: stage.order_index,
      })),
    [stages]
  );

  const selectedIndex = stages.findIndex((s) => s.id === selectedStageId);
  const selectedStage = selectedIndex >= 0 ? stages[selectedIndex] : stages[0];
  const approvedCount = stages.filter((s) => s.status === "approved").length;
  const progressPct =
    stages.length > 0 ? Math.round((approvedCount / stages.length) * 100) : 0;

  return (
    <section className="brief-editorial space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-5 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-tech text-stone-500">
            02 · Cronograma, entregables y revisiones
          </p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
            Etapas del proyecto
          </h1>
          {project && (
            <p className="type-editorial mt-1.5 text-sm italic text-stone-600">
              {project.title} · {project.status}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowMeetingPanel((prev) => !prev)}
            className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
          >
            {showMeetingPanel ? "Ocultar agenda" : "Agendar reunión"}
          </button>

          {canCreateStages && (
            <button
              type="button"
              onClick={() => {
                setStageMessage("");
                setShowCreateModal(true);
              }}
              className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
            >
              + Nueva etapa
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="animate-slide-down flex items-center justify-between gap-4 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3">
          <p className="type-ui text-sm text-stone-800">{message}</p>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Cerrar mensaje"
            className="type-tech text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Optional Collapsible Meeting Scheduler */}
      {showMeetingPanel && (
        <div className="animate-panel-enter">
          <MeetingScheduler
            projectId={projectId}
            stages={sortedStagesForMeetings}
          />
        </div>
      )}

      {/* Main Content */}
      {loading && stages.length === 0 && !message ? (
        <p className="type-ui text-sm text-stone-600">Cargando etapas…</p>
      ) : stages.length === 0 && !message ? (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-stone-900/10 bg-surface/65 p-8 sm:flex-row sm:items-center">
          <div>
            <p className="type-title text-lg text-stone-900">
              Sin fases configuradas
            </p>
            <p className="type-editorial mt-1 text-sm text-stone-600">
              Crea la primera etapa para definir objetivos, subtareas del equipo
              y rondas de cambios con el cliente.
            </p>
          </div>
          {canCreateStages && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
            >
              + Crear primera etapa
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress Overview & Phase Stepper Rail */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="type-tech text-stone-500">
                Mapa de fases · {approvedCount} de {stages.length} aprobadas
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

            {/* Interactive Phase Selector Cards */}
            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
              {stages.map((stage, idx) => {
                const isSelected = selectedStage?.id === stage.id;
                const isApproved = stage.status === "approved";
                const isLocked = stage.status === "locked";
                const doneSubtasks = stage.subtasks.filter(
                  (s) => s.status === "done"
                ).length;
                const activeChanges = stage.change_requests.filter(
                  (cr) => cr.status === "open" || cr.status === "in_progress"
                ).length;

                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setSelectedStageId(stage.id)}
                    aria-pressed={isSelected}
                    className={`interactive-card group flex min-h-[104px] flex-col justify-between rounded-xl border p-4 text-left ${
                      isSelected
                        ? "border-stone-900 bg-background shadow-editorial"
                        : isApproved
                          ? "border-[#5F7161]/30 bg-[#EEF2EC]/35 hover:border-[#5F7161]/60"
                          : isLocked
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
                          isApproved
                            ? "text-[#44544A]"
                            : isLocked
                              ? "text-stone-400"
                              : "text-stone-900"
                        }`}
                      >
                        {STAGE_STATUS_LABELS[stage.status]}
                      </span>
                    </div>

                    <p className="type-editorial mt-2 line-clamp-2 text-[15px] font-medium leading-snug text-stone-900">
                      {stage.name}
                    </p>

                    <p className="type-tech mt-3 text-[10px] text-stone-500">
                      {stage.deliverables.length} arch. · {doneSubtasks}/
                      {stage.subtasks.length} tareas
                      {activeChanges > 0
                        ? ` · ${activeChanges} ajuste${activeChanges > 1 ? "s" : ""}`
                        : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Focused Active Stage Workspace */}
          {selectedStage && (
            <StageWorkspace
              key={selectedStage.id}
              projectId={projectId}
              number={selectedIndex >= 0 ? selectedIndex + 1 : 1}
              stage={selectedStage}
              me={me}
              members={members}
              canDeleteStage={canDeleteStages}
              onRequestDelete={openDeleteModal}
              onChanged={load}
            />
          )}
        </div>
      )}

      {/* Create Stage Modal */}
      {showCreateModal && canCreateStages && (
        <div
          className="brief-editorial animate-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-stage-title"
        >
          <div className="animate-modal-enter max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-stone-900/10 pb-4">
              <div>
                <p className="type-tech text-stone-500">Configuración de fase</p>
                <h2
                  id="create-stage-title"
                  className="type-title mt-1 text-xl text-stone-900"
                >
                  Nueva etapa del proyecto
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Cerrar ventana"
                className="type-ui flex h-10 w-10 items-center justify-center rounded-full border border-stone-900/15 text-stone-600 transition-colors hover:bg-stone-900 hover:text-background"
              >
                ✕
              </button>
            </div>

            <form onSubmit={createStage} className="space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">
                  Nombre / Objetivo principal *
                </span>
                <input
                  type="text"
                  required
                  value={stageName}
                  onChange={(event) => setStageName(event.target.value)}
                  maxLength={255}
                  placeholder="Ej. Exploración de marca"
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Límite de solicitudes de cambios *
                  </span>
                  <input
                    type="number"
                    required
                    step={1}
                    min={0}
                    max={99}
                    value={stageMaxChanges}
                    onChange={(event) => setStageMaxChanges(event.target.value)}
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">Orden</span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    value={stageOrder}
                    onChange={(event) => setStageOrder(event.target.value)}
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">
                  Descripción del objetivo o entregable
                </span>
                <textarea
                  value={stageDescription}
                  onChange={(event) => setStageDescription(event.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Ej. Aterrizaje del brief, narrativa visual y propuesta de copy."
                  className="type-ui w-full rounded-lg border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">
                  Subtareas iniciales del equipo (una por línea, opcional)
                </span>
                <textarea
                  value={stageInitialSubtasks}
                  onChange={(event) =>
                    setStageInitialSubtasks(event.target.value)
                  }
                  rows={3}
                  placeholder={
                    "Aterrizar brief y hallazgos\nEntregar copy de marca\nPreparar presentación de territorios"
                  }
                  className="type-ui w-full rounded-lg border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              {stageMessage && (
                <p className="type-ui rounded-lg border border-stone-900/15 bg-surface/75 px-3.5 py-2.5 text-xs text-stone-800">
                  {stageMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 border-t border-stone-900/10 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingStage}
                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                >
                  {creatingStage ? "Creando…" : "Crear etapa ↗"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Stage Modal (Single or Double Confirmation) */}
      {deleteTargetStage &&
        canDeleteStages &&
        (() => {
          const assessment = getStageDeletionAssessment(deleteTargetStage);
          const requiresDouble = assessment.requiresDoubleConfirmation;
          const nextLockedStage =
            deleteTargetStage.status === "active"
              ? stages.find(
                  (s) =>
                    s.id !== deleteTargetStage.id && s.status === "locked"
                )
              : null;
          const exactNameMatches =
            deleteConfirmName.trim().toLowerCase() ===
            deleteTargetStage.name.trim().toLowerCase();

          return (
            <div
              className="brief-editorial animate-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-stage-title"
            >
              <div className="animate-modal-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial md:p-7">
                <div className="mb-5 flex items-start justify-between gap-4 border-b border-stone-900/10 pb-4">
                  <div>
                    <p
                      className={`type-tech ${
                        requiresDouble ? "text-[#8C3B2B]" : "text-stone-500"
                      }`}
                    >
                      {requiresDouble
                        ? `Paso ${deleteStep} de 2 · ${
                            deleteStep === 1
                              ? "Etapa en curso o con avances"
                              : "Doble confirmación obligatoria"
                          }`
                        : "Confirmar eliminación"}
                    </p>
                    <h2
                      id="delete-stage-title"
                      className="type-title mt-1 text-xl text-stone-900"
                    >
                      Eliminar etapa
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={deletingStage}
                    aria-label="Cerrar ventana"
                    className="type-ui flex h-10 w-10 items-center justify-center rounded-full border border-stone-900/15 text-stone-600 transition-colors hover:bg-stone-900 hover:text-background disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>

                {/* Stage Summary */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-stone-900/10 bg-surface/65 p-4">
                    <p className="type-tech text-stone-500">
                      Etapa seleccionada ·{" "}
                      {STAGE_STATUS_LABELS[deleteTargetStage.status]}
                    </p>
                    <p className="type-editorial mt-1 text-lg font-medium text-stone-900">
                      {deleteTargetStage.name}
                    </p>
                  </div>

                  {!requiresDouble ? (
                    <p className="type-editorial text-[15px] leading-relaxed text-stone-600">
                      Esta etapa está bloqueada y aún no tiene entregables,
                      cambios ni subtareas en curso. Al eliminarla se removerá
                      del cronograma del proyecto.
                    </p>
                  ) : deleteStep === 1 ? (
                    <div className="space-y-4">
                      <p className="type-editorial text-[15px] leading-relaxed text-stone-700">
                        Esta etapa{" "}
                        <strong className="font-medium text-stone-900">
                          está en curso o ya cuenta con avances registrados
                        </strong>
                        . Revisa el impacto antes de continuar al paso de doble
                        confirmación:
                      </p>

                      <dl className="divide-y divide-stone-900/10 rounded-xl border border-stone-900/15 bg-background px-4">
                        <div className="flex items-center justify-between gap-4 py-2.5">
                          <dt className="type-tech text-stone-500">
                            Estado actual
                          </dt>
                          <dd className="type-ui text-xs font-medium text-stone-900">
                            {STAGE_STATUS_LABELS[deleteTargetStage.status]}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 py-2.5">
                          <dt className="type-tech text-stone-500">
                            Entregables vinculados
                          </dt>
                          <dd className="type-ui text-xs tabular-nums text-stone-900">
                            {assessment.deliverablesCount}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 py-2.5">
                          <dt className="type-tech text-stone-500">
                            Subtareas con avance
                          </dt>
                          <dd className="type-ui text-xs tabular-nums text-stone-900">
                            {assessment.subtasksWithProgress} de{" "}
                            {deleteTargetStage.subtasks.length}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 py-2.5">
                          <dt className="type-tech text-stone-500">
                            Solicitudes de cambios
                          </dt>
                          <dd className="type-ui text-xs tabular-nums text-stone-900">
                            {assessment.changeRequestsCount}
                          </dd>
                        </div>
                      </dl>

                      <p className="type-ui text-xs leading-relaxed text-stone-500">
                        Las subtareas, rondas de cambios y vínculos de revisión
                        de esta etapa se eliminarán permanentemente. Los
                        archivos ya sincronizados permanecerán disponibles en la
                        Librería de Assets sin referencia a la etapa.
                      </p>

                      {nextLockedStage && (
                        <p className="type-ui rounded-xl border border-[#5F7161]/30 bg-[#EEF2EC]/60 px-3.5 py-2.5 text-xs text-[#44544A]">
                          Al eliminar esta etapa en curso, la siguiente fase (
                          <strong>{nextLockedStage.name}</strong>) pasará
                          automáticamente a estado <strong>En curso</strong>.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="type-editorial text-[15px] leading-relaxed text-stone-700">
                        Esta acción es irreversible. Para confirmar la
                        eliminación definitiva, escribe el nombre exacto de la
                        etapa y marca la casilla de verificación:
                      </p>

                      <label className="flex flex-col gap-1.5">
                        <span className="type-ui text-xs text-stone-600">
                          Escribe{" "}
                          <strong className="font-medium text-stone-900">
                            {deleteTargetStage.name}
                          </strong>{" "}
                          para confirmar *
                        </span>
                        <input
                          type="text"
                          value={deleteConfirmName}
                          onChange={(e) => {
                            setDeleteConfirmName(e.target.value);
                            setDeleteError("");
                          }}
                          placeholder={deleteTargetStage.name}
                          autoFocus
                          className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#8C3B2B]"
                        />
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-900/15 bg-surface/55 p-3.5">
                        <input
                          type="checkbox"
                          checked={deleteConfirmChecked}
                          onChange={(e) => {
                            setDeleteConfirmChecked(e.target.checked);
                            setDeleteError("");
                          }}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#8C3B2B]"
                        />
                        <span className="type-ui text-xs leading-relaxed text-stone-700">
                          Confirmo que esta etapa está en curso o tiene avances
                          y autorizo su eliminación permanente como responsable
                          del proyecto.
                        </span>
                      </label>
                    </div>
                  )}

                  {deleteError && (
                    <p className="type-ui rounded-lg border border-[#8C3B2B]/30 bg-[#FBF3F1] px-3.5 py-2.5 text-xs text-[#8C3B2B]">
                      {deleteError}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-stone-900/10 pt-4">
                    {requiresDouble && deleteStep === 2 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteStep(1);
                          setDeleteError("");
                        }}
                        disabled={deletingStage}
                        className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background disabled:opacity-50"
                      >
                        ← Volver
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={closeDeleteModal}
                        disabled={deletingStage}
                        className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}

                    {requiresDouble && deleteStep === 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteStep(2);
                          setDeleteError("");
                        }}
                        className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
                      >
                        Continuar a doble confirmación →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={confirmDeleteStage}
                        disabled={
                          deletingStage ||
                          (requiresDouble &&
                            (!exactNameMatches || !deleteConfirmChecked))
                        }
                        className="type-ui min-h-[44px] rounded-lg bg-[#8C3B2B] px-5 py-2 text-xs text-background transition-colors hover:bg-[#732F22] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {deletingStage
                          ? "Eliminando…"
                          : requiresDouble
                            ? "Eliminar definitivamente"
                            : "Eliminar etapa"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </section>
  );
}
