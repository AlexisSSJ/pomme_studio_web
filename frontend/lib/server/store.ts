import crypto from "crypto";
import { hashPassword, verifyPassword } from "./auth";

export type UserRole = "SUPER_ADMIN" | "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT";
export type ScopeType = "branding" | "interior" | "integral";

export const VALID_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "LEAD_DESIGNER",
  "COLLABORATOR",
  "CLIENT",
];

export interface StoredUser {
  id: string;
  email: string;
  hashed_password: string;
  full_name: string | null;
  specialty: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRead {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoredPasswordResetRequest {
  id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface StoredPricingConfig {
  id: string;
  price_per_m2_base: string;
  branding_base_price: string;
  integral_multiplier: string;
  default_change_rounds: number;
  updated_by: string | null;
  updated_at: string;
}

export interface StoredAuditLog {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface StoredLead {
  id: string;
  contact_name: string;
  email: string;
  service_type: ScopeType;
  space_type: string | null;
  area_m2: string | null;
  budget_range: string | null;
  status: string;
  created_at: string;
}

export interface StoredProject {
  id: string;
  title: string;
  lead_id: string | null;
  client_id: string | null;
  lead_designer_id: string | null;
  scope_type: ScopeType | null;
  status: "draft" | "active" | "completed";
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
  brief_sent_at: string | null;
  brief_submitted_at: string | null;
  created_at: string;
}

export interface StoredProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  assigned_role: "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT";
  created_at: string;
}

export interface StoredNotification {
  id: string;
  user_id: string;
  event_type: string;
  project_id: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface StoredBriefItem {
  id: string;
  project_id: string;
  item_type: "question" | "reference";
  category: "branding" | "interior" | "general";
  prompt: string | null;
  answer: string | null;
  note: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  image_url: string | null;
  images: Array<{
    id: string;
    url: string;
    position: number;
    content_type: string | null;
  }>;
  audio_url: string | null;
  audio_transcription: string | null;
  transcription: string | null;
  response_type: string | null;
  client_confirmed: boolean;
  status: "pending" | "answered";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type SubtaskStatus = "pending" | "in_progress" | "done";

export interface StoredStageSubtask {
  id: string;
  stage_id: string;
  title: string;
  description: string | null;
  status: SubtaskStatus;
  assigned_to: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StoredStage {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  order_index: number;
  status: "locked" | "active" | "approved";
  max_change_requests: number;
  used_change_requests: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface StoredDeliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  file_name: string;
  file_extension: string;
  content_type: string;
  size_bytes: number;
  /** Shared blob key pointing to the same physical file in mediaBlobs as the linked AssetVersion. */
  blob_key: string;
  asset_id: string;
  asset_version_id: string;
  change_request_id: string | null;
  status: "in_review" | "changes_requested" | "approved";
  is_client_visible: boolean;
  is_final_handover: boolean;
  published_at: string | null;
  published_by: string | null;
  created_by: string;
  created_at: string;
}

export interface StoredDeliverableComment {
  id: string;
  deliverable_id: string;
  created_by: string;
  x_pct: number;
  y_pct: number;
  page_or_frame: number;
  body: string;
  round_number: number;
  consumes_round: boolean;
  created_at: string;
}

export interface StoredChangeRequestItem {
  id: string;
  body: string;
  created_by: string;
  created_at: string;
}

export type ChangeRequestStatus = "open" | "in_progress" | "resolved";

export interface StoredChangeRequest {
  id: string;
  project_id: string;
  stage_id: string;
  request_number: number;
  status: ChangeRequestStatus;
  items: StoredChangeRequestItem[];
  requested_by: string;
  requested_at: string;
  work_started_by: string | null;
  work_started_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  updated_deliverable_id: string | null;
  updated_asset_id: string | null;
  updated_asset_version_id: string | null;
}

export interface StoredSpecification {
  id: string;
  project_id: string;
  category: "furniture" | "lighting" | "finishes" | "equipment" | "other";
  name: string;
  code: string | null;
  manufacturer: string | null;
  finish: string | null;
  dimensions: string | null;
  supplier: string | null;
  reference_url: string | null;
  location: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMeeting {
  id: string;
  lead_id: string | null;
  project_id: string | null;
  google_event_id: string | null;
  meet_link: string | null;
  start_time: string;
  end_time: string;
  meeting_type: string;
  status: string;
  created_at: string;
}

export type BriefReportStatus = "draft" | "generated" | "edited";

export interface StoredBriefReport {
  id: string;
  project_id: string;
  brief_id: string;
  status: BriefReportStatus;
  content_markdown: string;
  model_used: string | null;
  generated_by: string | null;
  updated_by: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AssetCategory =
  | "deliverables"
  | "plans"
  | "presentations"
  | "contracts"
  | "references"
  | "typography_palette"
  | "client_resources";

export type AssetVisibility = "internal_only" | "client_visible" | "custom";

export interface StoredProjectAsset {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  category: AssetCategory;
  visibility: AssetVisibility;
  visible_roles: UserRole[];
  visible_user_ids: string[];
  source_stage_id: string | null;
  source_deliverable_id: string | null;
  source_change_request_id: string | null;
  current_version_number: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface StoredAssetVersion {
  id: string;
  asset_id: string;
  version_number: number;
  file_name: string;
  file_extension: string;
  content_type: string;
  size_bytes: number;
  blob_key: string;
  changelog: string | null;
  is_current: boolean;
  uploaded_by: string;
  created_at: string;
}

export interface StoredMediaBlob {
  buffer: Buffer;
  content_type: string;
  file_name: string;
}

export interface AppStore {
  users: Map<string, StoredUser>;
  passwordResetRequests: Map<string, StoredPasswordResetRequest>;
  pricingConfig: StoredPricingConfig;
  auditLogs: StoredAuditLog[];
  leads: Map<string, StoredLead>;
  projects: Map<string, StoredProject>;
  projectMembers: Map<string, StoredProjectMember[]>;
  notifications: StoredNotification[];
  briefItems: Map<string, StoredBriefItem[]>;
  briefReports: Map<string, StoredBriefReport>;
  projectAssets: Map<string, StoredProjectAsset[]>;
  assetVersions: Map<string, StoredAssetVersion[]>;
  mediaBlobs: Map<string, StoredMediaBlob>;
  stages: Map<string, StoredStage[]>;
  stageSubtasks: Map<string, StoredStageSubtask[]>;
  deliverables: Map<string, StoredDeliverable[]>;
  deliverableComments: Map<string, StoredDeliverableComment[]>;
  changeRequests: Map<string, StoredChangeRequest[]>;
  specifications: Map<string, StoredSpecification[]>;
  meetings: StoredMeeting[];
  envAdminPasswordHashCache: { email: string; rawDigest: string; hash: string } | null;
}

const globalForStore = globalThis as unknown as {
  __pommeStore?: AppStore;
};

function createInitialStore(): AppStore {
  const now = new Date().toISOString();
  return {
    users: new Map(),
    passwordResetRequests: new Map(),
    pricingConfig: {
      id: crypto.randomUUID(),
      price_per_m2_base: "150.00",
      branding_base_price: "5000.00",
      integral_multiplier: "1.00",
      default_change_rounds: 2,
      updated_by: null,
      updated_at: now,
    },
    auditLogs: [],
    leads: new Map(),
    projects: new Map(),
    projectMembers: new Map(),
    notifications: [],
    briefItems: new Map(),
    briefReports: new Map(),
    projectAssets: new Map(),
    assetVersions: new Map(),
    mediaBlobs: new Map(),
    stages: new Map(),
    stageSubtasks: new Map(),
    deliverables: new Map(),
    deliverableComments: new Map(),
    changeRequests: new Map(),
    specifications: new Map(),
    meetings: [],
    envAdminPasswordHashCache: null,
  };
}

export function getStore(): AppStore {
  if (!globalForStore.__pommeStore) {
    globalForStore.__pommeStore = createInitialStore();
  }
  // Ensure new maps exist across hot reloads in dev.
  const store = globalForStore.__pommeStore;
  if (!store.stageSubtasks) store.stageSubtasks = new Map();
  if (!store.deliverables) store.deliverables = new Map();
  if (!store.deliverableComments) store.deliverableComments = new Map();
  if (!store.changeRequests) store.changeRequests = new Map();
  syncEnvAdmin(store);
  return store;
}

/**
 * If ADMIN_EMAIL and ADMIN_PASSWORD are configured in server environment
 * variables, keep a matching SUPER_ADMIN account synced so configured secrets
 * always override any claimed fallback hash.
 */
function syncEnvAdmin(store: AppStore): void {
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envEmail || !envPassword) {
    return;
  }

  const rawDigest = crypto
    .createHash("sha256")
    .update(`${envEmail}\0${envPassword}`)
    .digest("hex");

  let hashedPassword: string;
  if (
    store.envAdminPasswordHashCache &&
    store.envAdminPasswordHashCache.email === envEmail &&
    store.envAdminPasswordHashCache.rawDigest === rawDigest
  ) {
    hashedPassword = store.envAdminPasswordHashCache.hash;
  } else {
    hashedPassword = hashPassword(envPassword);
    store.envAdminPasswordHashCache = {
      email: envEmail,
      rawDigest,
      hash: hashedPassword,
    };
  }

  const existing = findUserByEmail(store, envEmail);
  const now = new Date().toISOString();
  if (existing) {
    if (!verifyPassword(envPassword, existing.hashed_password)) {
      existing.hashed_password = hashedPassword;
      existing.updated_at = now;
    }
    existing.role = "SUPER_ADMIN";
    existing.is_active = true;
    existing.must_change_password = false;
    return;
  }

  const id = crypto.randomUUID();
  store.users.set(id, {
    id,
    email: envEmail,
    hashed_password: hashedPassword,
    full_name: "Administrador",
    specialty: null,
    role: "SUPER_ADMIN",
    is_active: true,
    must_change_password: false,
    created_at: now,
    updated_at: now,
  });
}

export function toUserRead(user: StoredUser): UserRead {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    specialty: user.specialty,
    role: user.role,
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function findUserByEmail(store: AppStore, email: string): StoredUser | null {
  const target = email.trim().toLowerCase();
  for (const user of store.users.values()) {
    if (user.email.trim().toLowerCase() === target) {
      return user;
    }
  }
  return null;
}

export function isEnvAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_EMAIL?.trim() && process.env.ADMIN_PASSWORD);
}

export function needsAdminBootstrap(store: AppStore): boolean {
  if (isEnvAdminConfigured()) {
    return false;
  }
  for (const user of store.users.values()) {
    if (user.role === "SUPER_ADMIN") {
      return false;
    }
  }
  return true;
}

export function appendAuditLog(
  store: AppStore,
  entry: {
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata_json?: Record<string, unknown> | null;
  }
): StoredAuditLog {
  const log: StoredAuditLog = {
    id: crypto.randomUUID(),
    actor_user_id: entry.actor_user_id,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    metadata_json: entry.metadata_json ?? null,
    created_at: new Date().toISOString(),
  };
  store.auditLogs.unshift(log);
  return log;
}

export function seedProjectDefaults(
  store: AppStore,
  project: StoredProject,
  createdBy: string
): void {
  const now = new Date().toISOString();
  const defaultStages: Array<{
    name: string;
    description: string;
    maxChanges: number;
    subtasks: string[];
  }> = [
    {
      name: "Exploración creativa y dirección conceptual",
      description:
        "Aterrizaje estratégico del brief, territorios de marca/espacio y narrativa rectora.",
      maxChanges: 2,
      subtasks: [
        "Aterrizar respuestas del brief y hallazgos clave",
        "Definir propuesta de dirección creativa y copy rector",
      ],
    },
    {
      name: "Anteproyecto de diseño",
      description:
        "Desarrollo del sistema visual, distribución espacial y paleta material.",
      maxChanges: 2,
      subtasks: [
        "Desarrollar sistema de identidad y aplicaciones clave",
        "Integrar planos conceptuales y propuesta de atmósferas",
      ],
    },
    {
      name: "Documentación ejecutiva y FF&E",
      description:
        "Cierre de manuales, planos de diseño y catálogo maestro de especificaciones FF&E.",
      maxChanges: 1,
      subtasks: [
        "Compilar catálogo maestro FF&E y fichas técnicas",
        "Preparar paquete de documentación ejecutiva final",
      ],
    },
  ];

  const createdStages: StoredStage[] = defaultStages.map((spec, index) => {
    const stageId = crypto.randomUUID();
    store.stageSubtasks.set(
      stageId,
      spec.subtasks.map((title) => ({
        id: crypto.randomUUID(),
        stage_id: stageId,
        title,
        description: null,
        status: "pending",
        assigned_to: null,
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      }))
    );
    store.changeRequests.set(stageId, []);
    return {
      id: stageId,
      project_id: project.id,
      name: spec.name,
      description: spec.description,
      order_index: index,
      status: index === 0 ? "active" : "locked",
      max_change_requests: spec.maxChanges,
      used_change_requests: 0,
      approved_by: null,
      approved_at: null,
      created_at: now,
    };
  });

  store.stages.set(project.id, createdStages);
  store.deliverables.set(project.id, []);

  const briefQuestions: Array<{
    category: "branding" | "interior" | "general";
    prompt: string;
  }> = [];

  if (project.scope_type === "branding" || project.scope_type === "integral") {
    briefQuestions.push(
      {
        category: "branding",
        prompt: "¿Cuál es la esencia de la marca y qué valores debe comunicar?",
      },
      {
        category: "branding",
        prompt: "¿Qué referentes visuales o editoriales representan el tono deseado?",
      }
    );
  }
  if (project.scope_type === "interior" || project.scope_type === "integral") {
    briefQuestions.push(
      {
        category: "interior",
        prompt: "¿Qué atmósferas, materiales y paleta táctil imaginas para el espacio?",
      },
      {
        category: "interior",
        prompt: "¿Qué requerimientos funcionales y de mobiliario (FF&E) son prioritarios?",
      }
    );
  }
  if (briefQuestions.length === 0) {
    briefQuestions.push({
      category: "general",
      prompt: "¿Cuáles son los objetivos principales del proyecto y sus entregables clave?",
    });
  }

  store.briefItems.set(
    project.id,
    briefQuestions.map((q) => ({
      id: crypto.randomUUID(),
      project_id: project.id,
      item_type: "question",
      category: q.category,
      prompt: q.prompt,
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
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    }))
  );

  store.specifications.set(project.id, []);
  store.projectAssets.set(project.id, []);
}
