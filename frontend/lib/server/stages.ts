import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ASSET_IMAGE_EXTENSIONS,
  MAX_ASSET_BYTES,
  VALID_ASSET_VISIBILITIES,
  canManageAssetVisibility,
  canUserViewAsset,
  getUserDisplayName,
  isAssetVisibleToClient,
  notifyProjectClient,
  notifyProjectTeamUsers,
  parseVisibleRoles,
  parseVisibleUserIds,
  registerDeliverableWithAsset,
  resolveAssetFileType,
  sanitizeHeaderFilename,
  syncLinkedDeliverableVisibility,
} from "./extensions";
import {
  appendAuditLog,
  type AppStore,
  type AssetVisibility,
  type StoredChangeRequest,
  type StoredDeliverable,
  type StoredDeliverableComment,
  type StoredProject,
  type StoredStage,
  type StoredStageSubtask,
  type StoredUser,
  type SubtaskStatus,
  type UserRole,
} from "./store";

const VALID_SUBTASK_STATUSES: readonly SubtaskStatus[] = [
  "pending",
  "in_progress",
  "done",
];

function jsonError(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

function isProjectResponsible(
  store: AppStore,
  project: StoredProject,
  user: StoredUser
): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role !== "LEAD_DESIGNER") return false;
  if (project.lead_designer_id === user.id) return true;
  const members = store.projectMembers.get(project.id) ?? [];
  return members.some(
    (m) => m.user_id === user.id && m.assigned_role === "LEAD_DESIGNER"
  );
}

function getStageProgressSummary(
  store: AppStore,
  projectId: string,
  stage: StoredStage
) {
  const subtasks = store.stageSubtasks.get(stage.id) ?? [];
  const subtasksWithProgress = subtasks.filter(
    (st) => st.status === "in_progress" || st.status === "done"
  ).length;
  const deliverablesCount = (store.deliverables.get(projectId) ?? []).filter(
    (d) => d.stage_id === stage.id
  ).length;
  const changeRequestsCount = (store.changeRequests.get(stage.id) ?? []).length;
  const isInProgressOrApproved =
    stage.status === "active" || stage.status === "approved";
  const hasProgress =
    subtasksWithProgress > 0 ||
    deliverablesCount > 0 ||
    changeRequestsCount > 0 ||
    stage.used_change_requests > 0;

  return {
    status: stage.status,
    is_in_progress_or_approved: isInProgressOrApproved,
    has_progress: hasProgress,
    requires_double_confirmation: isInProgressOrApproved || hasProgress,
    deliverables_count: deliverablesCount,
    subtasks_total: subtasks.length,
    subtasks_with_progress: subtasksWithProgress,
    change_requests_count: changeRequestsCount,
  };
}

function canViewDeliverable(
  store: AppStore,
  project: StoredProject,
  user: StoredUser,
  deliverable: StoredDeliverable
): boolean {
  if (user.role === "SUPER_ADMIN" || user.role === "LEAD_DESIGNER") {
    return true;
  }
  const linkedAsset = (store.projectAssets.get(project.id) ?? []).find(
    (a) => a.id === deliverable.asset_id
  );
  if (linkedAsset) {
    return canUserViewAsset(project, user, linkedAsset);
  }
  if (user.role === "CLIENT") {
    return deliverable.is_client_visible;
  }
  return true;
}

function serializeDeliverable(
  store: AppStore,
  project: StoredProject,
  deliverable: StoredDeliverable
) {
  const linkedAsset = (store.projectAssets.get(project.id) ?? []).find(
    (a) => a.id === deliverable.asset_id
  );
  const visibility: AssetVisibility = linkedAsset
    ? linkedAsset.visibility
    : deliverable.is_client_visible
      ? "client_visible"
      : "internal_only";

  return {
    id: deliverable.id,
    project_id: deliverable.project_id,
    stage_id: deliverable.stage_id,
    title: deliverable.title,
    version: deliverable.version,
    file_name: deliverable.file_name,
    file_extension: deliverable.file_extension,
    content_type: deliverable.content_type,
    size_bytes: deliverable.size_bytes,
    is_image: ASSET_IMAGE_EXTENSIONS.has(
      deliverable.file_extension.toLowerCase()
    ),
    asset_id: deliverable.asset_id,
    asset_version_id: deliverable.asset_version_id,
    change_request_id: deliverable.change_request_id,
    status: deliverable.status,
    is_client_visible: linkedAsset
      ? isAssetVisibleToClient(project, linkedAsset)
      : deliverable.is_client_visible,
    visibility,
    visible_roles: linkedAsset?.visible_roles ?? [],
    visible_user_ids: linkedAsset?.visible_user_ids ?? [],
    is_final_handover: deliverable.is_final_handover,
    published_at: deliverable.published_at,
    published_by: deliverable.published_by,
    created_by: deliverable.created_by,
    created_by_name: getUserDisplayName(store, deliverable.created_by),
    created_at: deliverable.created_at,
    file_url: `/api/v1/projects/${project.id}/deliverables/${deliverable.id}/file`,
    asset_file_url:
      deliverable.asset_id && deliverable.asset_version_id
        ? `/api/v1/projects/${project.id}/assets/${deliverable.asset_id}/versions/${deliverable.asset_version_id}/file`
        : null,
  };
}

function serializeSubtask(store: AppStore, subtask: StoredStageSubtask) {
  return {
    ...subtask,
    assigned_to_name: subtask.assigned_to
      ? getUserDisplayName(store, subtask.assigned_to)
      : null,
    created_by_name: getUserDisplayName(store, subtask.created_by),
  };
}

function serializeChangeRequest(
  store: AppStore,
  project: StoredProject,
  user: StoredUser,
  cr: StoredChangeRequest
) {
  const deliverables = store.deliverables.get(project.id) ?? [];
  const rawDeliverable = cr.updated_deliverable_id
    ? deliverables.find((d) => d.id === cr.updated_deliverable_id) ?? null
    : null;
  const visibleDeliverable =
    rawDeliverable && canViewDeliverable(store, project, user, rawDeliverable)
      ? serializeDeliverable(store, project, rawDeliverable)
      : null;

  const assets = store.projectAssets.get(project.id) ?? [];
  const rawAsset = cr.updated_asset_id
    ? assets.find((a) => a.id === cr.updated_asset_id) ?? null
    : null;
  const visibleAsset =
    rawAsset && canUserViewAsset(project, user, rawAsset)
      ? (() => {
          const versions = store.assetVersions.get(rawAsset.id) ?? [];
          const ver =
            versions.find((v) => v.id === cr.updated_asset_version_id) ??
            versions.find((v) => v.is_current) ??
            versions[0] ??
            null;
          return {
            id: rawAsset.id,
            title: rawAsset.title,
            visibility: rawAsset.visibility,
            version_number: ver?.version_number ?? rawAsset.current_version_number,
            file_name: ver?.file_name ?? rawAsset.title,
            file_extension: ver?.file_extension ?? "",
            is_image: ver
              ? ASSET_IMAGE_EXTENSIONS.has(ver.file_extension.toLowerCase())
              : false,
            file_url: ver
              ? `/api/v1/projects/${project.id}/assets/${rawAsset.id}/versions/${ver.id}/file`
              : null,
          };
        })()
      : null;

  return {
    id: cr.id,
    project_id: cr.project_id,
    stage_id: cr.stage_id,
    request_number: cr.request_number,
    status: cr.status,
    client_can_add_items: cr.status === "open",
    items: cr.items.map((item) => ({
      ...item,
      created_by_name: getUserDisplayName(store, item.created_by),
    })),
    requested_by: cr.requested_by,
    requested_by_name: getUserDisplayName(store, cr.requested_by),
    requested_at: cr.requested_at,
    work_started_by: cr.work_started_by,
    work_started_by_name: cr.work_started_by
      ? getUserDisplayName(store, cr.work_started_by)
      : null,
    work_started_at: cr.work_started_at,
    resolved_by: cr.resolved_by,
    resolved_by_name: cr.resolved_by
      ? getUserDisplayName(store, cr.resolved_by)
      : null,
    resolved_at: cr.resolved_at,
    resolution_note: cr.resolution_note,
    updated_deliverable_id: visibleDeliverable?.id ?? null,
    updated_deliverable: visibleDeliverable,
    updated_asset: visibleAsset,
    has_pending_internal_delivery: Boolean(
      (rawDeliverable && !visibleDeliverable) || (rawAsset && !visibleAsset)
    ),
  };
}

function serializeStage(
  store: AppStore,
  project: StoredProject,
  user: StoredUser,
  stage: StoredStage
) {
  const isTeam = user.role !== "CLIENT";
  const subtasks = isTeam
    ? (store.stageSubtasks.get(stage.id) ?? []).map((st) =>
        serializeSubtask(store, st)
      )
    : [];
  const deliverables = (store.deliverables.get(project.id) ?? [])
    .filter(
      (d) =>
        d.stage_id === stage.id && canViewDeliverable(store, project, user, d)
    )
    .sort((a, b) => b.version - a.version)
    .map((d) => serializeDeliverable(store, project, d));

  const changeRequests = [...(store.changeRequests.get(stage.id) ?? [])]
    .sort((a, b) => b.request_number - a.request_number)
    .map((cr) => serializeChangeRequest(store, project, user, cr));

  const available = Math.max(
    0,
    stage.max_change_requests - stage.used_change_requests
  );

  return {
    ...stage,
    available_change_requests: available,
    approved_by_name: stage.approved_by
      ? getUserDisplayName(store, stage.approved_by)
      : null,
    subtasks,
    deliverables,
    change_requests: changeRequests,
  };
}

function isValidTeamAssignee(
  store: AppStore,
  project: StoredProject,
  userId: string
): boolean {
  const target = store.users.get(userId);
  if (!target || !target.is_active || target.role === "CLIENT") {
    return false;
  }
  if (target.role === "SUPER_ADMIN") return true;
  if (project.lead_designer_id === userId) return true;
  return (store.projectMembers.get(project.id) ?? []).some(
    (m) => m.user_id === userId && m.assigned_role !== "CLIENT"
  );
}

function createStageChangeRequestInternal(params: {
  store: AppStore;
  project: StoredProject;
  stage: StoredStage;
  user: StoredUser;
  itemBodies: string[];
}): { cr?: StoredChangeRequest; error?: NextResponse } {
  const { store, project, stage, user, itemBodies } = params;
  if (stage.status !== "active") {
    return {
      error: jsonError(
        409,
        "Solo puedes solicitar cambios en una etapa que se encuentra en curso"
      ),
    };
  }

  const list = store.changeRequests.get(stage.id) ?? [];
  const activeExisting = list.find(
    (cr) => cr.status === "open" || cr.status === "in_progress"
  );
  if (activeExisting) {
    if (activeExisting.status === "open") {
      return {
        error: jsonError(
          409,
          "Ya existe una solicitud de cambios abierta en esta etapa. Agrega más detalles directamente en esa ronda mientras el equipo no confirme el inicio del trabajo."
        ),
      };
    }
    return {
      error: jsonError(
        409,
        "El equipo ya está trabajando en una ronda de cambios activa en esta etapa."
      ),
    };
  }

  if (stage.used_change_requests >= stage.max_change_requests) {
    return {
      error: jsonError(
        409,
        stage.max_change_requests === 0
          ? "Esta etapa no admite solicitudes de cambios (límite configurado: 0)."
          : `Has alcanzado el límite máximo de ${stage.max_change_requests} solicitudes de cambios para esta etapa.`
      ),
    };
  }

  const now = new Date().toISOString();
  stage.used_change_requests += 1;
  project.remaining_rounds = Math.max(0, project.remaining_rounds - 1);

  const cr: StoredChangeRequest = {
    id: crypto.randomUUID(),
    project_id: project.id,
    stage_id: stage.id,
    request_number: stage.used_change_requests,
    status: "open",
    items: itemBodies.map((body) => ({
      id: crypto.randomUUID(),
      body,
      created_by: user.id,
      created_at: now,
    })),
    requested_by: user.id,
    requested_at: now,
    work_started_by: null,
    work_started_at: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    updated_deliverable_id: null,
    updated_asset_id: null,
    updated_asset_version_id: null,
  };
  list.push(cr);
  store.changeRequests.set(stage.id, list);

  for (const d of store.deliverables.get(project.id) ?? []) {
    if (
      d.stage_id === stage.id &&
      d.is_client_visible &&
      d.status === "in_review"
    ) {
      d.status = "changes_requested";
    }
  }

  const available = Math.max(
    0,
    stage.max_change_requests - stage.used_change_requests
  );

  notifyProjectTeamUsers(
    store,
    project,
    "stage.changes_requested",
    {
      project_id: project.id,
      project_title: project.title,
      stage_id: stage.id,
      stage_name: stage.name,
      change_request_id: cr.id,
      request_number: cr.request_number,
      changes_count: cr.items.length,
      available_change_requests: available,
      requested_by_name: getUserDisplayName(store, user.id),
    },
    user.id
  );

  appendAuditLog(store, {
    actor_user_id: user.id,
    action: "stage.change_request_created",
    entity_type: "change_request",
    entity_id: cr.id,
    metadata_json: {
      project_id: project.id,
      stage_id: stage.id,
      request_number: cr.request_number,
      items_count: cr.items.length,
    },
  });

  return { cr };
}

export async function handleProjectStageSubroutes(params: {
  request: NextRequest;
  method: string;
  subPath: string;
  store: AppStore;
  project: StoredProject;
  user: StoredUser;
  readJsonBody: (req: NextRequest) => Promise<Record<string, unknown>>;
}): Promise<NextResponse | null> {
  const { request, method, subPath, store, project, user, readJsonBody } =
    params;
  const projectId = project.id;
  const isTeam = user.role !== "CLIENT";
  const isLeadOrAdmin = canManageAssetVisibility(user);

  // =========================================================================
  // STAGES (OBJECTIVES / DELIVERABLE PHASES)
  // =========================================================================
  if (subPath === "stages") {
    const stages = store.stages.get(projectId) ?? [];

    if (method === "GET") {
      const sorted = [...stages].sort((a, b) => a.order_index - b.order_index);
      return NextResponse.json(
        sorted.map((s) => serializeStage(store, project, user, s))
      );
    }

    if (method === "POST") {
      if (!isLeadOrAdmin) {
        return jsonError(
          403,
          "Solo el Lead Designer o Super Admin pueden crear etapas"
        );
      }
      const body = await readJsonBody(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 255) {
        return jsonError(422, "El nombre de la etapa es obligatorio");
      }

      const rawMaxChanges = body.max_change_requests;
      const parsedMax =
        typeof rawMaxChanges === "number"
          ? rawMaxChanges
          : typeof rawMaxChanges === "string" && rawMaxChanges.trim() !== ""
            ? Number(rawMaxChanges)
            : Number.NaN;
      if (!Number.isInteger(parsedMax) || parsedMax < 0 || parsedMax > 99) {
        return jsonError(
          422,
          "El límite máximo de solicitudes de cambios es obligatorio y debe ser un entero mayor o igual a 0"
        );
      }

      const rawOrder = body.order_index;
      const parsedOrder =
        rawOrder === undefined || rawOrder === null || rawOrder === ""
          ? stages.length
          : Number(rawOrder);
      if (!Number.isInteger(parsedOrder) || parsedOrder < 0) {
        return jsonError(
          422,
          "El orden de la etapa debe ser un entero mayor o igual a 0"
        );
      }

      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 2000)
          : null;

      const hasActiveOrPending = stages.some((s) => s.status !== "approved");
      const now = new Date().toISOString();
      const stage: StoredStage = {
        id: crypto.randomUUID(),
        project_id: projectId,
        name,
        description,
        order_index: parsedOrder,
        status: hasActiveOrPending ? "locked" : "active",
        max_change_requests: parsedMax,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      };
      stages.push(stage);
      store.stages.set(projectId, stages);

      // Optional initial subtasks
      const initialSubtasks: StoredStageSubtask[] = [];
      if (Array.isArray(body.subtasks)) {
        for (const entry of body.subtasks) {
          let title = "";
          let subDesc: string | null = null;
          let assignedTo: string | null = null;
          if (typeof entry === "string") {
            title = entry.trim();
          } else if (entry && typeof entry === "object") {
            const obj = entry as Record<string, unknown>;
            title = typeof obj.title === "string" ? obj.title.trim() : "";
            subDesc =
              typeof obj.description === "string" && obj.description.trim()
                ? obj.description.trim().slice(0, 1000)
                : null;
            if (
              typeof obj.assigned_to === "string" &&
              isValidTeamAssignee(store, project, obj.assigned_to.trim())
            ) {
              assignedTo = obj.assigned_to.trim();
            }
          }
          if (title) {
            initialSubtasks.push({
              id: crypto.randomUUID(),
              stage_id: stage.id,
              title: title.slice(0, 255),
              description: subDesc,
              status: "pending",
              assigned_to: assignedTo,
              created_by: user.id,
              created_at: now,
              updated_at: now,
            });
          }
        }
      }
      store.stageSubtasks.set(stage.id, initialSubtasks);
      store.changeRequests.set(stage.id, []);

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "stage.create",
        entity_type: "stage",
        entity_id: stage.id,
        metadata_json: {
          project_id: projectId,
          name: stage.name,
          max_change_requests: stage.max_change_requests,
          subtasks_count: initialSubtasks.length,
        },
      });

      return NextResponse.json(serializeStage(store, project, user, stage), {
        status: 201,
      });
    }
  }

  // PATCH stages/{stageId}
  const stageDetailMatch = subPath.match(/^stages\/([^/]+)$/);
  if (stageDetailMatch && method === "PATCH") {
    if (!isLeadOrAdmin) {
      return jsonError(
        403,
        "Solo el Lead Designer o Super Admin pueden editar la configuración de la etapa"
      );
    }
    const stageId = stageDetailMatch[1];
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const body = await readJsonBody(request);
    if (typeof body.name === "string" && body.name.trim()) {
      stage.name = body.name.trim().slice(0, 255);
    }
    if (body.description !== undefined) {
      stage.description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 2000)
          : null;
    }
    if (body.max_change_requests !== undefined) {
      const parsedMax = Number(body.max_change_requests);
      if (!Number.isInteger(parsedMax) || parsedMax < 0 || parsedMax > 99) {
        return jsonError(
          422,
          "El límite máximo de solicitudes de cambios debe ser un entero mayor o igual a 0"
        );
      }
      if (parsedMax < stage.used_change_requests) {
        return jsonError(
          409,
          `El límite no puede ser menor a las solicitudes ya consumidas (${stage.used_change_requests})`
        );
      }
      stage.max_change_requests = parsedMax;
    }

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.update",
      entity_type: "stage",
      entity_id: stage.id,
      metadata_json: {
        project_id: projectId,
        max_change_requests: stage.max_change_requests,
      },
    });

    return NextResponse.json(serializeStage(store, project, user, stage));
  }

  // DELETE stages/{stageId} (Project responsible / SUPER_ADMIN only; double confirmation when active or has progress)
  if (stageDetailMatch && method === "DELETE") {
    if (!isProjectResponsible(store, project, user)) {
      return jsonError(
        403,
        "Solo el responsable del proyecto (Lead Designer asignado) o Super Admin pueden eliminar etapas"
      );
    }
    const stageId = stageDetailMatch[1];
    const stages = store.stages.get(projectId) ?? [];
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const progress = getStageProgressSummary(store, projectId, stage);
    if (progress.requires_double_confirmation) {
      const body = await readJsonBody(request);
      const confirmDouble = body.confirm_double === true;
      const confirmStageName =
        typeof body.confirm_stage_name === "string"
          ? body.confirm_stage_name.trim()
          : "";
      if (
        !confirmDouble ||
        confirmStageName.toLowerCase() !== stage.name.trim().toLowerCase()
      ) {
        return NextResponse.json(
          {
            detail:
              "Esta etapa está en curso o tiene avances registrados. Se requiere doble confirmación escribiendo el nombre exacto de la etapa.",
            requires_double_confirmation: true,
            progress_summary: progress,
          },
          { status: 409 }
        );
      }
    }

    // Remove the stage and normalize order indices on remaining stages
    const remaining = stages
      .filter((s) => s.id !== stage.id)
      .sort((a, b) => a.order_index - b.order_index);
    remaining.forEach((s, index) => {
      s.order_index = index;
    });

    // If no active stage remains, automatically unlock the next locked stage whose predecessors are approved
    let promotedStage: StoredStage | null = null;
    const hasActiveStage = remaining.some((s) => s.status === "active");
    if (!hasActiveStage) {
      const firstUnapproved = remaining.find((s) => s.status !== "approved");
      if (firstUnapproved && firstUnapproved.status === "locked") {
        firstUnapproved.status = "active";
        promotedStage = firstUnapproved;
      }
    }
    store.stages.set(projectId, remaining);

    // Clean up stage-owned subtasks, change requests, deliverables, and deliverable comments
    store.stageSubtasks.delete(stage.id);
    store.changeRequests.delete(stage.id);

    const allDeliverables = store.deliverables.get(projectId) ?? [];
    const removedDeliverableIds = new Set<string>();
    const keptDeliverables: StoredDeliverable[] = [];
    for (const deliv of allDeliverables) {
      if (deliv.stage_id === stage.id) {
        removedDeliverableIds.add(deliv.id);
        store.deliverableComments.delete(deliv.id);
      } else {
        keptDeliverables.push(deliv);
      }
    }
    store.deliverables.set(projectId, keptDeliverables);

    // Keep centralized Asset Library files intact while clearing dangling stage/deliverable links
    const assets = store.projectAssets.get(projectId) ?? [];
    for (const asset of assets) {
      if (
        asset.source_stage_id === stage.id ||
        (asset.source_deliverable_id &&
          removedDeliverableIds.has(asset.source_deliverable_id))
      ) {
        asset.source_stage_id = null;
        asset.source_deliverable_id = null;
        asset.source_change_request_id = null;
      }
    }

    notifyProjectTeamUsers(
      store,
      project,
      "stage.deleted",
      {
        project_id: projectId,
        project_title: project.title,
        stage_id: stage.id,
        stage_name: stage.name,
        had_progress: progress.requires_double_confirmation,
        deleted_by_name: getUserDisplayName(store, user.id),
      },
      user.id
    );

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.delete",
      entity_type: "stage",
      entity_id: stage.id,
      metadata_json: {
        project_id: projectId,
        stage_name: stage.name,
        previous_status: stage.status,
        requires_double_confirmation: progress.requires_double_confirmation,
        deliverables_removed: removedDeliverableIds.size,
        subtasks_removed: progress.subtasks_total,
        change_requests_removed: progress.change_requests_count,
        promoted_stage_id: promotedStage?.id ?? null,
      },
    });

    return NextResponse.json({
      deleted_stage_id: stage.id,
      deleted_stage_name: stage.name,
      promoted_stage_id: promotedStage?.id ?? null,
      promoted_stage_name: promotedStage?.name ?? null,
    });
  }

  // =========================================================================
  // SUBTASKS (VISIBLE TO LEAD_DESIGNER, COLLABORATOR & SUPER_ADMIN)
  // =========================================================================
  const stageSubtasksMatch = subPath.match(/^stages\/([^/]+)\/subtasks$/);
  if (stageSubtasksMatch) {
    if (!isTeam) {
      return jsonError(
        403,
        "Las subtareas internas son visibles únicamente para el equipo del estudio"
      );
    }
    const stageId = stageSubtasksMatch[1];
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    if (method === "GET") {
      const subtasks = store.stageSubtasks.get(stageId) ?? [];
      return NextResponse.json(subtasks.map((st) => serializeSubtask(store, st)));
    }

    if (method === "POST") {
      const body = await readJsonBody(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 255) {
        return jsonError(422, "El título de la subtarea es obligatorio");
      }
      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 1000)
          : null;
      let assignedTo: string | null = null;
      if (typeof body.assigned_to === "string" && body.assigned_to.trim()) {
        if (!isValidTeamAssignee(store, project, body.assigned_to.trim())) {
          return jsonError(
            422,
            "La persona asignada debe pertenecer al equipo del proyecto"
          );
        }
        assignedTo = body.assigned_to.trim();
      }
      const now = new Date().toISOString();
      const subtask: StoredStageSubtask = {
        id: crypto.randomUUID(),
        stage_id: stageId,
        title,
        description,
        status: "pending",
        assigned_to: assignedTo,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      };
      const list = store.stageSubtasks.get(stageId) ?? [];
      list.push(subtask);
      store.stageSubtasks.set(stageId, list);

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "stage.subtask_create",
        entity_type: "stage_subtask",
        entity_id: subtask.id,
        metadata_json: {
          project_id: projectId,
          stage_id: stageId,
          title: subtask.title,
        },
      });

      return NextResponse.json(serializeSubtask(store, subtask), {
        status: 201,
      });
    }
  }

  const singleSubtaskMatch = subPath.match(
    /^stages\/([^/]+)\/subtasks\/([^/]+)$/
  );
  if (singleSubtaskMatch) {
    if (!isTeam) {
      return jsonError(
        403,
        "Solo el equipo del estudio puede gestionar subtareas"
      );
    }
    const [, stageId, subtaskId] = singleSubtaskMatch;
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const list = store.stageSubtasks.get(stageId) ?? [];
    const idx = list.findIndex((st) => st.id === subtaskId);
    if (idx === -1) return jsonError(404, "Subtarea no encontrada");

    if (method === "PATCH") {
      const body = await readJsonBody(request);
      const subtask = list[idx];
      if (typeof body.title === "string" && body.title.trim()) {
        subtask.title = body.title.trim().slice(0, 255);
      }
      if (body.description !== undefined) {
        subtask.description =
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim().slice(0, 1000)
            : null;
      }
      if (body.status !== undefined) {
        if (!VALID_SUBTASK_STATUSES.includes(body.status as SubtaskStatus)) {
          return jsonError(422, "Estado de subtarea no válido");
        }
        subtask.status = body.status as SubtaskStatus;
      }
      if (body.assigned_to !== undefined) {
        if (body.assigned_to === null || body.assigned_to === "") {
          subtask.assigned_to = null;
        } else if (
          typeof body.assigned_to === "string" &&
          isValidTeamAssignee(store, project, body.assigned_to.trim())
        ) {
          subtask.assigned_to = body.assigned_to.trim();
        } else {
          return jsonError(
            422,
            "La persona asignada debe pertenecer al equipo del proyecto"
          );
        }
      }
      subtask.updated_at = new Date().toISOString();
      return NextResponse.json(serializeSubtask(store, subtask));
    }

    if (method === "DELETE") {
      list.splice(idx, 1);
      store.stageSubtasks.set(stageId, list);
      return new NextResponse(null, { status: 204 });
    }
  }

  // =========================================================================
  // STAGE DELIVERABLES (AUTO-SYNCED TO ASSET LIBRARY WITHOUT DUPLICATION)
  // =========================================================================
  const stageDeliverablesMatch = subPath.match(
    /^stages\/([^/]+)\/deliverables$/
  );
  if (stageDeliverablesMatch) {
    const stageId = stageDeliverablesMatch[1];
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    if (method === "GET") {
      const deliverables = (store.deliverables.get(projectId) ?? [])
        .filter(
          (d) =>
            d.stage_id === stageId && canViewDeliverable(store, project, user, d)
        )
        .sort((a, b) => b.version - a.version)
        .map((d) => serializeDeliverable(store, project, d));
      return NextResponse.json(deliverables);
    }

    if (method === "POST") {
      if (!isTeam) {
        return jsonError(
          403,
          "Solo el equipo del estudio puede subir entregables"
        );
      }
      if (stage.status === "locked") {
        return jsonError(
          409,
          "No puedes subir entregables en una etapa bloqueada"
        );
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError(422, "Archivo requerido");
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) {
        return jsonError(413, "El archivo excede el límite de 25 MiB");
      }
      const origName = (file.name || "entregable").slice(0, 255);
      const resolved = resolveAssetFileType(origName, file.type);
      if (!resolved) {
        return jsonError(
          422,
          "Formato de archivo no permitido (JPG, PNG, WEBP, SVG, PDF, AI, FIG, ZIP, PSD, DWG, DXF, DOCX, PPTX, XLSX)"
        );
      }

      const titleRaw = form.get("title");
      const title =
        typeof titleRaw === "string" && titleRaw.trim()
          ? titleRaw.trim().slice(0, 255)
          : origName;
      const changelogRaw = form.get("changelog");
      const changelog =
        typeof changelogRaw === "string" && changelogRaw.trim()
          ? changelogRaw.trim().slice(0, 500)
          : `Entregable subido en etapa: ${stage.name}`;
      const isFinalHandover =
        String(form.get("is_final_handover") ?? "").toLowerCase() === "true";
      const targetAssetIdRaw = form.get("target_asset_id");
      const targetAssetId =
        typeof targetAssetIdRaw === "string" && targetAssetIdRaw.trim()
          ? targetAssetIdRaw.trim()
          : null;

      let visibility: AssetVisibility = "internal_only";
      let visibleRoles: UserRole[] = [];
      let visibleUserIds: string[] = [];

      if (isLeadOrAdmin) {
        const rawVis = String(form.get("visibility") ?? "").trim();
        if (VALID_ASSET_VISIBILITIES.includes(rawVis as AssetVisibility)) {
          visibility = rawVis as AssetVisibility;
        }
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
              "Para visibilidad personalizada selecciona al menos un rol o usuario"
            );
          }
        }
      }

      const { deliverable, asset } = registerDeliverableWithAsset({
        store,
        project,
        stageId: stage.id,
        actor: user,
        title,
        fileName: origName,
        fileExtension: resolved.ext,
        contentType: resolved.mime,
        buffer,
        visibility,
        visibleRoles,
        visibleUserIds,
        changelog,
        targetAssetId,
        isFinalHandover: isLeadOrAdmin ? isFinalHandover : false,
      });

      if (deliverable.is_client_visible) {
        notifyProjectClient(store, project, "deliverable.published", {
          project_id: projectId,
          project_title: project.title,
          stage_id: stage.id,
          stage_name: stage.name,
          deliverable_id: deliverable.id,
          deliverable_title: deliverable.title,
        });
      }

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "deliverable.upload_synced",
        entity_type: "deliverable",
        entity_id: deliverable.id,
        metadata_json: {
          project_id: projectId,
          stage_id: stage.id,
          asset_id: asset.id,
          visibility: asset.visibility,
        },
      });

      return NextResponse.json(
        serializeDeliverable(store, project, deliverable),
        { status: 201 }
      );
    }
  }

  // =========================================================================
  // CLIENT REVIEW: APPROVE STAGE
  // =========================================================================
  const stageApproveMatch = subPath.match(/^stages\/([^/]+)\/approve$/);
  if (method === "POST" && stageApproveMatch) {
    if (user.role !== "CLIENT") {
      return jsonError(
        403,
        "Solo el cliente puede aceptar los entregables y aprobar la etapa"
      );
    }
    const stageId = stageApproveMatch[1];
    const stages = store.stages.get(projectId) ?? [];
    const sorted = [...stages].sort((a, b) => a.order_index - b.order_index);
    const stageIndex = sorted.findIndex((s) => s.id === stageId);
    if (stageIndex === -1) return jsonError(404, "Etapa no encontrada");

    const stage = sorted[stageIndex];
    if (stage.status !== "active") {
      return jsonError(
        409,
        "Solo puedes aprobar una etapa que se encuentra en curso"
      );
    }

    const now = new Date().toISOString();
    stage.status = "approved";
    stage.approved_by = user.id;
    stage.approved_at = now;

    // Mark stage deliverables in review as approved
    for (const d of store.deliverables.get(projectId) ?? []) {
      if (d.stage_id === stage.id && d.is_client_visible) {
        d.status = "approved";
      }
    }

    // Unlock next stage if any
    const nextStage = sorted[stageIndex + 1];
    if (nextStage && nextStage.status === "locked") {
      nextStage.status = "active";
    } else if (sorted.every((s) => s.status === "approved")) {
      project.status = "completed";
    }

    notifyProjectTeamUsers(
      store,
      project,
      "stage.approved",
      {
        project_id: projectId,
        project_title: project.title,
        stage_id: stage.id,
        stage_name: stage.name,
        approved_by_name: getUserDisplayName(store, user.id),
      },
      user.id
    );

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.approved",
      entity_type: "stage",
      entity_id: stage.id,
      metadata_json: {
        project_id: projectId,
        stage_name: stage.name,
        unlocked_stage_id: nextStage?.id ?? null,
      },
    });

    return NextResponse.json(serializeStage(store, project, user, stage));
  }

  // =========================================================================
  // CHANGE REQUESTS: CREATE, APPEND (WHILE OPEN), START WORK (LOCK), DELIVER
  // =========================================================================
  const stageChangeRequestsMatch = subPath.match(
    /^stages\/([^/]+)\/change-requests$/
  );
  if (stageChangeRequestsMatch) {
    const stageId = stageChangeRequestsMatch[1];
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    if (method === "GET") {
      const list = [...(store.changeRequests.get(stageId) ?? [])].sort(
        (a, b) => b.request_number - a.request_number
      );
      return NextResponse.json(
        list.map((cr) => serializeChangeRequest(store, project, user, cr))
      );
    }

    if (method === "POST") {
      if (user.role !== "CLIENT") {
        return jsonError(
          403,
          "Solo el cliente puede crear solicitudes de cambios"
        );
      }
      const body = await readJsonBody(request);
      const itemBodies: string[] = [];
      if (Array.isArray(body.items)) {
        for (const item of body.items) {
          if (typeof item === "string" && item.trim()) {
            itemBodies.push(item.trim().slice(0, 2000));
          } else if (
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).body === "string"
          ) {
            const text = String(
              (item as Record<string, unknown>).body
            ).trim();
            if (text) itemBodies.push(text.slice(0, 2000));
          }
        }
      }
      if (
        itemBodies.length === 0 &&
        typeof body.body === "string" &&
        body.body.trim()
      ) {
        itemBodies.push(body.body.trim().slice(0, 2000));
      }
      if (
        itemBodies.length === 0 &&
        typeof body.description === "string" &&
        body.description.trim()
      ) {
        itemBodies.push(body.description.trim().slice(0, 2000));
      }
      if (itemBodies.length === 0) {
        return jsonError(
          422,
          "Describe al menos un cambio solicitado antes de enviar"
        );
      }

      const { cr, error } = createStageChangeRequestInternal({
        store,
        project,
        stage,
        user,
        itemBodies,
      });
      if (error || !cr) {
        return error ?? jsonError(400, "No se pudo crear la solicitud");
      }

      return NextResponse.json(
        serializeChangeRequest(store, project, user, cr),
        { status: 201 }
      );
    }
  }

  // Client appends additional change items while team has NOT started work
  const crAddItemMatch = subPath.match(
    /^stages\/([^/]+)\/change-requests\/([^/]+)\/items$/
  );
  if (method === "POST" && crAddItemMatch) {
    if (user.role !== "CLIENT") {
      return jsonError(
        403,
        "Solo el cliente puede agregar detalles a su solicitud de cambios"
      );
    }
    const [, stageId, crId] = crAddItemMatch;
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const cr = (store.changeRequests.get(stageId) ?? []).find(
      (c) => c.id === crId
    );
    if (!cr) return jsonError(404, "Solicitud de cambios no encontrada");

    if (cr.status === "in_progress") {
      return jsonError(
        409,
        "El equipo ya confirmó el inicio de trabajo en estos cambios; el ingreso de nuevos cambios está bloqueado para esta ronda."
      );
    }
    if (cr.status === "resolved") {
      return jsonError(
        409,
        "Esta ronda de cambios ya fue cerrada con un entregable actualizado."
      );
    }

    const body = await readJsonBody(request);
    const text =
      typeof body.body === "string"
        ? body.body.trim()
        : typeof body.description === "string"
          ? body.description.trim()
          : "";
    if (!text) {
      return jsonError(422, "Describe el cambio adicional que deseas agregar");
    }

    const now = new Date().toISOString();
    cr.items.push({
      id: crypto.randomUUID(),
      body: text.slice(0, 2000),
      created_by: user.id,
      created_at: now,
    });

    notifyProjectTeamUsers(
      store,
      project,
      "stage.changes_updated",
      {
        project_id: projectId,
        project_title: project.title,
        stage_id: stage.id,
        stage_name: stage.name,
        change_request_id: cr.id,
        request_number: cr.request_number,
        items_count: cr.items.length,
        requested_by_name: getUserDisplayName(store, user.id),
      },
      user.id
    );

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.change_request_item_added",
      entity_type: "change_request",
      entity_id: cr.id,
      metadata_json: {
        project_id: projectId,
        stage_id: stage.id,
        items_count: cr.items.length,
      },
    });

    return NextResponse.json(serializeChangeRequest(store, project, user, cr));
  }

  // Team confirms work started -> locks further client additions for this round
  const crStartWorkMatch = subPath.match(
    /^stages\/([^/]+)\/change-requests\/([^/]+)\/start-work$/
  );
  if (method === "POST" && crStartWorkMatch) {
    if (!isTeam) {
      return jsonError(
        403,
        "Solo el equipo del estudio puede confirmar el inicio de trabajo en cambios"
      );
    }
    const [, stageId, crId] = crStartWorkMatch;
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const cr = (store.changeRequests.get(stageId) ?? []).find(
      (c) => c.id === crId
    );
    if (!cr) return jsonError(404, "Solicitud de cambios no encontrada");

    if (cr.status !== "open") {
      return jsonError(
        409,
        cr.status === "in_progress"
          ? "El equipo ya confirmó el inicio de trabajo en esta solicitud"
          : "Esta solicitud de cambios ya fue resuelta"
      );
    }

    const now = new Date().toISOString();
    cr.status = "in_progress";
    cr.work_started_by = user.id;
    cr.work_started_at = now;

    notifyProjectClient(store, project, "stage.changes_work_started", {
      project_id: projectId,
      project_title: project.title,
      stage_id: stage.id,
      stage_name: stage.name,
      change_request_id: cr.id,
      request_number: cr.request_number,
      started_by_name: getUserDisplayName(store, user.id),
    });

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.change_request_work_started",
      entity_type: "change_request",
      entity_id: cr.id,
      metadata_json: {
        project_id: projectId,
        stage_id: stage.id,
        request_number: cr.request_number,
      },
    });

    return NextResponse.json(serializeChangeRequest(store, project, user, cr));
  }

  // Team delivers updated document/deliverable (auto-synced to Asset Library) to resolve change request
  const crDeliverMatch = subPath.match(
    /^stages\/([^/]+)\/change-requests\/([^/]+)\/deliver$/
  );
  if (method === "POST" && crDeliverMatch) {
    if (!isTeam) {
      return jsonError(
        403,
        "Solo el equipo del estudio puede adjuntar el entregable actualizado"
      );
    }
    const [, stageId, crId] = crDeliverMatch;
    const stage = (store.stages.get(projectId) ?? []).find(
      (s) => s.id === stageId
    );
    if (!stage) return jsonError(404, "Etapa no encontrada");

    const cr = (store.changeRequests.get(stageId) ?? []).find(
      (c) => c.id === crId
    );
    if (!cr) return jsonError(404, "Solicitud de cambios no encontrada");

    if (cr.status === "resolved") {
      return jsonError(409, "Esta solicitud de cambios ya fue resuelta");
    }

    const contentTypeHeader = request.headers.get("content-type") ?? "";
    const now = new Date().toISOString();
    let resolutionNote: string | null = null;
    let deliverableTitle = "";

    if (contentTypeHeader.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError(
          422,
          "Adjunta el archivo del entregable actualizado"
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) {
        return jsonError(413, "El archivo excede el límite de 25 MiB");
      }
      const origName = (file.name || "entregable-actualizado").slice(0, 255);
      const resolved = resolveAssetFileType(origName, file.type);
      if (!resolved) {
        return jsonError(422, "Formato de archivo no permitido");
      }

      const rawTitle = form.get("title");
      const title =
        typeof rawTitle === "string" && rawTitle.trim()
          ? rawTitle.trim().slice(0, 255)
          : `${stage.name} — Ajuste #${cr.request_number}`;
      const rawNote = form.get("resolution_note");
      resolutionNote =
        typeof rawNote === "string" && rawNote.trim()
          ? rawNote.trim().slice(0, 2000)
          : `Ajustes de la solicitud #${cr.request_number} aplicados.`;
      const targetAssetIdRaw = form.get("target_asset_id");
      const targetAssetId =
        typeof targetAssetIdRaw === "string" && targetAssetIdRaw.trim()
          ? targetAssetIdRaw.trim()
          : null;

      let visibility: AssetVisibility = isLeadOrAdmin
        ? "client_visible"
        : "internal_only";
      let visibleRoles: UserRole[] = [];
      let visibleUserIds: string[] = [];

      if (isLeadOrAdmin) {
        const rawVis = String(form.get("visibility") ?? "").trim();
        if (VALID_ASSET_VISIBILITIES.includes(rawVis as AssetVisibility)) {
          visibility = rawVis as AssetVisibility;
        }
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
              "Para visibilidad personalizada selecciona al menos un rol o usuario"
            );
          }
        }
      }

      const { deliverable, asset, version } = registerDeliverableWithAsset({
        store,
        project,
        stageId: stage.id,
        actor: user,
        title,
        fileName: origName,
        fileExtension: resolved.ext,
        contentType: resolved.mime,
        buffer,
        visibility,
        visibleRoles,
        visibleUserIds,
        changelog: `Entrega actualizada (Solicitud de cambios #${cr.request_number}): ${resolutionNote}`,
        changeRequestId: cr.id,
        targetAssetId,
      });

      cr.updated_deliverable_id = deliverable.id;
      cr.updated_asset_id = asset.id;
      cr.updated_asset_version_id = version.id;
      deliverableTitle = deliverable.title;
    } else {
      const body = await readJsonBody(request);
      const rawNote = body.resolution_note;
      resolutionNote =
        typeof rawNote === "string" && rawNote.trim()
          ? rawNote.trim().slice(0, 2000)
          : `Ajustes de la solicitud #${cr.request_number} vinculados.`;

      const linkedDelivId =
        typeof body.deliverable_id === "string"
          ? body.deliverable_id.trim()
          : "";
      const linkedAssetId =
        typeof body.asset_id === "string" ? body.asset_id.trim() : "";

      if (linkedDelivId) {
        const found = (store.deliverables.get(projectId) ?? []).find(
          (d) => d.id === linkedDelivId && d.stage_id === stageId
        );
        if (!found) return jsonError(404, "Entregable no encontrado en esta etapa");
        found.change_request_id = cr.id;
        found.status = "in_review";
        cr.updated_deliverable_id = found.id;
        cr.updated_asset_id = found.asset_id;
        cr.updated_asset_version_id = found.asset_version_id;
        deliverableTitle = found.title;
      } else if (linkedAssetId) {
        const asset = (store.projectAssets.get(projectId) ?? []).find(
          (a) => a.id === linkedAssetId
        );
        if (!asset) return jsonError(404, "Asset no encontrado en el proyecto");
        const versions = store.assetVersions.get(asset.id) ?? [];
        const currentVer =
          versions.find((v) => v.is_current) ?? versions[0] ?? null;
        if (!currentVer) return jsonError(404, "El asset no tiene versiones");
        asset.source_stage_id = asset.source_stage_id ?? stage.id;
        asset.source_change_request_id = cr.id;
        cr.updated_asset_id = asset.id;
        cr.updated_asset_version_id = currentVer.id;
        deliverableTitle = asset.title;
      } else {
        return jsonError(
          422,
          "Debes adjuntar un archivo actualizado o vincular un entregable/asset existente"
        );
      }
    }

    if (!cr.work_started_at) {
      cr.work_started_at = now;
      cr.work_started_by = user.id;
    }
    cr.status = "resolved";
    cr.resolved_by = user.id;
    cr.resolved_at = now;
    cr.resolution_note = resolutionNote;

    notifyProjectClient(store, project, "stage.changes_delivered", {
      project_id: projectId,
      project_title: project.title,
      stage_id: stage.id,
      stage_name: stage.name,
      change_request_id: cr.id,
      request_number: cr.request_number,
      deliverable_title: deliverableTitle,
    });

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "stage.change_request_resolved",
      entity_type: "change_request",
      entity_id: cr.id,
      metadata_json: {
        project_id: projectId,
        stage_id: stage.id,
        request_number: cr.request_number,
        updated_deliverable_id: cr.updated_deliverable_id,
        updated_asset_id: cr.updated_asset_id,
      },
    });

    return NextResponse.json(serializeChangeRequest(store, project, user, cr));
  }

  // =========================================================================
  // DELIVERABLE DIRECT ROUTES (VIEWER, FILE, PUBLISH/UNPUBLISH, PINS)
  // =========================================================================
  const deliverableDetailMatch = subPath.match(/^deliverables\/([^/]+)$/);
  if (method === "GET" && deliverableDetailMatch) {
    const deliverableId = deliverableDetailMatch[1];
    const deliverable = (store.deliverables.get(projectId) ?? []).find(
      (d) => d.id === deliverableId
    );
    if (
      !deliverable ||
      !canViewDeliverable(store, project, user, deliverable)
    ) {
      return jsonError(404, "Entregable no encontrado");
    }
    return NextResponse.json(serializeDeliverable(store, project, deliverable));
  }

  const deliverableFileMatch = subPath.match(
    /^deliverables\/([^/]+)\/(file|preview)$/
  );
  if (method === "GET" && deliverableFileMatch) {
    const [, deliverableId, mode] = deliverableFileMatch;
    const deliverable = (store.deliverables.get(projectId) ?? []).find(
      (d) => d.id === deliverableId
    );
    if (
      !deliverable ||
      !canViewDeliverable(store, project, user, deliverable)
    ) {
      return jsonError(404, "Entregable no encontrado");
    }
    if (
      mode === "file" &&
      user.role === "CLIENT" &&
      deliverable.is_final_handover &&
      !project.balance_paid
    ) {
      return jsonError(
        402,
        "El archivo final se habilita al liquidar el saldo pendiente"
      );
    }
    const blob = store.mediaBlobs.get(deliverable.blob_key);
    if (!blob) return jsonError(404, "Archivo del entregable no disponible");

    const forceDownload =
      request.nextUrl.searchParams.get("download") === "true";
    const safeName = sanitizeHeaderFilename(deliverable.file_name);
    const isSafeInlineImage =
      ASSET_IMAGE_EXTENSIONS.has(deliverable.file_extension.toLowerCase()) &&
      deliverable.file_extension.toLowerCase() !== "svg";
    const disposition =
      !forceDownload && isSafeInlineImage
        ? `inline; filename="${safeName}"`
        : `attachment; filename="${safeName}"`;

    return new NextResponse(new Uint8Array(blob.buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.content_type,
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const deliverableActionMatch = subPath.match(
    /^deliverables\/([^/]+)\/(publish|unpublish|final-handover|approve|request-changes)$/
  );
  if (method === "POST" && deliverableActionMatch) {
    const [, deliverableId, action] = deliverableActionMatch;
    const deliverable = (store.deliverables.get(projectId) ?? []).find(
      (d) => d.id === deliverableId
    );
    if (!deliverable) return jsonError(404, "Entregable no encontrado");

    const linkedAsset = (store.projectAssets.get(projectId) ?? []).find(
      (a) => a.id === deliverable.asset_id
    );

    if (action === "publish") {
      if (!isLeadOrAdmin) {
        return jsonError(
          403,
          "Solo el Lead Designer o Super Admin pueden configurar la visibilidad y publicar entregables"
        );
      }
      const body = await readJsonBody(request);
      const rawVis = typeof body.visibility === "string" ? body.visibility : "client_visible";
      const visibility: AssetVisibility = VALID_ASSET_VISIBILITIES.includes(
        rawVis as AssetVisibility
      )
        ? (rawVis as AssetVisibility)
        : "client_visible";
      const visibleRoles =
        visibility === "custom" ? parseVisibleRoles(body.visible_roles) : [];
      const visibleUserIds =
        visibility === "custom"
          ? parseVisibleUserIds(store, project, body.visible_user_ids)
          : [];
      if (
        visibility === "custom" &&
        visibleRoles.length === 0 &&
        visibleUserIds.length === 0
      ) {
        return jsonError(
          422,
          "Selecciona al menos un rol o usuario para visibilidad personalizada"
        );
      }
      if (typeof body.is_final_handover === "boolean") {
        deliverable.is_final_handover = body.is_final_handover;
      }

      const now = new Date().toISOString();
      if (linkedAsset) {
        linkedAsset.visibility = visibility;
        linkedAsset.visible_roles = visibleRoles;
        linkedAsset.visible_user_ids = visibleUserIds;
        linkedAsset.updated_at = now;
        syncLinkedDeliverableVisibility(store, project, linkedAsset, user.id);
      } else {
        deliverable.is_client_visible = visibility !== "internal_only";
        deliverable.published_at = now;
        deliverable.published_by = user.id;
      }

      if (deliverable.is_client_visible) {
        const stage = (store.stages.get(projectId) ?? []).find(
          (s) => s.id === deliverable.stage_id
        );
        notifyProjectClient(store, project, "deliverable.published", {
          project_id: projectId,
          project_title: project.title,
          stage_id: deliverable.stage_id,
          stage_name: stage?.name ?? "Etapa",
          deliverable_id: deliverable.id,
          deliverable_title: deliverable.title,
        });
      }

      appendAuditLog(store, {
        actor_user_id: user.id,
        action: "deliverable.publish",
        entity_type: "deliverable",
        entity_id: deliverable.id,
        metadata_json: {
          project_id: projectId,
          visibility,
          visible_roles: visibleRoles,
          visible_user_ids: visibleUserIds,
        },
      });

      return NextResponse.json(serializeDeliverable(store, project, deliverable));
    }

    if (action === "unpublish") {
      if (!isLeadOrAdmin) {
        return jsonError(
          403,
          "Solo el Lead Designer o Super Admin pueden despublicar entregables"
        );
      }
      if (linkedAsset) {
        linkedAsset.visibility = "internal_only";
        linkedAsset.visible_roles = [];
        linkedAsset.visible_user_ids = [];
        linkedAsset.updated_at = new Date().toISOString();
        syncLinkedDeliverableVisibility(store, project, linkedAsset, user.id);
      } else {
        deliverable.is_client_visible = false;
      }
      return NextResponse.json(serializeDeliverable(store, project, deliverable));
    }

    if (action === "final-handover") {
      if (!isLeadOrAdmin) {
        return jsonError(
          403,
          "Solo el Lead Designer o Super Admin pueden marcar entrega final"
        );
      }
      const body = await readJsonBody(request);
      deliverable.is_final_handover =
        typeof body.is_final_handover === "boolean"
          ? body.is_final_handover
          : !deliverable.is_final_handover;
      return NextResponse.json(serializeDeliverable(store, project, deliverable));
    }

    if (action === "approve") {
      if (user.role !== "CLIENT") {
        return jsonError(403, "Solo el cliente puede aprobar el entregable");
      }
      if (!canViewDeliverable(store, project, user, deliverable)) {
        return jsonError(404, "Entregable no encontrado");
      }
      deliverable.status = "approved";
      const stage = (store.stages.get(projectId) ?? []).find(
        (s) => s.id === deliverable.stage_id
      );
      notifyProjectTeamUsers(
        store,
        project,
        "deliverable.approved",
        {
          project_id: projectId,
          project_title: project.title,
          stage_id: deliverable.stage_id,
          stage_name: stage?.name ?? "Etapa",
          deliverable_id: deliverable.id,
          deliverable_title: deliverable.title,
        },
        user.id
      );
      return NextResponse.json(serializeDeliverable(store, project, deliverable));
    }

    if (action === "request-changes") {
      if (user.role !== "CLIENT") {
        return jsonError(403, "Solo el cliente puede solicitar cambios");
      }
      if (!canViewDeliverable(store, project, user, deliverable)) {
        return jsonError(404, "Entregable no encontrado");
      }
      const stage = (store.stages.get(projectId) ?? []).find(
        (s) => s.id === deliverable.stage_id
      );
      if (!stage) return jsonError(404, "Etapa no encontrada");

      const comments = store.deliverableComments.get(deliverable.id) ?? [];
      const summaryItems =
        comments.length > 0
          ? comments.slice(-5).map((c) => `Pin (${Math.round(c.x_pct)}%, ${Math.round(c.y_pct)}%): ${c.body}`)
          : [`Cambios solicitados sobre ${deliverable.title} (V${deliverable.version})`];

      const { error } = createStageChangeRequestInternal({
        store,
        project,
        stage,
        user,
        itemBodies: summaryItems,
      });
      if (error) return error;
      deliverable.status = "changes_requested";
      return NextResponse.json(serializeDeliverable(store, project, deliverable));
    }
  }

  // Deliverable pin comments
  const deliverableCommentsMatch = subPath.match(
    /^deliverables\/([^/]+)\/comments$/
  );
  if (deliverableCommentsMatch) {
    const deliverableId = deliverableCommentsMatch[1];
    const deliverable = (store.deliverables.get(projectId) ?? []).find(
      (d) => d.id === deliverableId
    );
    if (
      !deliverable ||
      !canViewDeliverable(store, project, user, deliverable)
    ) {
      return jsonError(404, "Entregable no encontrado");
    }

    if (method === "GET") {
      return NextResponse.json(
        store.deliverableComments.get(deliverableId) ?? []
      );
    }

    if (method === "POST") {
      if (user.role !== "CLIENT") {
        return jsonError(403, "Solo el cliente puede colocar pines de revisión");
      }
      const body = await readJsonBody(request);
      const commentBody =
        typeof body.body === "string" ? body.body.trim() : "";
      if (!commentBody) {
        return jsonError(422, "El comentario del pin es obligatorio");
      }
      const xPct = Number(body.x_pct);
      const yPct = Number(body.y_pct);
      if (
        Number.isNaN(xPct) ||
        Number.isNaN(yPct) ||
        xPct < 0 ||
        xPct > 100 ||
        yPct < 0 ||
        yPct > 100
      ) {
        return jsonError(422, "Coordenadas del pin inválidas");
      }
      const stage = (store.stages.get(projectId) ?? []).find(
        (s) => s.id === deliverable.stage_id
      );
      const comment: StoredDeliverableComment = {
        id: crypto.randomUUID(),
        deliverable_id: deliverableId,
        created_by: user.id,
        x_pct: xPct,
        y_pct: yPct,
        page_or_frame: 1,
        body: commentBody.slice(0, 2000),
        round_number: (stage?.used_change_requests ?? 0) + 1,
        consumes_round: false,
        created_at: new Date().toISOString(),
      };
      const list = store.deliverableComments.get(deliverableId) ?? [];
      list.push(comment);
      store.deliverableComments.set(deliverableId, list);
      return NextResponse.json(comment, { status: 201 });
    }
  }

  return null;
}
