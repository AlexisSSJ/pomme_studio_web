import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  GeminiReportError,
  generateBriefReportMarkdown,
  type BriefReportImageInput,
  type BriefReportQuestionInput,
  type BriefReportReferenceInput,
} from "./gemini";
import { renderBriefReportPdf } from "./pdf";
import {
  VALID_ROLES,
  appendAuditLog,
  type AppStore,
  type AssetCategory,
  type AssetVisibility,
  type StoredAssetVersion,
  type StoredBriefItem,
  type StoredBriefReport,
  type StoredDeliverable,
  type StoredProject,
  type StoredProjectAsset,
  type StoredUser,
  type UserRole,
} from "./store";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_BRIEF_FILE_BYTES = 10 * 1024 * 1024;

export const VALID_ASSET_CATEGORIES: readonly AssetCategory[] = [
  "deliverables",
  "plans",
  "presentations",
  "contracts",
  "references",
  "typography_palette",
  "client_resources",
];

export const VALID_ASSET_VISIBILITIES: readonly AssetVisibility[] = [
  "internal_only",
  "client_visible",
  "custom",
];

export const ASSET_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "svg",
  "gif",
]);

const ASSET_EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  gif: "image/gif",
  pdf: "application/pdf",
  ai: "application/postscript",
  fig: "application/octet-stream",
  zip: "application/zip",
  psd: "image/vnd.adobe.photoshop",
  sketch: "application/octet-stream",
  indd: "application/x-indesign",
  dwg: "application/acad",
  dxf: "application/dxf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const BRIEF_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const BRIEF_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

const BRIEF_REFERENCE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

function jsonError(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

function slugifyFilename(value: string): string {
  const cleaned = (value || "brief")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (cleaned || "brief").slice(0, 60);
}

export function sanitizeHeaderFilename(name: string): string {
  const cleaned = name.replace(/["\\\r\n]/g, "_").trim();
  return cleaned.slice(0, 200) || "archivo";
}

function defaultTitleFromFilename(filename: string): string {
  const stem = filename.includes(".")
    ? filename.slice(0, filename.lastIndexOf("."))
    : filename;
  const cleaned = stem.replace(/[_-]+/g, " ").trim();
  return (cleaned || "Asset").slice(0, 200);
}

export function resolveAssetFileType(
  fileName: string,
  contentType: string | null
): { ext: string; mime: string } | null {
  const baseName = fileName.trim();
  let ext = "";
  if (baseName.includes(".")) {
    ext = baseName.slice(baseName.lastIndexOf(".") + 1).toLowerCase();
  }
  const normalizedCt = (contentType || "").split(";")[0].trim().toLowerCase();
  if (!ext && normalizedCt) {
    const matched = Object.entries(ASSET_EXTENSION_MIME).find(
      ([, mime]) => mime === normalizedCt
    );
    if (matched) ext = matched[0];
  }
  if (!ext || !ASSET_EXTENSION_MIME[ext]) {
    return null;
  }
  const mime =
    normalizedCt && normalizedCt !== "application/octet-stream"
      ? normalizedCt
      : ASSET_EXTENSION_MIME[ext];
  return { ext, mime };
}

export function getUserDisplayName(store: AppStore, userId: string): string | null {
  const u = store.users.get(userId);
  if (!u) return null;
  return u.full_name || u.email;
}

export function canManageAssetVisibility(user: StoredUser): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "LEAD_DESIGNER";
}

export function isAssetVisibleToClient(
  project: StoredProject,
  asset: StoredProjectAsset
): boolean {
  if (asset.visibility === "client_visible") return true;
  if (asset.visibility === "internal_only") return false;
  if (asset.visible_roles.includes("CLIENT")) return true;
  if (project.client_id && asset.visible_user_ids.includes(project.client_id)) {
    return true;
  }
  return false;
}

export function canUserViewAsset(
  project: StoredProject,
  user: StoredUser,
  asset: StoredProjectAsset
): boolean {
  if (user.role === "SUPER_ADMIN" || user.role === "LEAD_DESIGNER") {
    return true;
  }
  if (asset.visibility === "client_visible") {
    return true;
  }
  if (asset.visibility === "internal_only") {
    return user.role !== "CLIENT";
  }
  // Custom granular visibility configured by the Lead Designer
  if (asset.uploaded_by === user.id && user.role !== "CLIENT") {
    return true;
  }
  if (asset.visible_roles.includes(user.role)) {
    return true;
  }
  if (asset.visible_user_ids.includes(user.id)) {
    return true;
  }
  return false;
}

export function parseVisibleRoles(raw: unknown): UserRole[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : raw.split(",");
          } catch {
            return raw.split(",");
          }
        })()
      : [];
  const valid = new Set<UserRole>();
  for (const item of items) {
    if (typeof item === "string") {
      const cleaned = item.trim().toUpperCase();
      if (VALID_ROLES.includes(cleaned as UserRole)) {
        valid.add(cleaned as UserRole);
      }
    }
  }
  return Array.from(valid);
}

export function parseVisibleUserIds(
  store: AppStore,
  project: StoredProject,
  raw: unknown
): string[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : raw.split(",");
          } catch {
            return raw.split(",");
          }
        })()
      : [];
  const allowedIds = new Set<string>();
  if (project.client_id) allowedIds.add(project.client_id);
  if (project.lead_designer_id) allowedIds.add(project.lead_designer_id);
  for (const m of store.projectMembers.get(project.id) ?? []) {
    allowedIds.add(m.user_id);
  }
  const result = new Set<string>();
  for (const item of items) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id && allowedIds.has(id) && store.users.has(id)) {
        result.add(id);
      }
    }
  }
  return Array.from(result);
}

export function syncLinkedDeliverableVisibility(
  store: AppStore,
  project: StoredProject,
  asset: StoredProjectAsset,
  actorUserId: string
): void {
  const deliverables = store.deliverables.get(project.id) ?? [];
  const clientVisible = isAssetVisibleToClient(project, asset);
  const now = new Date().toISOString();
  for (const d of deliverables) {
    if (d.asset_id === asset.id || d.id === asset.source_deliverable_id) {
      d.is_client_visible = clientVisible;
      if (clientVisible && !d.published_at) {
        d.published_at = now;
        d.published_by = actorUserId;
      }
    }
  }
}

function isBriefItemAnswered(item: StoredBriefItem): boolean {
  return Boolean(
    item.status === "answered" ||
      (item.answer && item.answer.trim().length > 0) ||
      (item.audio_transcription && item.audio_transcription.trim().length > 0) ||
      (item.transcription && item.transcription.trim().length > 0) ||
      item.audio_url ||
      item.images.length > 0 ||
      item.image_url
  );
}

export function computeDetailedBriefProgress(
  store: AppStore,
  projectId: string
) {
  const items = (store.briefItems.get(projectId) ?? []).filter(
    (item) => item.item_type === "question"
  );
  const total = items.length;
  const answered = items.filter(isBriefItemAnswered).length;
  const progress = total === 0 ? 100 : Math.round((answered / total) * 100);
  const hasPending = total > 0 && answered < total;
  return {
    has_pending: hasPending,
    has_pending_brief: hasPending,
    total_questions: total,
    answered_questions: answered,
    progress,
    status:
      total === 0
        ? "pending"
        : answered >= total
          ? "completed"
          : answered > 0
            ? "in_progress"
            : "pending",
  };
}

export function notifyProjectTeamUsers(
  store: AppStore,
  project: StoredProject,
  eventType: string,
  payload: Record<string, unknown>,
  excludeUserId?: string
) {
  const recipientIds = new Set<string>();
  for (const user of store.users.values()) {
    if (user.is_active && user.role === "SUPER_ADMIN") {
      recipientIds.add(user.id);
    }
  }
  if (project.lead_designer_id) {
    recipientIds.add(project.lead_designer_id);
  }
  for (const member of store.projectMembers.get(project.id) ?? []) {
    if (member.assigned_role !== "CLIENT") {
      recipientIds.add(member.user_id);
    }
  }
  if (excludeUserId) {
    recipientIds.delete(excludeUserId);
  }
  const now = new Date().toISOString();
  for (const userId of recipientIds) {
    store.notifications.unshift({
      id: crypto.randomUUID(),
      user_id: userId,
      event_type: eventType,
      project_id: project.id,
      payload,
      read_at: null,
      created_at: now,
    });
  }
}

export function notifyProjectClient(
  store: AppStore,
  project: StoredProject,
  eventType: string,
  payload: Record<string, unknown>
) {
  if (!project.client_id) return;
  const client = store.users.get(project.client_id);
  if (!client || !client.is_active) return;
  store.notifications.unshift({
    id: crypto.randomUUID(),
    user_id: client.id,
    event_type: eventType,
    project_id: project.id,
    payload,
    read_at: null,
    created_at: new Date().toISOString(),
  });
}

async function generateAndStoreBriefReport(
  store: AppStore,
  project: StoredProject,
  actorUserId: string
): Promise<StoredBriefReport> {
  const items = store.briefItems.get(project.id) ?? [];
  const clientUser = project.client_id
    ? store.users.get(project.client_id)
    : undefined;
  const clientLabel = clientUser
    ? clientUser.full_name || clientUser.email
    : null;

  const questions: BriefReportQuestionInput[] = [];
  const references: BriefReportReferenceInput[] = [];
  const inlineImages: BriefReportImageInput[] = [];

  for (const item of items) {
    if (item.item_type === "question") {
      questions.push({
        category: item.category,
        prompt: item.prompt || "Pregunta del brief",
        answer: item.answer,
        transcription: item.audio_transcription || item.transcription,
        imageCount: item.images.length,
      });
      item.images.forEach((img, idx) => {
        const blob = store.mediaBlobs.get(`brief-img:${img.id}`);
        if (blob) {
          inlineImages.push({
            label: `${(item.prompt || "Pregunta").slice(0, 60)} — imagen ${idx + 1}`,
            contentType: blob.content_type,
            buffer: blob.buffer,
          });
        }
      });
    } else if (item.item_type === "reference") {
      references.push({
        category: item.category,
        fileName: item.file_name || "referencia",
        contentType: item.content_type,
        note: item.note,
      });
      const blob = store.mediaBlobs.get(`brief-ref:${item.id}`);
      if (blob && blob.content_type.startsWith("image/")) {
        inlineImages.push({
          label: `Referencia: ${item.file_name || "archivo"}`,
          contentType: blob.content_type,
          buffer: blob.buffer,
        });
      }
    }
  }

  const { markdown, modelUsed } = await generateBriefReportMarkdown({
    projectTitle: project.title,
    scopeType: project.scope_type,
    clientLabel,
    questions,
    references,
    images: inlineImages,
  });

  const now = new Date().toISOString();
  const existing = store.briefReports.get(project.id);
  const report: StoredBriefReport = existing
    ? {
        ...existing,
        status: "generated",
        content_markdown: markdown,
        model_used: modelUsed,
        generated_by: actorUserId,
        updated_by: actorUserId,
        generated_at: now,
        updated_at: now,
      }
    : {
        id: crypto.randomUUID(),
        project_id: project.id,
        brief_id: project.id,
        status: "generated",
        content_markdown: markdown,
        model_used: modelUsed,
        generated_by: actorUserId,
        updated_by: actorUserId,
        generated_at: now,
        created_at: now,
        updated_at: now,
      };

  store.briefReports.set(project.id, report);
  return report;
}

function getStageName(
  store: AppStore,
  projectId: string,
  stageId: string | null
): string | null {
  if (!stageId) return null;
  const stage = (store.stages.get(projectId) ?? []).find((s) => s.id === stageId);
  return stage ? stage.name : null;
}

export function serializeAssetVersion(
  store: AppStore,
  projectId: string,
  assetId: string,
  version: StoredAssetVersion
) {
  return {
    id: version.id,
    asset_id: assetId,
    version_number: version.version_number,
    file_name: version.file_name,
    file_extension: version.file_extension,
    content_type: version.content_type,
    size_bytes: version.size_bytes,
    changelog: version.changelog,
    is_current: version.is_current,
    is_image: ASSET_IMAGE_EXTENSIONS.has(version.file_extension.toLowerCase()),
    file_url: `/api/v1/projects/${projectId}/assets/${assetId}/versions/${version.id}/file`,
    uploaded_by: version.uploaded_by,
    uploaded_by_name: getUserDisplayName(store, version.uploaded_by),
    created_at: version.created_at,
  };
}

export function serializeAssetSummary(
  store: AppStore,
  projectId: string,
  asset: StoredProjectAsset
) {
  const versions = [...(store.assetVersions.get(asset.id) ?? [])].sort(
    (a, b) => b.version_number - a.version_number
  );
  const current = versions.find((v) => v.is_current) ?? versions[0] ?? null;
  return {
    id: asset.id,
    project_id: asset.project_id,
    title: asset.title,
    description: asset.description,
    category: asset.category,
    visibility: asset.visibility,
    visible_roles: asset.visible_roles,
    visible_user_ids: asset.visible_user_ids,
    source_stage_id: asset.source_stage_id,
    source_stage_name: getStageName(store, projectId, asset.source_stage_id),
    source_deliverable_id: asset.source_deliverable_id,
    source_change_request_id: asset.source_change_request_id,
    current_version_number: asset.current_version_number,
    version_count: versions.length,
    uploaded_by: asset.uploaded_by,
    uploaded_by_name: getUserDisplayName(store, asset.uploaded_by),
    current_version: current
      ? serializeAssetVersion(store, projectId, asset.id, current)
      : null,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  };
}

export function serializeAssetDetail(
  store: AppStore,
  projectId: string,
  asset: StoredProjectAsset
) {
  const versions = [...(store.assetVersions.get(asset.id) ?? [])].sort(
    (a, b) => b.version_number - a.version_number
  );
  const serializedVersions = versions.map((v) =>
    serializeAssetVersion(store, projectId, asset.id, v)
  );
  const current =
    serializedVersions.find((v) => v.is_current) ??
    serializedVersions[0] ??
    null;

  return {
    id: asset.id,
    project_id: asset.project_id,
    title: asset.title,
    description: asset.description,
    category: asset.category,
    visibility: asset.visibility,
    visible_roles: asset.visible_roles,
    visible_user_ids: asset.visible_user_ids,
    source_stage_id: asset.source_stage_id,
    source_stage_name: getStageName(store, projectId, asset.source_stage_id),
    source_deliverable_id: asset.source_deliverable_id,
    source_change_request_id: asset.source_change_request_id,
    current_version_number: asset.current_version_number,
    version_count: serializedVersions.length,
    uploaded_by: asset.uploaded_by,
    uploaded_by_name: getUserDisplayName(store, asset.uploaded_by),
    current_version: current,
    versions: serializedVersions,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  };
}

/**
 * Registers a stage deliverable (or updated revision) into the Project Asset
 * Library without duplicating the physical binary blob: both StoredDeliverable
 * and StoredAssetVersion reference the exact same `blob_key` in `store.mediaBlobs`.
 */
export function registerDeliverableWithAsset(params: {
  store: AppStore;
  project: StoredProject;
  stageId: string;
  actor: StoredUser;
  title: string;
  fileName: string;
  fileExtension: string;
  contentType: string;
  buffer: Buffer;
  visibility: AssetVisibility;
  visibleRoles: UserRole[];
  visibleUserIds: string[];
  changelog: string;
  changeRequestId?: string | null;
  targetAssetId?: string | null;
  isFinalHandover?: boolean;
}): {
  deliverable: StoredDeliverable;
  asset: StoredProjectAsset;
  version: StoredAssetVersion;
} {
  const {
    store,
    project,
    stageId,
    actor,
    title,
    fileName,
    fileExtension,
    contentType,
    buffer,
    visibility,
    visibleRoles,
    visibleUserIds,
    changelog,
    changeRequestId = null,
    targetAssetId = null,
    isFinalHandover = false,
  } = params;

  const now = new Date().toISOString();
  const projectAssets = store.projectAssets.get(project.id) ?? [];
  const stageDeliverables = (store.deliverables.get(project.id) ?? []).filter(
    (d) => d.stage_id === stageId
  );

  // If updating an existing asset (e.g. resolving a change request or re-uploading
  // with the same asset target), append a new AssetVersion instead of creating a duplicate card.
  let asset = targetAssetId
    ? projectAssets.find((a) => a.id === targetAssetId)
    : undefined;

  const versionId = crypto.randomUUID();
  let versionNumber = 1;
  let blobKey: string;
  let version: StoredAssetVersion;
  const deliverableId = crypto.randomUUID();

  if (asset) {
    const versions = store.assetVersions.get(asset.id) ?? [];
    versionNumber =
      versions.reduce((max, v) => Math.max(max, v.version_number), 0) + 1;
    for (const v of versions) {
      v.is_current = false;
    }
    blobKey = `asset:${asset.id}:${versionId}`;
    version = {
      id: versionId,
      asset_id: asset.id,
      version_number: versionNumber,
      file_name: fileName,
      file_extension: fileExtension,
      content_type: contentType,
      size_bytes: buffer.length,
      blob_key: blobKey,
      changelog,
      is_current: true,
      uploaded_by: actor.id,
      created_at: now,
    };
    versions.push(version);
    store.assetVersions.set(asset.id, versions);
    asset.current_version_number = versionNumber;
    asset.source_deliverable_id = deliverableId;
    if (changeRequestId) {
      asset.source_change_request_id = changeRequestId;
    }
    if (canManageAssetVisibility(actor)) {
      asset.visibility = visibility;
      asset.visible_roles = visibility === "custom" ? visibleRoles : [];
      asset.visible_user_ids = visibility === "custom" ? visibleUserIds : [];
    }
    asset.updated_at = now;
  } else {
    const assetId = crypto.randomUUID();
    blobKey = `asset:${assetId}:${versionId}`;
    asset = {
      id: assetId,
      project_id: project.id,
      title,
      description: `Sincronizado automáticamente desde la etapa del proyecto.`,
      category: "deliverables",
      visibility,
      visible_roles: visibility === "custom" ? visibleRoles : [],
      visible_user_ids: visibility === "custom" ? visibleUserIds : [],
      source_stage_id: stageId,
      source_deliverable_id: deliverableId,
      source_change_request_id: changeRequestId,
      current_version_number: 1,
      uploaded_by: actor.id,
      created_at: now,
      updated_at: now,
    };
    version = {
      id: versionId,
      asset_id: assetId,
      version_number: 1,
      file_name: fileName,
      file_extension: fileExtension,
      content_type: contentType,
      size_bytes: buffer.length,
      blob_key: blobKey,
      changelog,
      is_current: true,
      uploaded_by: actor.id,
      created_at: now,
    };
    projectAssets.unshift(asset);
    store.projectAssets.set(project.id, projectAssets);
    store.assetVersions.set(assetId, [version]);
  }

  // Single physical blob shared by both Deliverable and AssetVersion.
  store.mediaBlobs.set(blobKey, {
    buffer,
    content_type: contentType,
    file_name: fileName,
  });

  const maxDeliverableVersion = stageDeliverables.reduce(
    (max, d) => Math.max(max, d.version),
    0
  );
  const clientVisible = isAssetVisibleToClient(project, asset);
  const deliverable: StoredDeliverable = {
    id: deliverableId,
    project_id: project.id,
    stage_id: stageId,
    title,
    version: targetAssetId ? versionNumber : maxDeliverableVersion + 1,
    file_name: fileName,
    file_extension: fileExtension,
    content_type: contentType,
    size_bytes: buffer.length,
    blob_key: blobKey,
    asset_id: asset.id,
    asset_version_id: version.id,
    change_request_id: changeRequestId,
    status: "in_review",
    is_client_visible: clientVisible,
    is_final_handover: isFinalHandover,
    published_at: clientVisible ? now : null,
    published_by: clientVisible ? actor.id : null,
    created_by: actor.id,
    created_at: now,
  };

  const allDeliverables = store.deliverables.get(project.id) ?? [];
  allDeliverables.push(deliverable);
  store.deliverables.set(project.id, allDeliverables);

  return { deliverable, asset, version };
}

export async function handleProjectBriefAndAssetSubroutes(params: {
  request: NextRequest;
  method: string;
  subPath: string;
  store: AppStore;
  project: StoredProject;
  user: StoredUser;
  readJsonBody: (req: NextRequest) => Promise<Record<string, unknown>>;
}): Promise<NextResponse | null> {
  const { request, method, subPath, store, project, user, readJsonBody } = params;
  const projectId = project.id;
  const isTeam = user.role !== "CLIENT";

  // =========================================================================
  // BRIEF QUESTION CRUD, MULTIMODAL RESPONSES, REFERENCES & AI REPORT
  // =========================================================================
  if (method === "GET" && subPath === "brief") {
    const items = store.briefItems.get(projectId) ?? [];
    if (user.role === "CLIENT" && !project.brief_sent_at) {
      return NextResponse.json(items.filter((i) => i.item_type === "reference"));
    }
    return NextResponse.json(items);
  }

  if (method === "GET" && subPath === "brief/pending") {
    return NextResponse.json(computeDetailedBriefProgress(store, projectId));
  }

  if (method === "POST" && subPath === "brief/send") {
    if (!isTeam) {
      return jsonError(403, "Solo el estudio puede enviar el brief");
    }
    const now = new Date().toISOString();
    project.brief_sent_at = now;
    if (project.client_id) {
      store.notifications.unshift({
        id: crypto.randomUUID(),
        user_id: project.client_id,
        event_type: "brief.sent",
        project_id: projectId,
        payload: { project_id: projectId, project_title: project.title },
        read_at: null,
        created_at: now,
      });
    }
    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "brief.send",
      entity_type: "project",
      entity_id: projectId,
      metadata_json: { brief_sent_at: now },
    });
    return NextResponse.json({ project_id: projectId, brief_sent_at: now });
  }

  if (method === "POST" && subPath === "brief/questions") {
    if (!isTeam) {
      return jsonError(403, "Solo el estudio puede agregar preguntas");
    }
    const body = await readJsonBody(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return jsonError(422, "La pregunta es obligatoria");
    const category: "branding" | "interior" | "general" =
      body.category === "branding" ||
      body.category === "interior" ||
      body.category === "general"
        ? body.category
        : "general";
    const now = new Date().toISOString();
    const item: StoredBriefItem = {
      id: crypto.randomUUID(),
      project_id: projectId,
      item_type: "question",
      category,
      prompt,
      answer: null,
      note: null,
      file_name: null,
      content_type: null,
      size_bytes: null,
      image_url: null,
      images: [],
      audio_url: null,
      audio_transcription: null,
      transcription: null,
      response_type: null,
      client_confirmed: false,
      status: "pending",
      created_by: user.id,
      created_at: now,
      updated_at: now,
    };
    const items = store.briefItems.get(projectId) ?? [];
    items.push(item);
    store.briefItems.set(projectId, items);
    return NextResponse.json(item, { status: 201 });
  }

  const briefQuestionMatch = subPath.match(/^brief\/questions\/([^/]+)$/);
  if (briefQuestionMatch) {
    if (!isTeam) {
      return jsonError(403, "Solo el estudio puede editar preguntas");
    }
    const itemId = briefQuestionMatch[1];
    const items = store.briefItems.get(projectId) ?? [];
    const idx = items.findIndex(
      (it) => it.id === itemId && it.item_type === "question"
    );
    if (idx === -1) return jsonError(404, "Pregunta no encontrada");

    if (method === "PATCH") {
      const body = await readJsonBody(request);
      if (typeof body.prompt === "string" && body.prompt.trim()) {
        items[idx].prompt = body.prompt.trim();
      }
      if (
        body.category === "branding" ||
        body.category === "interior" ||
        body.category === "general"
      ) {
        items[idx].category = body.category;
      }
      items[idx].updated_at = new Date().toISOString();
      return NextResponse.json(items[idx]);
    }

    if (method === "DELETE") {
      const target = items[idx];
      const force = request.nextUrl.searchParams.get("force") === "true";
      if (isBriefItemAnswered(target) && !force) {
        return jsonError(
          409,
          "Esta pregunta ya tiene respuesta; usa force=true para eliminarla"
        );
      }
      for (const img of target.images) {
        store.mediaBlobs.delete(`brief-img:${img.id}`);
      }
      store.mediaBlobs.delete(`brief-audio:${target.id}`);
      items.splice(idx, 1);
      store.briefItems.set(projectId, items);
      return new NextResponse(null, { status: 204 });
    }
  }

  const briefAutosaveItemMatch = subPath.match(
    /^brief\/items\/([^/]+)(?:\/autosave)?$/
  );
  if (method === "PATCH" && briefAutosaveItemMatch) {
    if (user.role === "CLIENT" && !project.brief_sent_at) {
      return jsonError(409, "El brief todavía no fue enviado al cliente");
    }
    const itemId = briefAutosaveItemMatch[1];
    const items = store.briefItems.get(projectId) ?? [];
    const item = items.find(
      (it) => it.id === itemId && it.item_type === "question"
    );
    if (!item) return jsonError(404, "Pregunta no encontrada");

    const body = await readJsonBody(request);
    if (typeof body.answer === "string") {
      item.answer = body.answer;
    }
    if (typeof body.transcription === "string") {
      item.transcription = body.transcription;
      item.audio_transcription = body.transcription;
    }
    item.status = isBriefItemAnswered(item) ? "answered" : "pending";
    item.updated_at = new Date().toISOString();
    const prog = computeDetailedBriefProgress(store, projectId);
    return NextResponse.json({
      ...item,
      progress: prog.progress,
      answered_questions: prog.answered_questions,
      total_questions: prog.total_questions,
      status: prog.status,
    });
  }

  const briefConfirmMatch = subPath.match(/^brief\/items\/([^/]+)\/confirm$/);
  if (method === "POST" && briefConfirmMatch) {
    if (user.role === "CLIENT" && !project.brief_sent_at) {
      return jsonError(409, "El brief todavía no fue enviado al cliente");
    }
    const itemId = briefConfirmMatch[1];
    const items = store.briefItems.get(projectId) ?? [];
    const item = items.find(
      (it) => it.id === itemId && it.item_type === "question"
    );
    if (!item) return jsonError(404, "Pregunta no encontrada");
    const body = await readJsonBody(request);
    item.client_confirmed = Boolean(body.confirmed);
    item.updated_at = new Date().toISOString();
    return NextResponse.json(item);
  }

  const briefRespFileMatch = subPath.match(
    /^brief\/items\/([^/]+)\/(?:response-file|upload)$/
  );
  if (method === "POST" && briefRespFileMatch) {
    if (user.role === "CLIENT" && !project.brief_sent_at) {
      return jsonError(409, "El brief todavía no fue enviado al cliente");
    }
    const itemId = briefRespFileMatch[1];
    const items = store.briefItems.get(projectId) ?? [];
    const item = items.find(
      (it) => it.id === itemId && it.item_type === "question"
    );
    if (!item) return jsonError(404, "Pregunta no encontrada");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "Archivo requerido");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BRIEF_FILE_BYTES) {
      return jsonError(413, "El archivo excede el límite de 10 MiB");
    }
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();

    if (BRIEF_IMAGE_MIME.has(mime)) {
      if (item.images.length >= 2) {
        return jsonError(409, "Máximo 2 imágenes por pregunta");
      }
      const imageId = crypto.randomUUID();
      store.mediaBlobs.set(`brief-img:${imageId}`, {
        buffer: buf,
        content_type: mime,
        file_name: file.name || "image",
      });
      const url = `/api/v1/projects/${projectId}/brief/items/${item.id}/images/${imageId}/media`;
      item.images.push({
        id: imageId,
        url,
        position: item.images.length,
        content_type: mime,
      });
      item.image_url = item.images[0]?.url ?? null;
      item.status = "answered";
      item.updated_at = new Date().toISOString();
      const prog = computeDetailedBriefProgress(store, projectId);
      return NextResponse.json({ ...item, progress: prog.progress });
    }

    if (BRIEF_AUDIO_MIME.has(mime)) {
      store.mediaBlobs.set(`brief-audio:${item.id}`, {
        buffer: buf,
        content_type: mime,
        file_name: file.name || "voice.webm",
      });
      item.audio_url = `/api/v1/projects/${projectId}/brief/items/${item.id}/media`;
      item.status = "answered";
      item.updated_at = new Date().toISOString();
      const prog = computeDetailedBriefProgress(store, projectId);
      return NextResponse.json({ ...item, progress: prog.progress });
    }

    return jsonError(422, "Tipo de archivo no soportado para respuesta del brief");
  }

  const briefImageMediaMatch = subPath.match(
    /^brief\/items\/([^/]+)\/images\/([^/]+)\/media$/
  );
  if (method === "GET" && briefImageMediaMatch) {
    const [, itemId, imageId] = briefImageMediaMatch;
    const item = (store.briefItems.get(projectId) ?? []).find(
      (it) => it.id === itemId && it.images.some((im) => im.id === imageId)
    );
    const blob = item ? store.mediaBlobs.get(`brief-img:${imageId}`) : undefined;
    if (!blob) return jsonError(404, "Imagen no encontrada");
    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const briefImageDeleteMatch = subPath.match(
    /^brief\/items\/([^/]+)\/images\/([^/]+)$/
  );
  if (method === "DELETE" && briefImageDeleteMatch) {
    const [, itemId, imageId] = briefImageDeleteMatch;
    const item = (store.briefItems.get(projectId) ?? []).find(
      (it) => it.id === itemId
    );
    if (!item) return jsonError(404, "Pregunta no encontrada");
    item.images = item.images.filter((im) => im.id !== imageId);
    item.image_url = item.images[0]?.url ?? null;
    store.mediaBlobs.delete(`brief-img:${imageId}`);
    item.status = isBriefItemAnswered(item) ? "answered" : "pending";
    item.updated_at = new Date().toISOString();
    const prog = computeDetailedBriefProgress(store, projectId);
    return NextResponse.json({ ...item, progress: prog.progress });
  }

  const briefAudioMediaMatch = subPath.match(/^brief\/items\/([^/]+)\/media$/);
  if (method === "GET" && briefAudioMediaMatch) {
    const itemId = briefAudioMediaMatch[1];
    const blob = store.mediaBlobs.get(`brief-audio:${itemId}`);
    if (!blob) return jsonError(404, "Audio no encontrado");
    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const briefAudioDeleteMatch = subPath.match(/^brief\/items\/([^/]+)\/audio$/);
  if (method === "DELETE" && briefAudioDeleteMatch) {
    const itemId = briefAudioDeleteMatch[1];
    const item = (store.briefItems.get(projectId) ?? []).find(
      (it) => it.id === itemId
    );
    if (!item) return jsonError(404, "Pregunta no encontrada");
    item.audio_url = null;
    item.audio_transcription = null;
    item.transcription = null;
    store.mediaBlobs.delete(`brief-audio:${itemId}`);
    item.status = isBriefItemAnswered(item) ? "answered" : "pending";
    item.updated_at = new Date().toISOString();
    const prog = computeDetailedBriefProgress(store, projectId);
    return NextResponse.json({ ...item, progress: prog.progress });
  }

  if (method === "POST" && subPath === "brief/references") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(422, "Archivo requerido");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BRIEF_FILE_BYTES) {
      return jsonError(413, "El archivo excede el límite de 10 MiB");
    }
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!BRIEF_REFERENCE_MIME.has(mime)) {
      return jsonError(422, "Tipo de archivo de referencia no soportado");
    }
    const rawCat = String(form.get("category") ?? "general");
    const category: "branding" | "interior" | "general" =
      rawCat === "branding" || rawCat === "interior" || rawCat === "general"
        ? rawCat
        : "general";
    const noteVal = form.get("note");
    const note = typeof noteVal === "string" && noteVal.trim() ? noteVal.trim().slice(0, 1000) : null;
    const now = new Date().toISOString();
    const item: StoredBriefItem = {
      id: crypto.randomUUID(),
      project_id: projectId,
      item_type: "reference",
      category,
      prompt: null,
      answer: null,
      note,
      file_name: (file.name || "referencia").slice(0, 255),
      content_type: mime,
      size_bytes: buf.length,
      image_url: null,
      images: [],
      audio_url: null,
      audio_transcription: null,
      transcription: null,
      response_type: null,
      client_confirmed: false,
      status: "answered",
      created_by: user.id,
      created_at: now,
      updated_at: now,
    };
    store.mediaBlobs.set(`brief-ref:${item.id}`, {
      buffer: buf,
      content_type: mime,
      file_name: item.file_name || "referencia",
    });
    const items = store.briefItems.get(projectId) ?? [];
    items.push(item);
    store.briefItems.set(projectId, items);
    return NextResponse.json(item, { status: 201 });
  }

  const briefRefFileMatch = subPath.match(/^brief\/items\/([^/]+)\/file$/);
  if (method === "GET" && briefRefFileMatch) {
    const itemId = briefRefFileMatch[1];
    const item = (store.briefItems.get(projectId) ?? []).find(
      (it) => it.id === itemId && it.item_type === "reference"
    );
    const blob = item ? store.mediaBlobs.get(`brief-ref:${itemId}`) : undefined;
    if (!blob) return jsonError(404, "Archivo no encontrado");
    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.content_type,
        "Content-Disposition": `attachment; filename="${sanitizeHeaderFilename(blob.file_name)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // --- Module 1: Brief Review Submission & AI Executive Report ---
  if (method === "POST" && subPath === "brief/submit-review") {
    if (user.role !== "CLIENT") {
      return jsonError(
        403,
        "Solo el cliente del proyecto puede enviar el brief a revisión"
      );
    }
    if (project.status !== "active") {
      return jsonError(409, "El proyecto debe estar activo");
    }
    if (!project.brief_sent_at) {
      return jsonError(409, "El brief aún no fue habilitado por el estudio");
    }

    const now = new Date().toISOString();
    project.brief_submitted_at = now;

    notifyProjectTeamUsers(
      store,
      project,
      "brief.submitted_for_review",
      {
        project_id: projectId,
        project_title: project.title,
        submitted_by: user.id,
        brief_submitted_at: now,
      },
      user.id
    );

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "brief.submit_review",
      entity_type: "project",
      entity_id: projectId,
      metadata_json: { brief_submitted_at: now },
    });

    let reportGenerated = false;
    let reportError: string | null = null;
    if (process.env.GEMINI_API_KEY?.trim()) {
      try {
        const report = await generateAndStoreBriefReport(store, project, user.id);
        reportGenerated = true;
        appendAuditLog(store, {
          actor_user_id: user.id,
          action: "brief.report_generate",
          entity_type: "brief_report",
          entity_id: report.id,
          metadata_json: {
            project_id: projectId,
            trigger: "client_submit_review",
            model_used: report.model_used,
          },
        });
      } catch (err) {
        reportError =
          err instanceof Error
            ? err.message
            : "No se pudo generar el reporte automáticamente";
      }
    }

    return NextResponse.json({
      project_id: projectId,
      brief_submitted_at: now,
      report_generated: reportGenerated,
      report_error: reportError,
    });
  }

  if (method === "GET" && subPath === "brief/report") {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede consultar el reporte");
    }
    const report = store.briefReports.get(projectId);
    if (!report) {
      return jsonError(404, "Todavía no se ha generado un reporte para este brief");
    }
    return NextResponse.json(report);
  }

  if (method === "POST" && subPath === "brief/report/generate") {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede generar el reporte");
    }
    try {
      const report = await generateAndStoreBriefReport(store, project, user.id);
      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "brief.report_generate",
        entity_type: "brief_report",
        entity_id: report.id,
        metadata_json: {
          project_id: projectId,
          trigger: "manual_team",
          model_used: report.model_used,
        },
      });
      return NextResponse.json(report);
    } catch (err) {
      if (err instanceof GeminiReportError) {
        return jsonError(err.statusCode, err.message);
      }
      return jsonError(502, "Error al generar el reporte con IA");
    }
  }

  if (method === "PATCH" && subPath === "brief/report") {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede editar el reporte");
    }
    const body = await readJsonBody(request);
    const content =
      typeof body.content_markdown === "string" ? body.content_markdown : "";
    if (!content.trim() || content.length > 100_000) {
      return jsonError(422, "El contenido Markdown del reporte no es válido");
    }

    const now = new Date().toISOString();
    const existing = store.briefReports.get(projectId);
    const report: StoredBriefReport = existing
      ? {
          ...existing,
          content_markdown: content,
          status: "edited",
          updated_by: user.id,
          updated_at: now,
        }
      : {
          id: crypto.randomUUID(),
          project_id: projectId,
          brief_id: projectId,
          status: "edited",
          content_markdown: content,
          model_used: null,
          generated_by: user.id,
          updated_by: user.id,
          generated_at: null,
          created_at: now,
          updated_at: now,
        };
    store.briefReports.set(projectId, report);

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "brief.report_update",
      entity_type: "brief_report",
      entity_id: report.id,
      metadata_json: {
        project_id: projectId,
        content_length: content.length,
      },
    });
    return NextResponse.json(report);
  }

  if (method === "GET" && subPath === "brief/report/export") {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede exportar el reporte");
    }
    const report = store.briefReports.get(projectId);
    if (!report) {
      return jsonError(404, "Todavía no se ha generado un reporte para este brief");
    }

    const format = (
      request.nextUrl.searchParams.get("format") || "pdf"
    ).toLowerCase();
    const clientUser = project.client_id
      ? store.users.get(project.client_id)
      : undefined;
    const clientLabel = clientUser
      ? clientUser.full_name || clientUser.email
      : null;
    const slug = slugifyFilename(project.title);

    if (format === "md") {
      const header =
        `<!-- Pomme Studio — Reporte Ejecutivo de Brief -->\n` +
        `<!-- Proyecto: ${project.title} | Cliente: ${clientLabel || "Sin asignar"} -->\n\n`;
      return new NextResponse(header + report.content_markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="brief-report-${slug}.md"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (format !== "pdf") {
      return jsonError(422, "Formato de exportación inválido (usa pdf o md)");
    }

    const pdfBytes = await renderBriefReportPdf({
      projectTitle: project.title,
      clientLabel,
      scopeType: project.scope_type,
      generatedAt: report.updated_at || report.generated_at,
      contentMarkdown: report.content_markdown,
    });
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="brief-report-${slug}.pdf"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // =========================================================================
  // PROJECT MEMBERS SUMMARY (for team subtask assignment & granular visibility)
  // =========================================================================
  if (method === "GET" && subPath === "members-summary") {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede consultar los miembros");
    }
    const seen = new Set<string>();
    const list: Array<{
      user_id: string;
      email: string;
      full_name: string | null;
      role: UserRole;
      assigned_role: string;
    }> = [];

    const pushUser = (userId: string | null, assignedRole?: string) => {
      if (!userId || seen.has(userId)) return;
      const u = store.users.get(userId);
      if (!u || !u.is_active) return;
      seen.add(userId);
      list.push({
        user_id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        assigned_role: assignedRole ?? u.role,
      });
    };

    pushUser(project.lead_designer_id, "LEAD_DESIGNER");
    for (const m of store.projectMembers.get(projectId) ?? []) {
      pushUser(m.user_id, m.assigned_role);
    }
    pushUser(project.client_id, "CLIENT");
    return NextResponse.json(list);
  }

  // =========================================================================
  // MODULE 2: CENTRALIZED VERSIONED PROJECT ASSET LIBRARY + GRANULAR VISIBILITY
  // =========================================================================
  if (subPath === "assets") {
    if (method === "GET") {
      const categoryParam = request.nextUrl.searchParams.get("category");
      const stageIdParam = request.nextUrl.searchParams.get("stage_id");
      const searchParam = (
        request.nextUrl.searchParams.get("search") || ""
      )
        .trim()
        .toLowerCase();

      const list = (store.projectAssets.get(projectId) ?? [])
        .filter((asset) => {
          if (!canUserViewAsset(project, user, asset)) {
            return false;
          }
          if (
            categoryParam &&
            VALID_ASSET_CATEGORIES.includes(categoryParam as AssetCategory) &&
            asset.category !== categoryParam
          ) {
            return false;
          }
          if (stageIdParam && asset.source_stage_id !== stageIdParam) {
            return false;
          }
          if (searchParam) {
            const stageName = getStageName(store, projectId, asset.source_stage_id) || "";
            const haystack = `${asset.title} ${asset.description || ""} ${stageName}`.toLowerCase();
            if (!haystack.includes(searchParam)) return false;
          }
          return true;
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((asset) => serializeAssetSummary(store, projectId, asset));

      return NextResponse.json(list);
    }

    if (method === "POST") {
      if (!isTeam) {
        return jsonError(
          403,
          "Solo el equipo del estudio (Collaborator, Lead Designer o Super Admin) puede subir archivos a la Librería de Assets."
        );
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError(422, "Archivo requerido");
      }
      const rawFilename = (file.name || "asset").trim().slice(0, 255);
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length === 0) {
        return jsonError(422, "El archivo está vacío");
      }
      if (buf.length > MAX_ASSET_BYTES) {
        return jsonError(413, "El archivo excede el límite de 25 MiB");
      }

      const resolved = resolveAssetFileType(rawFilename, file.type);
      if (!resolved) {
        return jsonError(
          422,
          "Extensión no permitida. Usa JPG, PNG, WEBP, SVG, GIF, PDF, AI, FIG, ZIP, PSD, SKETCH, INDD, DWG, DXF, DOC(X), PPT(X) o XLS(X)."
        );
      }

      const rawTitle = form.get("title");
      const rawDesc = form.get("description");
      const rawCat = String(form.get("category") ?? "references");
      const rawVis = String(form.get("visibility") ?? "internal_only");
      const rawChangelog = form.get("changelog");

      const title =
        typeof rawTitle === "string" && rawTitle.trim()
          ? rawTitle.trim().slice(0, 200)
          : defaultTitleFromFilename(rawFilename);
      const description =
        typeof rawDesc === "string" && rawDesc.trim()
          ? rawDesc.trim().slice(0, 2000)
          : null;
      const changelog =
        typeof rawChangelog === "string" && rawChangelog.trim()
          ? rawChangelog.trim().slice(0, 500)
          : "Versión inicial";

      const category: AssetCategory = VALID_ASSET_CATEGORIES.includes(
        rawCat as AssetCategory
      )
        ? (rawCat as AssetCategory)
        : "references";

      // Only LEAD_DESIGNER and SUPER_ADMIN can configure granular/client visibility.
      // COLLABORATOR uploads default to internal_only until the Lead shares them.
      let visibility: AssetVisibility = "internal_only";
      let visibleRoles: UserRole[] = [];
      let visibleUserIds: string[] = [];

      if (canManageAssetVisibility(user)) {
        visibility = VALID_ASSET_VISIBILITIES.includes(rawVis as AssetVisibility)
          ? (rawVis as AssetVisibility)
          : "internal_only";
        if (visibility === "custom") {
          visibleRoles = parseVisibleRoles(form.get("visible_roles"));
          visibleUserIds = parseVisibleUserIds(
            store,
            project,
            form.get("visible_user_ids")
          );
          if (visibleRoles.length === 0 && visibleUserIds.length === 0) {
            return jsonError(
              422,
              "En visibilidad personalizada debes seleccionar al menos un rol o usuario."
            );
          }
        }
      }

      const now = new Date().toISOString();
      const assetId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const blobKey = `asset:${assetId}:${versionId}`;

      const asset: StoredProjectAsset = {
        id: assetId,
        project_id: projectId,
        title,
        description,
        category,
        visibility,
        visible_roles: visibleRoles,
        visible_user_ids: visibleUserIds,
        source_stage_id: null,
        source_deliverable_id: null,
        source_change_request_id: null,
        current_version_number: 1,
        uploaded_by: user.id,
        created_at: now,
        updated_at: now,
      };
      const version: StoredAssetVersion = {
        id: versionId,
        asset_id: assetId,
        version_number: 1,
        file_name: rawFilename,
        file_extension: resolved.ext,
        content_type: resolved.mime,
        size_bytes: buf.length,
        blob_key: blobKey,
        changelog,
        is_current: true,
        uploaded_by: user.id,
        created_at: now,
      };

      store.mediaBlobs.set(blobKey, {
        buffer: buf,
        content_type: resolved.mime,
        file_name: rawFilename,
      });
      const existingAssets = store.projectAssets.get(projectId) ?? [];
      existingAssets.unshift(asset);
      store.projectAssets.set(projectId, existingAssets);
      store.assetVersions.set(assetId, [version]);

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "asset.create",
        entity_type: "project_asset",
        entity_id: assetId,
        metadata_json: {
          project_id: projectId,
          title: asset.title,
          category: asset.category,
          visibility: asset.visibility,
          visible_roles: asset.visible_roles,
          visible_user_ids: asset.visible_user_ids,
          file_name: rawFilename,
          version_number: 1,
        },
      });

      return NextResponse.json(serializeAssetDetail(store, projectId, asset), {
        status: 201,
      });
    }
  }

  const assetDetailMatch = subPath.match(/^assets\/([^/]+)$/);
  if (assetDetailMatch) {
    const assetId = assetDetailMatch[1];
    const assets = store.projectAssets.get(projectId) ?? [];
    const assetIdx = assets.findIndex((a) => a.id === assetId);
    if (assetIdx === -1) return jsonError(404, "Asset no encontrado");
    const asset = assets[assetIdx];

    if (!canUserViewAsset(project, user, asset)) {
      return jsonError(404, "Asset no encontrado");
    }

    if (method === "GET") {
      return NextResponse.json(serializeAssetDetail(store, projectId, asset));
    }

    if (method === "PATCH") {
      if (!isTeam) {
        return jsonError(403, "Solo el equipo del estudio puede editar metadatos");
      }
      const body = await readJsonBody(request);
      const changes: Record<string, unknown> = {};
      if (typeof body.title === "string") {
        const cleaned = body.title.trim();
        if (!cleaned) return jsonError(422, "El título no puede estar vacío");
        asset.title = cleaned.slice(0, 200);
        changes.title = asset.title;
      }
      if (body.description !== undefined) {
        asset.description =
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim().slice(0, 2000)
            : null;
        changes.description = asset.description;
      }
      if (
        typeof body.category === "string" &&
        VALID_ASSET_CATEGORIES.includes(body.category as AssetCategory)
      ) {
        asset.category = body.category as AssetCategory;
        changes.category = asset.category;
      }

      const wantsVisibilityChange =
        body.visibility !== undefined ||
        body.visible_roles !== undefined ||
        body.visible_user_ids !== undefined;

      if (wantsVisibilityChange) {
        if (!canManageAssetVisibility(user)) {
          return jsonError(
            403,
            "Solo el Lead Designer o Super Admin puede configurar los permisos de visibilidad."
          );
        }
        const nextVisibility =
          typeof body.visibility === "string" &&
          VALID_ASSET_VISIBILITIES.includes(body.visibility as AssetVisibility)
            ? (body.visibility as AssetVisibility)
            : asset.visibility;

        if (nextVisibility === "custom") {
          const nextRoles =
            body.visible_roles !== undefined
              ? parseVisibleRoles(body.visible_roles)
              : asset.visible_roles;
          const nextUserIds =
            body.visible_user_ids !== undefined
              ? parseVisibleUserIds(store, project, body.visible_user_ids)
              : asset.visible_user_ids;
          if (nextRoles.length === 0 && nextUserIds.length === 0) {
            return jsonError(
              422,
              "En visibilidad personalizada debes seleccionar al menos un rol o usuario."
            );
          }
          asset.visibility = "custom";
          asset.visible_roles = nextRoles;
          asset.visible_user_ids = nextUserIds;
        } else {
          asset.visibility = nextVisibility;
          asset.visible_roles = [];
          asset.visible_user_ids = [];
        }
        changes.visibility = asset.visibility;
        changes.visible_roles = asset.visible_roles;
        changes.visible_user_ids = asset.visible_user_ids;
        syncLinkedDeliverableVisibility(store, project, asset, user.id);
      }

      if (Object.keys(changes).length > 0) {
        asset.updated_at = new Date().toISOString();
        appendAuditLog(store, {
          actor_user_id: user.id,
          action: "asset.update",
          entity_type: "project_asset",
          entity_id: asset.id,
          metadata_json: { project_id: projectId, changes },
        });
      }
      return NextResponse.json(serializeAssetDetail(store, projectId, asset));
    }

    if (method === "DELETE") {
      if (!canManageAssetVisibility(user)) {
        return jsonError(
          403,
          "Solo el Lead Designer o Super Admin puede eliminar assets"
        );
      }
      const versions = store.assetVersions.get(asset.id) ?? [];
      for (const v of versions) {
        store.mediaBlobs.delete(v.blob_key);
      }
      store.assetVersions.delete(asset.id);
      assets.splice(assetIdx, 1);
      store.projectAssets.set(projectId, assets);

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "asset.delete",
        entity_type: "project_asset",
        entity_id: asset.id,
        metadata_json: { project_id: projectId, title: asset.title },
      });
      return new NextResponse(null, { status: 204 });
    }
  }

  const assetVersionsMatch = subPath.match(/^assets\/([^/]+)\/versions$/);
  if (method === "POST" && assetVersionsMatch) {
    if (!isTeam) {
      return jsonError(
        403,
        "Solo el equipo del estudio puede subir nuevas versiones en la Librería de Assets."
      );
    }
    const assetId = assetVersionsMatch[1];
    const asset = (store.projectAssets.get(projectId) ?? []).find(
      (a) => a.id === assetId
    );
    if (!asset || !canUserViewAsset(project, user, asset)) {
      return jsonError(404, "Asset no encontrado");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(422, "Archivo requerido");
    const rawFilename = (file.name || "asset").trim().slice(0, 255);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return jsonError(422, "El archivo está vacío");
    if (buf.length > MAX_ASSET_BYTES) {
      return jsonError(413, "El archivo excede el límite de 25 MiB");
    }

    const resolved = resolveAssetFileType(rawFilename, file.type);
    if (!resolved) {
      return jsonError(422, "Extensión de archivo no permitida");
    }

    const rawChangelog = form.get("changelog");
    const changelog =
      typeof rawChangelog === "string" && rawChangelog.trim()
        ? rawChangelog.trim().slice(0, 500)
        : null;

    const versions = store.assetVersions.get(asset.id) ?? [];
    const maxVersion = versions.reduce(
      (acc, v) => Math.max(acc, v.version_number),
      0
    );
    const nextVersionNumber = maxVersion + 1;

    for (const v of versions) {
      v.is_current = false;
    }

    const now = new Date().toISOString();
    const versionId = crypto.randomUUID();
    const blobKey = `asset:${asset.id}:${versionId}`;
    const newVersion: StoredAssetVersion = {
      id: versionId,
      asset_id: asset.id,
      version_number: nextVersionNumber,
      file_name: rawFilename,
      file_extension: resolved.ext,
      content_type: resolved.mime,
      size_bytes: buf.length,
      blob_key: blobKey,
      changelog,
      is_current: true,
      uploaded_by: user.id,
      created_at: now,
    };

    store.mediaBlobs.set(blobKey, {
      buffer: buf,
      content_type: resolved.mime,
      file_name: rawFilename,
    });
    versions.push(newVersion);
    store.assetVersions.set(asset.id, versions);
    asset.current_version_number = nextVersionNumber;
    asset.updated_at = now;

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "asset.version_create",
      entity_type: "asset_version",
      entity_id: newVersion.id,
      metadata_json: {
        project_id: projectId,
        asset_id: asset.id,
        version_number: nextVersionNumber,
        file_name: rawFilename,
        changelog,
      },
    });

    return NextResponse.json(serializeAssetDetail(store, projectId, asset), {
      status: 201,
    });
  }

  const assetRestoreMatch = subPath.match(
    /^assets\/([^/]+)\/versions\/([^/]+)\/restore$/
  );
  if (method === "POST" && assetRestoreMatch) {
    if (!isTeam) {
      return jsonError(403, "Solo el equipo del estudio puede restaurar versiones");
    }
    const [, assetId, versionId] = assetRestoreMatch;
    const asset = (store.projectAssets.get(projectId) ?? []).find(
      (a) => a.id === assetId
    );
    if (!asset || !canUserViewAsset(project, user, asset)) {
      return jsonError(404, "Asset no encontrado");
    }
    const versions = store.assetVersions.get(asset.id) ?? [];
    const target = versions.find((v) => v.id === versionId);
    if (!target) return jsonError(404, "Versión no encontrada");

    for (const v of versions) {
      v.is_current = v.id === target.id;
    }
    asset.current_version_number = target.version_number;
    asset.updated_at = new Date().toISOString();

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "asset.version_restore",
      entity_type: "asset_version",
      entity_id: target.id,
      metadata_json: {
        project_id: projectId,
        asset_id: asset.id,
        restored_version_number: target.version_number,
      },
    });

    return NextResponse.json(serializeAssetDetail(store, projectId, asset));
  }

  const assetFileMatch = subPath.match(
    /^assets\/([^/]+)\/versions\/([^/]+)\/file$/
  );
  if (method === "GET" && assetFileMatch) {
    const [, assetId, versionId] = assetFileMatch;
    const asset = (store.projectAssets.get(projectId) ?? []).find(
      (a) => a.id === assetId
    );
    if (!asset || !canUserViewAsset(project, user, asset)) {
      return jsonError(404, "Asset no encontrado");
    }
    const version = (store.assetVersions.get(asset.id) ?? []).find(
      (v) => v.id === versionId
    );
    if (!version) return jsonError(404, "Versión no encontrada");
    const blob = store.mediaBlobs.get(version.blob_key);
    if (!blob) return jsonError(404, "Archivo no encontrado");

    const headers: Record<string, string> = {
      "Content-Type": version.content_type,
      "X-Content-Type-Options": "nosniff",
    };
    if (version.file_extension.toLowerCase() === "svg") {
      headers["Content-Security-Policy"] = "sandbox";
    }
    const download = request.nextUrl.searchParams.get("download") === "true";
    if (download) {
      headers["Content-Disposition"] =
        `attachment; filename="${sanitizeHeaderFilename(version.file_name)}"`;
    }
    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers,
    });
  }

  return null;
}
