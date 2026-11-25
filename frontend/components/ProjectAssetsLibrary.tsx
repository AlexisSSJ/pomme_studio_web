"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchBlobUrl, extractDetail } from "@/lib/api";
import { useProtectedMediaUrl } from "@/lib/useProtectedMediaUrl";

export type AssetCategory =
  | "deliverables"
  | "plans"
  | "presentations"
  | "contracts"
  | "references"
  | "typography_palette"
  | "client_resources";

export type AssetVisibility = "internal_only" | "client_visible" | "custom";
export type UserRole = "SUPER_ADMIN" | "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT";

export interface AssetVersionItem {
  id: string;
  asset_id: string;
  version_number: number;
  file_name: string;
  file_extension: string;
  content_type: string;
  size_bytes: number;
  changelog: string | null;
  is_current: boolean;
  is_image: boolean;
  file_url: string;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface ProjectAssetSummary {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  category: AssetCategory;
  visibility: AssetVisibility;
  visible_roles: UserRole[];
  visible_user_ids: string[];
  source_stage_id: string | null;
  source_stage_name: string | null;
  source_deliverable_id: string | null;
  source_change_request_id: string | null;
  current_version_number: number;
  version_count: number;
  uploaded_by: string;
  uploaded_by_name: string | null;
  current_version: AssetVersionItem | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssetDetail extends ProjectAssetSummary {
  versions: AssetVersionItem[];
}

interface MemberSummary {
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  assigned_role: string;
}

interface MeUser {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

interface ProjectAssetsLibraryProps {
  projectId: string;
  mode: "admin" | "portal";
}

const ACCEPTED_EXTENSIONS =
  ".jpg,.jpeg,.png,.webp,.svg,.gif,.pdf,.ai,.fig,.zip,.psd,.sketch,.indd,.dwg,.dxf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";

const CATEGORY_OPTIONS: Array<{ value: AssetCategory; label: string }> = [
  { value: "deliverables", label: "Entregables" },
  { value: "plans", label: "Planos" },
  { value: "presentations", label: "Presentaciones" },
  { value: "contracts", label: "Contratos" },
  { value: "references", label: "Referencias" },
  { value: "typography_palette", label: "Tipografía / Paleta" },
  { value: "client_resources", label: "Recursos Cliente" },
];

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  deliverables: "Entregables",
  plans: "Planos",
  presentations: "Presentaciones",
  contracts: "Contratos",
  references: "Referencias",
  typography_palette: "Tipografía / Paleta",
  client_resources: "Recursos Cliente",
};

const VISIBILITY_LABELS: Record<AssetVisibility, string> = {
  client_visible: "Visible cliente",
  internal_only: "Solo interno",
  custom: "Personalizada",
};

const GRANULAR_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "LEAD_DESIGNER", label: "Lead Designer" },
  { value: "COLLABORATOR", label: "Collaborator" },
  { value: "CLIENT", label: "Cliente" },
];

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function describeVisibility(
  asset: Pick<
    ProjectAssetSummary,
    "visibility" | "visible_roles" | "visible_user_ids"
  >,
  members: MemberSummary[]
): string {
  if (asset.visibility === "client_visible") return "Visible para equipo y cliente";
  if (asset.visibility === "internal_only") return "Solo equipo interno del estudio";
  const parts: string[] = [];
  if (asset.visible_roles.length > 0) {
    parts.push(`Roles: ${asset.visible_roles.join(", ")}`);
  }
  if (asset.visible_user_ids.length > 0) {
    const names = asset.visible_user_ids.map((uid) => {
      const m = members.find((item) => item.user_id === uid);
      return m ? m.full_name || m.email : uid.slice(0, 8);
    });
    parts.push(`Usuarios: ${names.join(", ")}`);
  }
  return parts.length > 0 ? `Personalizada (${parts.join(" · ")})` : "Personalizada";
}

function DocumentIcon({ extension }: { extension: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-4">
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        aria-hidden="true"
        className="text-stone-700"
      >
        <path d="M8 4h13l7 7v21H8V4z" />
        <path d="M21 4v7h7" />
        <path d="M12 18h12M12 23h8" />
      </svg>
      <span className="type-tech rounded-lg border border-stone-900/15 bg-background px-2.5 py-1 text-stone-700">
        {(extension || "FILE").toUpperCase()}
      </span>
    </div>
  );
}

function AssetCardThumbnail({
  version,
  title,
}: {
  version: AssetVersionItem | null;
  title: string;
}) {
  const blobUrl = useProtectedMediaUrl(
    version && version.is_image ? version.file_url : null
  );

  if (!version) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface/75">
        <span className="type-tech text-stone-500">Sin archivo</span>
      </div>
    );
  }

  if (!version.is_image) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center bg-surface/75">
        <DocumentIcon extension={version.file_extension} />
        <span className="type-tech mt-1 text-stone-500">
          {formatBytes(version.size_bytes)}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface/75">
      {blobUrl ? (
        <img
          src={blobUrl}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <span className="type-tech text-stone-500">Cargando vista…</span>
      )}
    </div>
  );
}

function DrawerVersionPreview({
  version,
  title,
  onZoom,
}: {
  version: AssetVersionItem;
  title: string;
  onZoom: (src: string, alt: string) => void;
}) {
  const blobUrl = useProtectedMediaUrl(
    version.is_image ? version.file_url : null
  );

  if (!version.is_image) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-stone-900/15 bg-surface/65 p-6 text-center">
        <DocumentIcon extension={version.file_extension} />
        <p className="type-editorial mt-3 max-w-full truncate text-base text-stone-900">
          {version.file_name}
        </p>
        <p className="type-tech mt-1 text-stone-500">
          {version.content_type} · {formatBytes(version.size_bytes)}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-900/15 bg-surface/65 shadow-editorial">
      <button
        type="button"
        onClick={() =>
          blobUrl && onZoom(blobUrl, `${title} (v${version.version_number})`)
        }
        disabled={!blobUrl}
        aria-label="Ampliar vista previa del asset"
        className="flex min-h-[220px] w-full cursor-zoom-in items-center justify-center p-3"
      >
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={`${title} v${version.version_number}`}
            className="max-h-[300px] w-full rounded-xl object-contain"
          />
        ) : (
          <span className="type-tech text-stone-500">
            Cargando vista previa…
          </span>
        )}
      </button>
      <div className="flex min-h-[44px] items-center justify-between border-t border-stone-900/10 bg-background px-4">
        <span className="type-tech truncate text-stone-600">
          {version.file_name} · {formatBytes(version.size_bytes)}
        </span>
        <button
          type="button"
          onClick={() =>
            blobUrl && onZoom(blobUrl, `${title} (v${version.version_number})`)
          }
          disabled={!blobUrl}
          className="type-tech min-h-[44px] shrink-0 pl-3 text-stone-800 underline-offset-4 hover:underline disabled:opacity-40"
        >
          Ampliar ↗
        </button>
      </div>
    </div>
  );
}

function GranularVisibilityPicker({
  visibleRoles,
  visibleUserIds,
  members,
  onToggleRole,
  onToggleUser,
}: {
  visibleRoles: UserRole[];
  visibleUserIds: string[];
  members: MemberSummary[];
  onToggleRole: (role: UserRole) => void;
  onToggleUser: (userId: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-stone-900/15 bg-background p-4">
      <p className="type-tech text-stone-600">
        Permisos granulares (Super Admin y Lead siempre tienen acceso)
      </p>
      <div className="space-y-1.5">
        <p className="type-tech text-stone-500">Por rol</p>
        <div className="flex flex-wrap gap-2">
          {GRANULAR_ROLE_OPTIONS.map((opt) => {
            const active = visibleRoles.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleRole(opt.value)}
                className={`type-ui min-h-[44px] rounded-lg border px-3.5 text-xs transition-colors duration-300 ${
                  active
                    ? "border-stone-900 bg-stone-900 text-background"
                    : "border-stone-900/20 bg-surface/60 text-stone-800 hover:border-stone-900/45"
                }`}
              >
                {active ? "✓ " : "+ "}
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {members.length > 0 && (
        <div className="space-y-1.5">
          <p className="type-tech text-stone-500">Por usuario del proyecto</p>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const active = visibleUserIds.includes(member.user_id);
              return (
                <button
                  key={member.user_id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleUser(member.user_id)}
                  className={`type-ui min-h-[44px] rounded-lg border px-3.5 text-left text-xs transition-colors duration-300 ${
                    active
                      ? "border-stone-900 bg-stone-900 text-background"
                      : "border-stone-900/20 bg-surface/60 text-stone-800 hover:border-stone-900/45"
                  }`}
                >
                  {active ? "✓ " : "+ "}
                  {member.full_name || member.email} ({member.role})
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectAssetsLibrary({
  projectId,
  mode,
}: ProjectAssetsLibraryProps) {
  const isAdmin = mode === "admin";

  const [me, setMe] = useState<MeUser | null>(null);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [assets, setAssets] = useState<ProjectAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "all">(
    "all"
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Upload form state (Team only: SUPER_ADMIN, LEAD_DESIGNER, COLLABORATOR)
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategory, setUploadCategory] =
    useState<AssetCategory>("deliverables");
  const [uploadVisibility, setUploadVisibility] =
    useState<AssetVisibility>("internal_only");
  const [uploadVisibleRoles, setUploadVisibleRoles] = useState<UserRole[]>([]);
  const [uploadVisibleUserIds, setUploadVisibleUserIds] = useState<string[]>(
    []
  );
  const [uploadChangelog, setUploadChangelog] = useState("Versión inicial");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inspection drawer state
  const [selectedAsset, setSelectedAsset] = useState<ProjectAssetDetail | null>(
    null
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);

  // Metadata edit in drawer
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] =
    useState<AssetCategory>("deliverables");
  const [editVisibility, setEditVisibility] =
    useState<AssetVisibility>("internal_only");
  const [editVisibleRoles, setEditVisibleRoles] = useState<UserRole[]>([]);
  const [editVisibleUserIds, setEditVisibleUserIds] = useState<string[]>([]);
  const [savingMeta, setSavingMeta] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(false);

  // Upload new version inside drawer
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionChangelog, setVersionChangelog] = useState("");
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null
  );
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [drawerMessage, setDrawerMessage] = useState("");
  const versionInputRef = useRef<HTMLInputElement | null>(null);

  // Fullscreen tap-to-zoom lightbox
  const [zoomedImage, setZoomedImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const canUpload = isAdmin && me !== null && me.role !== "CLIENT";
  const canManageVisibility =
    isAdmin &&
    (me?.role === "SUPER_ADMIN" || me?.role === "LEAD_DESIGNER");

  useEffect(() => {
    let active = true;
    async function loadSessionAndMembers() {
      try {
        const meRes = await apiFetch("/api/v1/auth/me");
        if (!active) return;
        if (meRes.ok) {
          const userData = (await meRes.json()) as MeUser;
          setMe(userData);
          if (userData.role !== "CLIENT") {
            const membersRes = await apiFetch(
              `/api/v1/projects/${projectId}/members-summary`
            );
            if (active && membersRes.ok) {
              const mData: unknown = await membersRes.json();
              if (Array.isArray(mData)) {
                setMembers(mData as MemberSummary[]);
              }
            }
          }
        }
      } catch {
        // Ignore transient session load error; asset fetch will surface auth errors if any.
      }
    }
    loadSessionAndMembers();
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (categoryFilter !== "all") qs.set("category", categoryFilter);
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const querySuffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets${querySuffix}`
      );
      if (res.ok) {
        const data: unknown = await res.json();
        setAssets(Array.isArray(data) ? (data as ProjectAssetSummary[]) : []);
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setError(extractDetail(body, "Error al cargar la librería de assets"));
      }
    } catch {
      setError("Error de conexión al cargar los assets");
    } finally {
      setLoading(false);
    }
  }, [projectId, categoryFilter, debouncedSearch]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (!selectedAsset && !zoomedImage) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (zoomedImage) {
          setZoomedImage(null);
        } else {
          setSelectedAsset(null);
          setConfirmDelete(false);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedAsset, zoomedImage]);

  function hydrateDrawer(detail: ProjectAssetDetail) {
    setSelectedAsset(detail);
    setEditTitle(detail.title);
    setEditDescription(detail.description ?? "");
    setEditCategory(detail.category);
    setEditVisibility(detail.visibility);
    setEditVisibleRoles(detail.visible_roles ?? []);
    setEditVisibleUserIds(detail.visible_user_ids ?? []);
    setPreviewVersionId(
      detail.current_version?.id ?? detail.versions[0]?.id ?? null
    );
    setConfirmDelete(false);
    setVersionFile(null);
    setVersionChangelog("");
    if (versionInputRef.current) versionInputRef.current.value = "";
  }

  async function openAssetDrawer(assetId: string) {
    setLoadingDetail(true);
    setDrawerMessage("");
    setError("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets/${assetId}`
      );
      if (res.ok) {
        const detail: ProjectAssetDetail = await res.json();
        hydrateDrawer(detail);
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setError(extractDetail(body, "No se pudo abrir el detalle del asset"));
      }
    } catch {
      setError("Error de conexión al consultar el asset");
    } finally {
      setLoadingDetail(false);
    }
  }

  function addFilesToQueue(fileList: FileList | File[]) {
    if (!canUpload) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setQueuedFiles((prev) => [...prev, ...incoming]);
    setShowUploadPanel(true);
    setUploadStatus("");
  }

  async function handleUploadSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canUpload) return;
    if (queuedFiles.length === 0) {
      setUploadStatus("Selecciona o arrastra al menos un archivo.");
      return;
    }
    if (
      canManageVisibility &&
      uploadVisibility === "custom" &&
      uploadVisibleRoles.length === 0 &&
      uploadVisibleUserIds.length === 0
    ) {
      setUploadStatus(
        "Para visibilidad personalizada selecciona al menos un rol o usuario."
      );
      return;
    }

    setUploading(true);
    setError("");
    setFeedback("");
    let uploadedCount = 0;

    try {
      for (let i = 0; i < queuedFiles.length; i++) {
        const file = queuedFiles[i];
        setUploadStatus(
          `Subiendo ${i + 1} de ${queuedFiles.length}: ${file.name}…`
        );
        const form = new FormData();
        form.append("file", file);
        if (queuedFiles.length === 1 && uploadTitle.trim()) {
          form.append("title", uploadTitle.trim());
        }
        if (uploadDescription.trim()) {
          form.append("description", uploadDescription.trim());
        }
        form.append("category", uploadCategory);
        if (canManageVisibility) {
          form.append("visibility", uploadVisibility);
          if (uploadVisibility === "custom") {
            form.append("visible_roles", JSON.stringify(uploadVisibleRoles));
            form.append(
              "visible_user_ids",
              JSON.stringify(uploadVisibleUserIds)
            );
          }
        } else {
          form.append("visibility", "internal_only");
        }
        if (uploadChangelog.trim()) {
          form.append("changelog", uploadChangelog.trim());
        }

        const res = await apiFetch(`/api/v1/projects/${projectId}/assets`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body: unknown = await res.json().catch(() => ({}));
          throw new Error(extractDetail(body, `Error al subir ${file.name}`));
        }
        uploadedCount++;
      }

      setQueuedFiles([]);
      setUploadTitle("");
      setUploadDescription("");
      setUploadChangelog("Versión inicial");
      setUploadVisibleRoles([]);
      setUploadVisibleUserIds([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadStatus("");
      setShowUploadPanel(false);
      setFeedback(
        uploadedCount === 1
          ? "Asset subido correctamente (v1) ✓"
          : `${uploadedCount} assets subidos correctamente (v1) ✓`
      );
      await loadAssets();
    } catch (err) {
      setUploadStatus(
        err instanceof Error ? err.message : "Error al subir los archivos"
      );
      if (uploadedCount > 0) {
        await loadAssets();
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAsset || !canUpload) return;
    if (!editTitle.trim()) {
      setDrawerMessage("El título no puede estar vacío.");
      return;
    }
    if (
      canManageVisibility &&
      editVisibility === "custom" &&
      editVisibleRoles.length === 0 &&
      editVisibleUserIds.length === 0
    ) {
      setDrawerMessage(
        "Para visibilidad personalizada selecciona al menos un rol o usuario."
      );
      return;
    }

    setSavingMeta(true);
    setDrawerMessage("");
    try {
      const payload: Record<string, unknown> = {
        title: editTitle.trim(),
        description: editDescription.trim(),
        category: editCategory,
      };
      if (canManageVisibility) {
        payload.visibility = editVisibility;
        if (editVisibility === "custom") {
          payload.visible_roles = editVisibleRoles;
          payload.visible_user_ids = editVisibleUserIds;
        }
      }

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets/${selectedAsset.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      if (res.ok) {
        const updated: ProjectAssetDetail = await res.json();
        hydrateDrawer(updated);
        setDrawerMessage("Metadatos y permisos actualizados ✓");
        await loadAssets();
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setDrawerMessage(
          extractDetail(body, "No se pudieron guardar los metadatos")
        );
      }
    } catch {
      setDrawerMessage("Error de conexión al guardar");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleUploadNewVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAsset || !canUpload || !versionFile) {
      setDrawerMessage("Selecciona un archivo para la nueva versión.");
      return;
    }

    setUploadingVersion(true);
    setDrawerMessage("");
    try {
      const form = new FormData();
      form.append("file", versionFile);
      if (versionChangelog.trim()) {
        form.append("changelog", versionChangelog.trim());
      }
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets/${selectedAsset.id}/versions`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        const updated: ProjectAssetDetail = await res.json();
        hydrateDrawer(updated);
        setDrawerMessage(
          `Versión v${updated.current_version_number} publicada como actual ✓`
        );
        await loadAssets();
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setDrawerMessage(
          extractDetail(body, "No se pudo subir la nueva versión")
        );
      }
    } catch {
      setDrawerMessage("Error de conexión al subir la versión");
    } finally {
      setUploadingVersion(false);
    }
  }

  async function handleRestoreVersion(version: AssetVersionItem) {
    if (!selectedAsset || !canUpload) return;
    setRestoringVersionId(version.id);
    setDrawerMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets/${selectedAsset.id}/versions/${version.id}/restore`,
        { method: "POST" }
      );
      if (res.ok) {
        const updated: ProjectAssetDetail = await res.json();
        hydrateDrawer(updated);
        setDrawerMessage(
          `Versión v${version.version_number} restaurada como versión actual ✓`
        );
        await loadAssets();
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setDrawerMessage(
          extractDetail(body, "No se pudo restaurar la versión")
        );
      }
    } catch {
      setDrawerMessage("Error de conexión al restaurar la versión");
    } finally {
      setRestoringVersionId(null);
    }
  }

  async function handleDeleteAsset() {
    if (!selectedAsset || !canManageVisibility) return;
    setDeletingAsset(true);
    setDrawerMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/assets/${selectedAsset.id}`,
        { method: "DELETE" }
      );
      if (res.status === 204 || res.ok) {
        setSelectedAsset(null);
        setConfirmDelete(false);
        setFeedback("Asset eliminado de la librería ✓");
        await loadAssets();
      } else {
        const body: unknown = await res.json().catch(() => ({}));
        setDrawerMessage(extractDetail(body, "No se pudo eliminar el asset"));
      }
    } catch {
      setDrawerMessage("Error de conexión al eliminar el asset");
    } finally {
      setDeletingAsset(false);
    }
  }

  async function handleDownloadVersion(version: AssetVersionItem) {
    setDownloadingKey(version.id);
    try {
      const url = await apiFetchBlobUrl(`${version.file_url}?download=true`);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = version.file_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDrawerMessage(
        err instanceof Error ? err.message : "Error al descargar el archivo"
      );
    } finally {
      setDownloadingKey(null);
    }
  }

  const activePreviewVersion = selectedAsset
    ? selectedAsset.versions.find((v) => v.id === previewVersionId) ??
      selectedAsset.current_version ??
      selectedAsset.versions[0] ??
      null
    : null;

  const etapasHref = isAdmin
    ? `/admin/projects/${projectId}/etapas`
    : `/portal/projects/${projectId}/etapas`;

  return (
    <section className="brief-editorial space-y-6">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-tech text-stone-600">
            04 · Repositorio central versionado
          </p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
            Librería de Assets
          </h1>
          <p className="type-editorial mt-2 text-[15px] leading-relaxed text-stone-600">
            {isAdmin
              ? "Repositorio único de planos, presentaciones, contratos, entregables sincronizados desde etapas y referencias."
              : "Consulta y descarga los entregables, planos y documentos habilitados por el estudio con su historial de versiones."}
          </p>
        </div>

        {canUpload && (
          <button
            type="button"
            onClick={() => setShowUploadPanel((prev) => !prev)}
            className="type-ui min-h-[44px] shrink-0 self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 sm:self-auto"
          >
            {showUploadPanel ? "Cerrar carga" : "Subir assets ↗"}
          </button>
        )}
      </div>

      {error && (
        <div className="type-ui rounded-xl border border-stone-900/20 bg-surface/75 p-4 text-sm text-stone-800">
          {error}
        </div>
      )}

      {feedback && (
        <div className="type-ui rounded-xl border border-[#5F7161]/35 bg-[#EEF2EC]/75 p-4 text-sm text-[#44544A]">
          {feedback}
        </div>
      )}

      {/* Drag-and-drop multi-file upload panel (Team only) */}
      {canUpload && showUploadPanel && (
        <form
          onSubmit={handleUploadSubmit}
          className="space-y-4 rounded-2xl border border-stone-900/15 bg-surface/75 p-5 md:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-900/10 pb-3">
            <p className="type-tech text-stone-800">
              Subir nuevos archivos (se crean como v1)
            </p>
            <span className="type-tech text-stone-500">
              Máx. 25 MB / archivo
            </span>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                addFilesToQueue(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors duration-300 ${
              isDragging
                ? "border-stone-900 bg-stone-900 text-background"
                : "border-stone-900/20 bg-background text-stone-800 hover:border-stone-900/45"
            }`}
          >
            <p className="type-editorial text-[15px]">
              Arrastra planos, presentaciones, contratos o entregables aquí, o
              selecciónalos desde tu equipo.
            </p>
            <p
              className={`type-tech ${
                isDragging ? "text-background/80" : "text-stone-500"
              }`}
            >
              JPG · PNG · WEBP · SVG · PDF · AI · FIG · ZIP · PSD · DWG · DXF ·
              DOCX · PPTX
            </p>
            <label className="type-ui mt-1 inline-flex min-h-[44px] cursor-pointer items-center rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800">
              Elegir archivos ↗
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    addFilesToQueue(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {queuedFiles.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-stone-900/15 bg-background p-4">
              <p className="type-tech mb-2 text-stone-600">
                Archivos en cola ({queuedFiles.length})
              </p>
              {queuedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 border-t border-stone-900/10 py-2 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="type-ui truncate text-sm text-stone-900">
                      {file.name}
                    </p>
                    <p className="type-tech text-stone-500">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="type-ui min-h-[44px] shrink-0 rounded-lg border border-stone-900/20 px-3 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
                  >
                    Quitar ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {queuedFiles.length <= 1 && (
              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-sm text-stone-600">
                  Título (opcional — por defecto usa el nombre del archivo)
                </span>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Ej. Planta conceptual salón principal"
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-500 focus:border-stone-900/45"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="type-ui text-sm text-stone-600">
                Nota inicial de versión (v1)
              </span>
              <input
                type="text"
                value={uploadChangelog}
                onChange={(e) => setUploadChangelog(e.target.value)}
                maxLength={500}
                placeholder="Versión inicial"
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-500 focus:border-stone-900/45"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="type-ui text-sm text-stone-600">Categoría</span>
              <select
                value={uploadCategory}
                onChange={(e) =>
                  setUploadCategory(e.target.value as AssetCategory)
                }
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {canManageVisibility ? (
              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-sm text-stone-600">
                  Visibilidad (configurada por Lead)
                </span>
                <select
                  value={uploadVisibility}
                  onChange={(e) =>
                    setUploadVisibility(e.target.value as AssetVisibility)
                  }
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                >
                  <option value="internal_only">
                    Solo equipo interno del estudio
                  </option>
                  <option value="client_visible">
                    Visible para equipo y cliente
                  </option>
                  <option value="custom">
                    Personalizada por rol / usuario
                  </option>
                </select>
              </label>
            ) : (
              <div className="flex items-center rounded-xl border border-stone-900/10 bg-background/70 px-3.5 py-2">
                <p className="type-tech text-stone-600">
                  Visibilidad inicial: solo interno · El Lead Designer define el
                  acceso del cliente
                </p>
              </div>
            )}
          </div>

          {canManageVisibility && uploadVisibility === "custom" && (
            <GranularVisibilityPicker
              visibleRoles={uploadVisibleRoles}
              visibleUserIds={uploadVisibleUserIds}
              members={members}
              onToggleRole={(role) =>
                setUploadVisibleRoles((prev) =>
                  prev.includes(role)
                    ? prev.filter((r) => r !== role)
                    : [...prev, role]
                )
              }
              onToggleUser={(uid) =>
                setUploadVisibleUserIds((prev) =>
                  prev.includes(uid)
                    ? prev.filter((id) => id !== uid)
                    : [...prev, uid]
                )
              }
            />
          )}

          <label className="flex flex-col gap-1.5">
            <span className="type-ui text-sm text-stone-600">
              Descripción (opcional)
            </span>
            <textarea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Contexto curatorial, uso previsto o notas clave…"
              className="type-ui w-full rounded-xl border border-stone-900/15 bg-background p-4 text-sm text-stone-900 placeholder:text-stone-500 focus:border-stone-900/45"
            />
          </label>

          {uploadStatus && (
            <p className="type-ui text-sm text-stone-700">{uploadStatus}</p>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              disabled={uploading || queuedFiles.length === 0}
              className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading
                ? "Subiendo…"
                : `Subir ${queuedFiles.length > 1 ? `${queuedFiles.length} archivos` : "asset"} ↗`}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUploadPanel(false);
                setQueuedFiles([]);
                setUploadStatus("");
              }}
              disabled={uploading}
              className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Filter bar + Search */}
      <div className="flex flex-col gap-3 rounded-2xl border border-stone-900/10 bg-surface/75 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`type-ui min-h-[44px] rounded-lg border px-3.5 text-xs transition-colors duration-300 ${
              categoryFilter === "all"
                ? "border-stone-900 bg-stone-900 text-background"
                : "border-stone-900/15 bg-background text-stone-700 hover:border-stone-900/45"
            }`}
          >
            Todos
          </button>
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCategoryFilter(opt.value)}
              className={`type-ui min-h-[44px] rounded-lg border px-3.5 text-xs transition-colors duration-300 ${
                categoryFilter === opt.value
                  ? "border-stone-900 bg-stone-900 text-background"
                  : "border-stone-900/15 bg-background text-stone-700 hover:border-stone-900/45"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="flex w-full items-center gap-2 rounded-lg border border-stone-900/15 bg-background px-3.5 transition-colors duration-300 focus-within:border-stone-900/45 md:w-72">
          <span className="type-tech shrink-0 text-stone-500">Buscar</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Título o descripción…"
            aria-label="Buscar assets por título o descripción"
            className="type-ui min-h-[44px] w-full bg-transparent text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none"
          />
        </label>
      </div>

      {/* Asset Grid */}
      {loading && assets.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8 text-center">
          <p className="type-tech text-stone-500">
            Cargando librería de assets…
          </p>
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8 text-center">
          <p className="type-editorial text-base italic text-stone-700">
            {debouncedSearch || categoryFilter !== "all"
              ? "No hay assets que coincidan con el filtro actual."
              : isAdmin
                ? "Todavía no hay assets en este proyecto."
                : "Todavía no hay documentos habilitados por el estudio para tu consulta."}
          </p>
          {canUpload && (
            <p className="type-tech mt-2.5 text-stone-500">
              Usa «Subir assets» o carga un entregable en Etapas para
              sincronizarlo automáticamente aquí.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => openAssetDrawer(asset.id)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-stone-900/15 bg-background text-left shadow-editorial transition-all duration-300 hover:border-stone-900/35"
            >
              <div className="relative w-full border-b border-stone-900/10">
                <AssetCardThumbnail
                  version={asset.current_version}
                  title={asset.title}
                />
                <span className="type-tech absolute right-3 top-3 rounded-lg bg-stone-900/90 px-2.5 py-0.5 text-background">
                  v{asset.current_version_number}
                </span>
                {isAdmin && (
                  <span
                    className={`type-tech absolute left-3 top-3 rounded-lg border px-2.5 py-0.5 ${
                      asset.visibility === "client_visible"
                        ? "border-[#5F7161]/45 bg-[#EEF2EC]/95 text-[#44544A]"
                        : "border-stone-900/15 bg-background/95 text-stone-700"
                    }`}
                  >
                    {VISIBILITY_LABELS[asset.visibility]}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-tech text-stone-500">
                      {CATEGORY_LABELS[asset.category]}
                    </span>
                    <span className="type-tech text-stone-500">
                      {asset.version_count}{" "}
                      {asset.version_count === 1 ? "ver." : "vers."}
                    </span>
                  </div>
                  <h2 className="type-editorial mt-1.5 line-clamp-1 text-lg text-stone-900">
                    {asset.title}
                  </h2>
                  {asset.source_stage_name && (
                    <p className="type-tech mt-2 inline-block rounded-lg border border-stone-900/10 bg-surface/75 px-2.5 py-0.5 text-stone-600">
                      Etapa · {asset.source_stage_name}
                    </p>
                  )}
                  {asset.description && (
                    <p className="type-ui mt-2 line-clamp-2 text-xs leading-relaxed text-stone-600">
                      {asset.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-stone-900/10 pt-3">
                  <span className="type-tech truncate text-stone-500">
                    {asset.uploaded_by_name || "Equipo"} ·{" "}
                    {formatDate(asset.updated_at)}
                  </span>
                  <span className="type-tech shrink-0 text-stone-800">
                    Inspeccionar ↗
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Inspection Drawer */}
      {(selectedAsset || loadingDetail) && (
        <div
          className="animate-backdrop-enter fixed inset-0 z-40 flex justify-end bg-stone-900/40 backdrop-blur-[2px]"
          onClick={() => {
            setSelectedAsset(null);
            setConfirmDelete(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Inspector de asset"
            onClick={(e) => e.stopPropagation()}
            className="brief-editorial animate-drawer-enter flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-stone-900/15 bg-background shadow-editorial"
          >
            {loadingDetail && !selectedAsset ? (
              <div className="p-6">
                <p className="type-tech text-stone-500">Cargando detalle…</p>
              </div>
            ) : selectedAsset ? (
              <>
                {/* Drawer header */}
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-900/15 bg-background/95 px-5 py-4 backdrop-blur-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="type-tech rounded-lg bg-stone-900 px-2.5 py-0.5 text-background">
                        v{selectedAsset.current_version_number}
                      </span>
                      <span className="type-tech text-stone-500">
                        {CATEGORY_LABELS[selectedAsset.category]}
                      </span>
                      {isAdmin && (
                        <span
                          className={`type-tech rounded-lg border px-2.5 py-0.5 ${
                            selectedAsset.visibility === "client_visible"
                              ? "border-[#5F7161]/40 bg-[#EEF2EC] text-[#44544A]"
                              : "border-stone-900/15 bg-surface text-stone-700"
                          }`}
                        >
                          {VISIBILITY_LABELS[selectedAsset.visibility]}
                        </span>
                      )}
                    </div>
                    <h2 className="type-editorial mt-1.5 truncate text-xl text-stone-900">
                      {selectedAsset.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setConfirmDelete(false);
                    }}
                    aria-label="Cerrar inspector"
                    className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-stone-900/20 bg-background text-base text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-6 p-5">
                  {drawerMessage && (
                    <p className="type-ui rounded-xl border border-[#5F7161]/35 bg-[#EEF2EC]/75 p-3.5 text-xs text-[#44544A]">
                      {drawerMessage}
                    </p>
                  )}

                  {selectedAsset.source_stage_name && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-900/10 bg-surface/75 px-4 py-3">
                      <div>
                        <p className="type-tech text-stone-500">
                          Origen sincronizado sin duplicación
                        </p>
                        <p className="type-editorial mt-0.5 text-sm text-stone-900">
                          Etapa: {selectedAsset.source_stage_name}
                        </p>
                      </div>
                      <Link
                        href={etapasHref}
                        className="type-ui inline-flex min-h-[44px] items-center rounded-lg border border-stone-900/20 bg-background px-3.5 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
                      >
                        Ir a Etapas ↗
                      </Link>
                    </div>
                  )}

                  {/* Active Version Preview & Direct Download */}
                  {activePreviewVersion && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="type-tech text-stone-600">
                          Vista previa · v{activePreviewVersion.version_number}
                          {activePreviewVersion.is_current
                            ? " (Actual)"
                            : " (Histórica)"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadVersion(activePreviewVersion)
                          }
                          disabled={downloadingKey === activePreviewVersion.id}
                          className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:opacity-50"
                        >
                          {downloadingKey === activePreviewVersion.id
                            ? "Descargando…"
                            : `Descargar v${activePreviewVersion.version_number} ↗`}
                        </button>
                      </div>

                      <DrawerVersionPreview
                        version={activePreviewVersion}
                        title={selectedAsset.title}
                        onZoom={(src, alt) => setZoomedImage({ src, alt })}
                      />
                    </div>
                  )}

                  {/* Metadata section */}
                  {canUpload ? (
                    <form
                      onSubmit={handleSaveMetadata}
                      className="space-y-3.5 rounded-2xl border border-stone-900/10 bg-surface/75 p-5"
                    >
                      <p className="type-tech text-stone-700">
                        Metadatos y visibilidad del asset
                      </p>
                      <label className="flex flex-col gap-1.5">
                        <span className="type-ui text-sm text-stone-600">
                          Título
                        </span>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          maxLength={200}
                          className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="type-ui text-sm text-stone-600">
                          Descripción
                        </span>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          maxLength={2000}
                          className="type-ui w-full rounded-xl border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                        />
                      </label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="type-ui text-sm text-stone-600">
                            Categoría
                          </span>
                          <select
                            value={editCategory}
                            onChange={(e) =>
                              setEditCategory(e.target.value as AssetCategory)
                            }
                            className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                          >
                            {CATEGORY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {canManageVisibility ? (
                          <label className="flex flex-col gap-1.5">
                            <span className="type-ui text-sm text-stone-600">
                              Visibilidad
                            </span>
                            <select
                              value={editVisibility}
                              onChange={(e) =>
                                setEditVisibility(
                                  e.target.value as AssetVisibility
                                )
                              }
                              className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                            >
                              <option value="internal_only">
                                Solo equipo interno
                              </option>
                              <option value="client_visible">
                                Visible para cliente
                              </option>
                              <option value="custom">
                                Personalizada por rol / usuario
                              </option>
                            </select>
                          </label>
                        ) : (
                          <div className="flex flex-col justify-center rounded-xl border border-stone-900/10 bg-background/70 px-3.5 py-2">
                            <span className="type-tech text-stone-500">
                              Visibilidad (solo Lead)
                            </span>
                            <span className="type-ui mt-0.5 text-xs text-stone-800">
                              {describeVisibility(selectedAsset, members)}
                            </span>
                          </div>
                        )}
                      </div>

                      {canManageVisibility && editVisibility === "custom" && (
                        <GranularVisibilityPicker
                          visibleRoles={editVisibleRoles}
                          visibleUserIds={editVisibleUserIds}
                          members={members}
                          onToggleRole={(role) =>
                            setEditVisibleRoles((prev) =>
                              prev.includes(role)
                                ? prev.filter((r) => r !== role)
                                : [...prev, role]
                            )
                          }
                          onToggleUser={(uid) =>
                            setEditVisibleUserIds((prev) =>
                              prev.includes(uid)
                                ? prev.filter((id) => id !== uid)
                                : [...prev, uid]
                            )
                          }
                        />
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={savingMeta}
                          className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:opacity-50"
                        >
                          {savingMeta ? "Guardando…" : "Guardar cambios ↗"}
                        </button>

                        {canManageVisibility &&
                          (!confirmDelete ? (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(true)}
                              className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
                            >
                              Eliminar asset
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleDeleteAsset}
                                disabled={deletingAsset}
                                className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-4 py-2 text-xs text-background"
                              >
                                {deletingAsset
                                  ? "Eliminando…"
                                  : "Confirmar eliminación"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(false)}
                                className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-3.5 text-xs text-stone-700"
                              >
                                Cancelar
                              </button>
                            </div>
                          ))}
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-2 rounded-2xl border border-stone-900/10 bg-surface/75 p-5">
                      <p className="type-tech text-stone-500">Descripción</p>
                      <p className="type-editorial text-[15px] leading-relaxed text-stone-800">
                        {selectedAsset.description ||
                          "Sin descripción adicional."}
                      </p>
                      <p className="type-tech pt-2 text-stone-500">
                        Subido por {selectedAsset.uploaded_by_name || "Estudio"}{" "}
                        · {formatDate(selectedAsset.created_at)}
                      </p>
                    </div>
                  )}

                  {/* Upload New Version (Team only: COLLABORATOR, LEAD_DESIGNER, SUPER_ADMIN) */}
                  {canUpload && (
                    <form
                      onSubmit={handleUploadNewVersion}
                      className="space-y-3.5 rounded-2xl border border-stone-900/15 bg-background p-5"
                    >
                      <p className="type-tech text-stone-700">
                        Subir nueva versión (v
                        {selectedAsset.versions.reduce(
                          (max, v) => Math.max(max, v.version_number),
                          0
                        ) + 1}
                        )
                      </p>
                      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-stone-900/20 bg-surface/60 px-4 transition-colors duration-300 hover:border-stone-900/45">
                        <span className="type-ui truncate text-sm text-stone-700">
                          {versionFile
                            ? `${versionFile.name} (${formatBytes(versionFile.size)})`
                            : "Seleccionar archivo para nueva versión"}
                        </span>
                        <input
                          ref={versionInputRef}
                          type="file"
                          accept={ACCEPTED_EXTENSIONS}
                          className="sr-only"
                          onChange={(e) =>
                            setVersionFile(e.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="type-ui text-sm text-stone-600">
                          Nota de cambios (changelog)
                        </span>
                        <input
                          type="text"
                          value={versionChangelog}
                          onChange={(e) => setVersionChangelog(e.target.value)}
                          maxLength={500}
                          placeholder="Ej. Ajuste de contraste tipográfico y márgenes"
                          className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-500 focus:border-stone-900/45"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={uploadingVersion || !versionFile}
                        className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {uploadingVersion
                          ? "Publicando versión…"
                          : "Subir nueva versión ↗"}
                      </button>
                    </form>
                  )}

                  {/* Collapsible Version History */}
                  <div className="overflow-hidden rounded-2xl border border-stone-900/15 bg-background">
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((prev) => !prev)}
                      aria-expanded={historyOpen}
                      className="flex min-h-[44px] w-full items-center justify-between bg-surface/75 px-5 py-3 text-left transition-colors hover:bg-[#EAE5DC]"
                    >
                      <span className="type-tech text-stone-800">
                        Historial de versiones ({selectedAsset.versions.length})
                      </span>
                      <span className="type-tech text-stone-600">
                        {historyOpen ? "Ocultar −" : "Desplegar +"}
                      </span>
                    </button>

                    {historyOpen && (
                      <div className="divide-y divide-stone-900/10 border-t border-stone-900/10">
                        {selectedAsset.versions.map((ver) => {
                          const isPreviewing =
                            activePreviewVersion?.id === ver.id;
                          return (
                            <div
                              key={ver.id}
                              className={`space-y-2 p-4 ${
                                isPreviewing ? "bg-surface/65" : "bg-background"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="type-tech rounded-lg bg-stone-900 px-2.5 py-0.5 text-background">
                                    v{ver.version_number}
                                  </span>
                                  {ver.is_current && (
                                    <span className="type-tech rounded-lg border border-[#5F7161]/40 bg-[#EEF2EC] px-2.5 py-0.5 text-[#44544A]">
                                      Actual
                                    </span>
                                  )}
                                  <span className="type-tech text-stone-500">
                                    {ver.file_extension.toUpperCase()} ·{" "}
                                    {formatBytes(ver.size_bytes)}
                                  </span>
                                </div>
                                <span className="type-tech text-stone-500">
                                  {formatDate(ver.created_at)}
                                </span>
                              </div>

                              <p className="type-editorial truncate text-[15px] text-stone-900">
                                {ver.file_name}
                              </p>
                              {ver.changelog && (
                                <p className="type-ui text-xs leading-relaxed text-stone-600">
                                  {ver.changelog}
                                </p>
                              )}
                              <p className="type-tech text-stone-500">
                                Por {ver.uploaded_by_name || "Equipo"}
                              </p>

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setPreviewVersionId(ver.id)}
                                  className={`type-ui min-h-[44px] rounded-lg border px-3.5 text-xs transition-colors duration-300 ${
                                    isPreviewing
                                      ? "border-stone-900 bg-stone-900 text-background"
                                      : "border-stone-900/20 bg-background text-stone-700 hover:bg-stone-900 hover:text-background"
                                  }`}
                                >
                                  {isPreviewing
                                    ? "En vista previa"
                                    : "Previsualizar"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadVersion(ver)}
                                  disabled={downloadingKey === ver.id}
                                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-3.5 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:opacity-50"
                                >
                                  {downloadingKey === ver.id
                                    ? "Descargando…"
                                    : "Descargar ↗"}
                                </button>
                                {canUpload && !ver.is_current && (
                                  <button
                                    type="button"
                                    onClick={() => handleRestoreVersion(ver)}
                                    disabled={restoringVersionId === ver.id}
                                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-3.5 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background disabled:opacity-50"
                                  >
                                    {restoringVersionId === ver.id
                                      ? "Restaurando…"
                                      : "Restaurar como actual"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}

      {/* Fullscreen tap-to-zoom lightbox */}
      {zoomedImage && (
        <div
          role="button"
          tabIndex={0}
          autoFocus
          aria-label="Cerrar imagen ampliada"
          onClick={() => setZoomedImage(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
              setZoomedImage(null);
            }
          }}
          className="animate-backdrop-enter fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-stone-950/90 p-4 backdrop-blur-sm"
        >
          <div className="animate-lightbox-enter max-h-full max-w-full overflow-hidden rounded-2xl border border-stone-200/20 bg-background p-2 shadow-editorial">
            <img
              src={zoomedImage.src}
              alt={zoomedImage.alt}
              className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
}
