import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createAccessToken,
  generateTemporaryPassword,
  hashPassword,
  verifyAccessToken,
  verifyPassword,
} from "@/lib/server/auth";
import {
  DEV_ACCOUNTS,
  isDevModeEnabled,
  isDevSandboxSeeded,
  seedDevSandbox,
} from "@/lib/server/devSeed";
import {
  computeDetailedBriefProgress,
  handleProjectBriefAndAssetSubroutes,
} from "@/lib/server/extensions";
import { handleProjectStageSubroutes } from "@/lib/server/stages";
import {
  VALID_ROLES,
  appendAuditLog,
  findUserByEmail,
  getStore,
  needsAdminBootstrap,
  seedProjectDefaults,
  toUserRead,
  type AppStore,
  type ScopeType,
  type StoredLead,
  type StoredProject,
  type StoredSpecification,
  type StoredUser,
  type UserRole,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PASSWORD_RESET_ACK =
  "Si la cuenta existe, tu solicitud fue enviada al estudio.";

function jsonError(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function getAuthenticatedUser(
  request: NextRequest,
  store: AppStore,
  options: { allowPasswordChange?: boolean } = {}
): { user: StoredUser } | { response: NextResponse } {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { response: jsonError(401, "Not authenticated") };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { response: jsonError(401, "Not authenticated") };
  }
  const claims = verifyAccessToken(token);
  if (!claims) {
    return { response: jsonError(401, "Could not validate credentials") };
  }
  const user = store.users.get(claims.sub);
  if (!user) {
    return { response: jsonError(401, "Could not validate credentials") };
  }
  if (!user.is_active) {
    return { response: jsonError(403, "Inactive user") };
  }
  if (user.must_change_password && !options.allowPasswordChange) {
    return {
      response: jsonError(403, "Password change required before continuing"),
    };
  }
  return { user };
}

function requireRoles(
  request: NextRequest,
  store: AppStore,
  allowed: readonly UserRole[]
): { user: StoredUser } | { response: NextResponse } {
  const auth = getAuthenticatedUser(request, store);
  if ("response" in auth) return auth;
  if (!allowed.includes(auth.user.role)) {
    return { response: jsonError(403, "Insufficient permissions") };
  }
  return auth;
}

function canAccessProject(
  store: AppStore,
  user: StoredUser,
  project: StoredProject
): boolean {
  if (user.role === "SUPER_ADMIN" || user.role === "LEAD_DESIGNER") {
    return true;
  }
  if (user.role === "CLIENT") {
    return project.client_id === user.id;
  }
  const members = store.projectMembers.get(project.id) ?? [];
  return (
    project.lead_designer_id === user.id ||
    members.some((m) => m.user_id === user.id)
  );
}

function computeQuote(store: AppStore, lead: StoredLead) {
  const pricing = store.pricingConfig;
  const pricePerM2 = Number(pricing.price_per_m2_base);
  const brandingBase = Number(pricing.branding_base_price);
  const multiplier = Number(pricing.integral_multiplier);
  const area = lead.area_m2 ? Number(lead.area_m2) : 0;

  const lines: Array<{ concept: string; amount: string }> = [];
  let subtotal = 0;

  if (lead.service_type === "branding" || lead.service_type === "integral") {
    lines.push({
      concept: "Branding y dirección creativa",
      amount: brandingBase.toFixed(2),
    });
    subtotal += brandingBase;
  }
  if (lead.service_type === "interior" || lead.service_type === "integral") {
    const interiorAmount = Math.max(0, area) * pricePerM2;
    lines.push({
      concept: `Diseño interior y documentación (${area} m²)`,
      amount: interiorAmount.toFixed(2),
    });
    subtotal += interiorAmount;
  }

  const effectiveMultiplier = lead.service_type === "integral" ? multiplier : 1;
  const total = subtotal * effectiveMultiplier;

  return {
    service_type: lead.service_type,
    area_m2: lead.area_m2,
    lines,
    multiplier: effectiveMultiplier.toFixed(2),
    total: total.toFixed(2),
    change_rounds: pricing.default_change_rounds,
  };
}

async function handleRequest(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  const segments = Array.isArray(context.params?.path) ? context.params.path : [];
  const route = `/${segments.join("/")}`;
  const method = request.method.toUpperCase();
  const store = getStore();

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/health") {
    return NextResponse.json({ status: "ok" });
  }

  // -------------------------------------------------------------------------
  // Auth & One-Time Admin Bootstrap
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/auth/bootstrap-status") {
    return NextResponse.json({
      needs_setup: needsAdminBootstrap(store),
    });
  }

  if (method === "GET" && route === "/auth/dev-status") {
    const enabled = isDevModeEnabled();
    return NextResponse.json({
      enabled,
      seeded: enabled ? isDevSandboxSeeded(store) : false,
      accounts: enabled ? DEV_ACCOUNTS : [],
    });
  }

  if (method === "POST" && route === "/auth/dev-seed") {
    if (!isDevModeEnabled()) {
      return jsonError(404, "Endpoint not found");
    }
    const body = await readJsonBody(request);
    const { projectsCount } = seedDevSandbox(store, {
      reset: Boolean(body.reset),
    });
    return NextResponse.json({
      seeded: true,
      projects_count: projectsCount,
      users_count: store.users.size,
    });
  }

  if (method === "POST" && route === "/auth/dev-login") {
    if (!isDevModeEnabled()) {
      return jsonError(404, "Endpoint not found");
    }
    const body = await readJsonBody(request);
    const role = typeof body.role === "string" ? (body.role as UserRole) : null;
    if (!role || !VALID_ROLES.includes(role)) {
      return jsonError(422, "Rol inválido para acceso dev");
    }

    const { users } = seedDevSandbox(store);
    const targetUser = users[role];
    const access_token = createAccessToken(targetUser.id);

    appendAuditLog(store, {
      actor_user_id: targetUser.id,
      action: "dev.quick_login",
      entity_type: "user",
      entity_id: targetUser.id,
      metadata_json: { role: targetUser.role, email: targetUser.email },
    });

    return NextResponse.json({
      access_token,
      token_type: "bearer",
      must_change_password: false,
      user: toUserRead(targetUser),
    });
  }

  if (method === "POST" && route === "/auth/bootstrap-admin") {
    if (!needsAdminBootstrap(store)) {
      return jsonError(
        409,
        "El usuario administrador ya está configurado."
      );
    }

    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName =
      typeof body.full_name === "string" && body.full_name.trim()
        ? body.full_name.trim()
        : "Administrador";

    if (!email || email.length > 254) {
      return jsonError(422, "Ingresa un email o usuario válido.");
    }
    if (password.length < 8 || password.length > 128) {
      return jsonError(
        422,
        "La contraseña debe tener entre 8 y 128 caracteres."
      );
    }
    if (findUserByEmail(store, email)) {
      return jsonError(409, "Ese usuario ya existe.");
    }

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email,
      hashed_password: hashPassword(password),
      full_name: fullName,
      specialty: null,
      role: "SUPER_ADMIN",
      is_active: true,
      must_change_password: false,
      created_at: now,
      updated_at: now,
    };
    store.users.set(user.id, user);

    appendAuditLog(store, {
      actor_user_id: user.id,
      action: "user.bootstrap_admin",
      entity_type: "user",
      entity_id: user.id,
      metadata_json: { email: user.email, role: user.role },
    });

    const access_token = createAccessToken(user.id);
    return NextResponse.json(
      {
        access_token,
        token_type: "bearer",
        must_change_password: false,
        user: toUserRead(user),
      },
      { status: 201 }
    );
  }

  if (method === "POST" && route === "/auth/login") {
    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    const user = email ? findUserByEmail(store, email) : null;
    if (!user || !verifyPassword(password, user.hashed_password)) {
      return jsonError(401, "Credenciales inválidas");
    }
    if (!user.is_active) {
      return jsonError(403, "Usuario inactivo");
    }

    const access_token = createAccessToken(user.id);
    return NextResponse.json({
      access_token,
      token_type: "bearer",
      must_change_password: user.must_change_password,
    });
  }

  if (method === "GET" && route === "/auth/me") {
    const auth = getAuthenticatedUser(request, store, {
      allowPasswordChange: true,
    });
    if ("response" in auth) return auth.response;
    return NextResponse.json(toUserRead(auth.user));
  }

  if (method === "POST" && route === "/auth/change-password") {
    const auth = getAuthenticatedUser(request, store, {
      allowPasswordChange: true,
    });
    if ("response" in auth) return auth.response;

    const body = await readJsonBody(request);
    const currentPassword =
      typeof body.current_password === "string" ? body.current_password : "";
    const newPassword =
      typeof body.new_password === "string" ? body.new_password : "";

    if (!verifyPassword(currentPassword, auth.user.hashed_password)) {
      return jsonError(401, "Contraseña actual incorrecta");
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return jsonError(
        422,
        "La nueva contraseña debe tener al menos 8 caracteres"
      );
    }
    if (verifyPassword(newPassword, auth.user.hashed_password)) {
      return jsonError(
        422,
        "La nueva contraseña debe ser distinta de la actual"
      );
    }

    auth.user.hashed_password = hashPassword(newPassword);
    auth.user.must_change_password = false;
    auth.user.updated_at = new Date().toISOString();

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "user.password_change",
      entity_type: "user",
      entity_id: auth.user.id,
      metadata_json: { email: auth.user.email },
    });

    return NextResponse.json(toUserRead(auth.user));
  }

  if (method === "POST" && route === "/auth/password-reset-request") {
    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const user = email ? findUserByEmail(store, email) : null;

    if (user && user.is_active) {
      let hasPending = false;
      for (const reqItem of store.passwordResetRequests.values()) {
        if (reqItem.user_id === user.id && reqItem.status === "pending") {
          hasPending = true;
          break;
        }
      }
      if (!hasPending) {
        const id = crypto.randomUUID();
        store.passwordResetRequests.set(id, {
          id,
          user_id: user.id,
          status: "pending",
          requested_at: new Date().toISOString(),
          resolved_at: null,
          resolved_by: null,
        });
        appendAuditLog(store, {
          actor_user_id: user.id,
          action: "user.password_reset_request",
          entity_type: "user",
          entity_id: user.id,
          metadata_json: { email: user.email },
        });
      }
    }

    return NextResponse.json({ detail: PASSWORD_RESET_ACK });
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/notifications") {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const unreadOnly = request.nextUrl.searchParams.get("unread_only") === "true";
    const list = store.notifications.filter(
      (n) => n.user_id === auth.user.id && (!unreadOnly || n.read_at === null)
    );
    return NextResponse.json(list);
  }

  if (method === "POST" && route === "/notifications/read-all") {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const now = new Date().toISOString();
    for (const n of store.notifications) {
      if (n.user_id === auth.user.id && n.read_at === null) {
        n.read_at = now;
      }
    }
    return NextResponse.json({ status: "ok" });
  }

  const notifReadMatch = route.match(/^\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && notifReadMatch) {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const item = store.notifications.find(
      (n) => n.id === notifReadMatch[1] && n.user_id === auth.user.id
    );
    if (!item) return jsonError(404, "Notificación no encontrada");
    item.read_at = new Date().toISOString();
    return NextResponse.json(item);
  }

  // -------------------------------------------------------------------------
  // Admin: Users & Password Resets (SUPER_ADMIN only)
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/admin/users") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;

    const roleFilter = request.nextUrl.searchParams.get("role");
    const activeFilter = request.nextUrl.searchParams.get("is_active");

    const users = Array.from(store.users.values())
      .filter((u) => {
        if (roleFilter && u.role !== roleFilter) return false;
        if (activeFilter === "true" && !u.is_active) return false;
        if (activeFilter === "false" && u.is_active) return false;
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(toUserRead);

    return NextResponse.json(users);
  }

  if (method === "POST" && route === "/admin/users") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;

    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName =
      typeof body.full_name === "string" && body.full_name.trim()
        ? body.full_name.trim()
        : null;
    const specialty =
      typeof body.specialty === "string" && body.specialty.trim()
        ? body.specialty.trim()
        : null;
    const role = typeof body.role === "string" ? (body.role as UserRole) : "CLIENT";

    if (!email || email.length > 254) {
      return jsonError(422, "Email inválido");
    }
    if (password.length < 8 || password.length > 128) {
      return jsonError(422, "La contraseña debe tener al menos 8 caracteres");
    }
    if (!VALID_ROLES.includes(role)) {
      return jsonError(422, "Rol inválido");
    }
    if (findUserByEmail(store, email)) {
      return jsonError(409, "El email ya está registrado");
    }

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email,
      hashed_password: hashPassword(password),
      full_name: fullName,
      specialty,
      role,
      is_active: true,
      must_change_password: false,
      created_at: now,
      updated_at: now,
    };
    store.users.set(user.id, user);

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "user.create",
      entity_type: "user",
      entity_id: user.id,
      metadata_json: { email: user.email, role: user.role },
    });

    return NextResponse.json(toUserRead(user), { status: 201 });
  }

  const userRoleMatch = route.match(/^\/admin\/users\/([^/]+)\/role$/);
  if (method === "PATCH" && userRoleMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const target = store.users.get(userRoleMatch[1]);
    if (!target) return jsonError(404, "Usuario no encontrado");

    const body = await readJsonBody(request);
    const newRole = typeof body.role === "string" ? (body.role as UserRole) : null;
    if (!newRole || !VALID_ROLES.includes(newRole)) {
      return jsonError(422, "Rol inválido");
    }
    const oldRole = target.role;
    target.role = newRole;
    target.updated_at = new Date().toISOString();

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "user.role_change",
      entity_type: "user",
      entity_id: target.id,
      metadata_json: { old_role: oldRole, new_role: newRole },
    });

    return NextResponse.json(toUserRead(target));
  }

  const userStatusMatch = route.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (method === "PATCH" && userStatusMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const target = store.users.get(userStatusMatch[1]);
    if (!target) return jsonError(404, "Usuario no encontrado");

    const body = await readJsonBody(request);
    if (typeof body.is_active !== "boolean") {
      return jsonError(422, "is_active debe ser booleano");
    }
    target.is_active = body.is_active;
    target.updated_at = new Date().toISOString();

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: body.is_active ? "user.activate" : "user.deactivate",
      entity_type: "user",
      entity_id: target.id,
      metadata_json: { is_active: body.is_active },
    });

    return NextResponse.json(toUserRead(target));
  }

  if (method === "GET" && route === "/admin/password-reset-requests") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const statusFilter = request.nextUrl.searchParams.get("status");

    const results = Array.from(store.passwordResetRequests.values())
      .filter((r) => !statusFilter || r.status === statusFilter)
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
      .map((r) => ({
        ...r,
        user_email: store.users.get(r.user_id)?.email ?? "desconocido",
      }));

    return NextResponse.json(results);
  }

  const resetApproveMatch = route.match(
    /^\/admin\/password-reset-requests\/([^/]+)\/approve$/
  );
  if (method === "POST" && resetApproveMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const reqItem = store.passwordResetRequests.get(resetApproveMatch[1]);
    if (!reqItem) return jsonError(404, "Solicitud no encontrada");
    if (reqItem.status !== "pending") {
      return jsonError(409, "La solicitud ya fue procesada");
    }
    const target = store.users.get(reqItem.user_id);
    if (!target) return jsonError(404, "Usuario no encontrado");

    const body = await readJsonBody(request);
    const customTemp =
      typeof body.temporary_password === "string" &&
      body.temporary_password.trim().length >= 8
        ? body.temporary_password.trim()
        : null;
    const temporaryPassword = customTemp ?? generateTemporaryPassword();

    const now = new Date().toISOString();
    target.hashed_password = hashPassword(temporaryPassword);
    target.must_change_password = true;
    target.updated_at = now;
    reqItem.status = "approved";
    reqItem.resolved_at = now;
    reqItem.resolved_by = auth.user.id;

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "user.password_reset_approve",
      entity_type: "user",
      entity_id: target.id,
      metadata_json: { email: target.email, request_id: reqItem.id },
    });

    return NextResponse.json({
      temporary_password: temporaryPassword,
      user: toUserRead(target),
    });
  }

  const resetRejectMatch = route.match(
    /^\/admin\/password-reset-requests\/([^/]+)\/reject$/
  );
  if (method === "POST" && resetRejectMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const reqItem = store.passwordResetRequests.get(resetRejectMatch[1]);
    if (!reqItem) return jsonError(404, "Solicitud no encontrada");
    if (reqItem.status !== "pending") {
      return jsonError(409, "La solicitud ya fue procesada");
    }
    const target = store.users.get(reqItem.user_id);

    reqItem.status = "rejected";
    reqItem.resolved_at = new Date().toISOString();
    reqItem.resolved_by = auth.user.id;

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "user.password_reset_reject",
      entity_type: "user",
      entity_id: reqItem.user_id,
      metadata_json: {
        email: target?.email ?? null,
        request_id: reqItem.id,
      },
    });

    return NextResponse.json({
      ...reqItem,
      user_email: target?.email ?? "desconocido",
    });
  }

  // -------------------------------------------------------------------------
  // Admin: Pricing & Audit Logs
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/admin/pricing") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    return NextResponse.json(store.pricingConfig);
  }

  if (method === "PUT" && route === "/admin/pricing") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;

    const body = await readJsonBody(request);
    const pricePerM2 = Number(body.price_per_m2_base);
    const brandingBase = Number(body.branding_base_price);
    const multiplier = Number(body.integral_multiplier);
    const changeRounds = Number(body.default_change_rounds);

    if (
      !Number.isFinite(pricePerM2) ||
      pricePerM2 < 0 ||
      !Number.isFinite(brandingBase) ||
      brandingBase < 0 ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0 ||
      !Number.isInteger(changeRounds) ||
      changeRounds < 0
    ) {
      return jsonError(422, "Valores de pricing inválidos");
    }

    store.pricingConfig = {
      id: crypto.randomUUID(),
      price_per_m2_base: pricePerM2.toFixed(2),
      branding_base_price: brandingBase.toFixed(2),
      integral_multiplier: multiplier.toFixed(2),
      default_change_rounds: changeRounds,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    };

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "pricing.update",
      entity_type: "pricing_config",
      entity_id: store.pricingConfig.id,
      metadata_json: {
        price_per_m2_base: store.pricingConfig.price_per_m2_base,
        branding_base_price: store.pricingConfig.branding_base_price,
        integral_multiplier: store.pricingConfig.integral_multiplier,
        default_change_rounds: store.pricingConfig.default_change_rounds,
      },
    });

    return NextResponse.json(store.pricingConfig);
  }

  if (method === "GET" && route === "/admin/audit-logs") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
    if ("response" in auth) return auth.response;
    const entityType = request.nextUrl.searchParams.get("entity_type");
    const limitParam = Number(request.nextUrl.searchParams.get("limit") || "200");
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 500)
        : 200;

    const logs = store.auditLogs
      .filter((log) => !entityType || log.entity_type === entityType)
      .slice(0, limit);
    return NextResponse.json(logs);
  }

  // -------------------------------------------------------------------------
  // Admin: Clients & Team lists
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/admin/clients") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const clients = Array.from(store.users.values())
      .filter((u) => u.role === "CLIENT" && u.is_active)
      .map((u) => ({ id: u.id, email: u.email, full_name: u.full_name }));
    return NextResponse.json(clients);
  }

  if (method === "GET" && route === "/admin/team") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const team = Array.from(store.users.values())
      .filter(
        (u) =>
          (u.role === "LEAD_DESIGNER" || u.role === "COLLABORATOR") &&
          u.is_active
      )
      .map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
      }));
    return NextResponse.json(team);
  }

  // -------------------------------------------------------------------------
  // Leads (Public create + availability; Admin list/quote/proposal/convert)
  // -------------------------------------------------------------------------
  if (method === "POST" && route === "/leads") {
    const body = await readJsonBody(request);
    const contactName =
      typeof body.contact_name === "string" ? body.contact_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const serviceType = body.service_type as ScopeType;

    if (!contactName || !email) {
      return jsonError(422, "Nombre y email son obligatorios");
    }
    if (!["branding", "interior", "integral"].includes(serviceType)) {
      return jsonError(422, "Tipo de servicio inválido");
    }

    const lead: StoredLead = {
      id: crypto.randomUUID(),
      contact_name: contactName,
      email,
      service_type: serviceType,
      space_type: typeof body.space_type === "string" ? body.space_type : null,
      area_m2:
        body.area_m2 !== undefined && body.area_m2 !== null
          ? String(body.area_m2)
          : null,
      budget_range:
        typeof body.budget_range === "string" ? body.budget_range : null,
      status: "new",
      created_at: new Date().toISOString(),
    };
    store.leads.set(lead.id, lead);
    return NextResponse.json(lead, { status: 201 });
  }

  if (method === "GET" && route === "/leads") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const list = Array.from(store.leads.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    return NextResponse.json(list);
  }

  if (method === "GET" && route === "/leads/availability") {
    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return jsonError(422, "Fecha inválida");
    }
    const slots = [10, 12, 15, 17].map((hour) => {
      const start = new Date(`${dateParam}T${String(hour).padStart(2, "0")}:00:00Z`);
      const end = new Date(start.getTime() + 45 * 60 * 1000);
      return { start_time: start.toISOString(), end_time: end.toISOString() };
    });
    return NextResponse.json({ slots });
  }

  const leadMeetingMatch = route.match(/^\/leads\/([^/]+)\/meetings$/);
  if (method === "POST" && leadMeetingMatch) {
    const lead = store.leads.get(leadMeetingMatch[1]);
    if (!lead) return jsonError(404, "Lead no encontrado");
    const body = await readJsonBody(request);
    const startMs =
      typeof body.start_time === "string" ? Date.parse(body.start_time) : NaN;
    if (!Number.isFinite(startMs)) {
      return jsonError(422, "Fecha de inicio inválida");
    }
    const endMs =
      typeof body.end_time === "string" ? Date.parse(body.end_time) : NaN;
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(
      Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 45 * 60 * 1000
    ).toISOString();

    const meeting = {
      id: crypto.randomUUID(),
      lead_id: lead.id,
      project_id: null,
      google_event_id: null,
      meet_link: null,
      start_time: startTime,
      end_time: endTime,
      meeting_type: "discovery",
      status: "scheduled",
      created_at: new Date().toISOString(),
    };
    store.meetings.push(meeting);
    lead.status = "discovery_scheduled";
    return NextResponse.json(meeting, { status: 201 });
  }

  const leadQuoteMatch = route.match(/^\/admin\/leads\/([^/]+)\/quote$/);
  if (method === "GET" && leadQuoteMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const lead = store.leads.get(leadQuoteMatch[1]);
    if (!lead) return jsonError(404, "Lead no encontrado");
    return NextResponse.json(computeQuote(store, lead));
  }

  const leadProposalMatch = route.match(/^\/admin\/leads\/([^/]+)\/proposal$/);
  if (method === "POST" && leadProposalMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const lead = store.leads.get(leadProposalMatch[1]);
    if (!lead) return jsonError(404, "Lead no encontrado");
    lead.status = "proposal_sent";
    return NextResponse.json({
      ...computeQuote(store, lead),
      lead_id: lead.id,
      generated_at: new Date().toISOString(),
    });
  }

  const leadConvertMatch = route.match(/^\/admin\/leads\/([^/]+)\/convert$/);
  if (method === "POST" && leadConvertMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const lead = store.leads.get(leadConvertMatch[1]);
    if (!lead) return jsonError(404, "Lead no encontrado");

    const body = await readJsonBody(request);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : `Proyecto · ${lead.contact_name}`;
    const clientId =
      typeof body.client_id === "string" && body.client_id.trim()
        ? body.client_id.trim()
        : null;

    const project: StoredProject = {
      id: crypto.randomUUID(),
      title,
      lead_id: lead.id,
      client_id: clientId,
      lead_designer_id: auth.user.role === "LEAD_DESIGNER" ? auth.user.id : null,
      scope_type: lead.service_type,
      status: "draft",
      included_rounds: store.pricingConfig.default_change_rounds,
      remaining_rounds: store.pricingConfig.default_change_rounds,
      balance_paid: false,
      brief_sent_at: null,
      brief_submitted_at: null,
      created_at: new Date().toISOString(),
    };
    store.projects.set(project.id, project);
    seedProjectDefaults(store, project, auth.user.id);
    lead.status = "converted";

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "lead.convert",
      entity_type: "project",
      entity_id: project.id,
      metadata_json: { lead_id: lead.id, title: project.title },
    });

    return NextResponse.json(project, { status: 201 });
  }

  // -------------------------------------------------------------------------
  // Projects (Admin + Portal)
  // -------------------------------------------------------------------------
  if (method === "GET" && route === "/admin/projects") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const list = Array.from(store.projects.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    return NextResponse.json(list);
  }

  if (method === "POST" && route === "/admin/projects") {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;

    const body = await readJsonBody(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return jsonError(422, "El título es obligatorio");

    const rawScope = body.scope_type;
    const scopeType: ScopeType =
      rawScope === "branding" || rawScope === "interior" || rawScope === "integral"
        ? rawScope
        : "branding";
    const clientId =
      typeof body.client_id === "string" && body.client_id.trim()
        ? body.client_id.trim()
        : null;
    const leadDesignerId =
      typeof body.lead_designer_id === "string" && body.lead_designer_id.trim()
        ? body.lead_designer_id.trim()
        : auth.user.role === "LEAD_DESIGNER"
          ? auth.user.id
          : null;
    const includedRounds =
      typeof body.included_rounds === "number" && body.included_rounds >= 0
        ? Math.floor(body.included_rounds)
        : store.pricingConfig.default_change_rounds;

    const now = new Date().toISOString();
    const project: StoredProject = {
      id: crypto.randomUUID(),
      title,
      lead_id: null,
      client_id: clientId,
      lead_designer_id: leadDesignerId,
      scope_type: scopeType,
      status: "draft",
      included_rounds: includedRounds,
      remaining_rounds: includedRounds,
      balance_paid: false,
      brief_sent_at: null,
      brief_submitted_at: null,
      created_at: now,
    };
    store.projects.set(project.id, project);
    const initialMembers = [];
    if (clientId) {
      initialMembers.push({
        id: crypto.randomUUID(),
        project_id: project.id,
        user_id: clientId,
        assigned_role: "CLIENT" as const,
        created_at: now,
      });
    }
    if (leadDesignerId) {
      initialMembers.push({
        id: crypto.randomUUID(),
        project_id: project.id,
        user_id: leadDesignerId,
        assigned_role: "LEAD_DESIGNER" as const,
        created_at: now,
      });
    }
    if (initialMembers.length > 0) {
      store.projectMembers.set(project.id, initialMembers);
    }
    seedProjectDefaults(store, project, auth.user.id);

    appendAuditLog(store, {
      actor_user_id: auth.user.id,
      action: "project.create",
      entity_type: "project",
      entity_id: project.id,
      metadata_json: { title: project.title, scope_type: project.scope_type },
    });

    return NextResponse.json(project, { status: 201 });
  }

  if (method === "GET" && route === "/projects") {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const list = Array.from(store.projects.values())
      .filter((p) => canAccessProject(store, auth.user, p))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json(list);
  }

  const projectSingleMatch = route.match(/^\/projects\/([^/]+)$/);
  if (method === "GET" && projectSingleMatch) {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const project = store.projects.get(projectSingleMatch[1]);
    if (!project) return jsonError(404, "Proyecto no encontrado");
    if (!canAccessProject(store, auth.user, project)) {
      return jsonError(403, "Sin acceso a este proyecto");
    }
    return NextResponse.json(project);
  }

  const adminProjectAction = route.match(
    /^\/admin\/projects\/([^/]+)\/(activate|validate-final-payment|client|lead|lead-designer|extra-round|members)$/
  );
  if (adminProjectAction) {
    const [, projectId, action] = adminProjectAction;
    const project = store.projects.get(projectId);
    if (!project) return jsonError(404, "Proyecto no encontrado");

    if (method === "POST" && action === "activate") {
      const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
      if ("response" in auth) return auth.response;
      project.status = "active";
      appendAuditLog(store, {
        actor_user_id: auth.user.id,
        action: "project.activate",
        entity_type: "project",
        entity_id: project.id,
      });
      return NextResponse.json(project);
    }

    if (method === "POST" && action === "validate-final-payment") {
      const auth = requireRoles(request, store, ["SUPER_ADMIN"]);
      if ("response" in auth) return auth.response;
      project.balance_paid = true;
      appendAuditLog(store, {
        actor_user_id: auth.user.id,
        action: "project.validate_final_payment",
        entity_type: "project",
        entity_id: project.id,
      });
      return NextResponse.json(project);
    }

    if (method === "PATCH" && action === "client") {
      const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
      if ("response" in auth) return auth.response;
      if (!canAccessProject(store, auth.user, project)) {
        return jsonError(403, "Sin acceso a este proyecto");
      }
      const body = await readJsonBody(request);
      const clientId =
        typeof body.client_id === "string" && body.client_id.trim()
          ? body.client_id.trim()
          : null;
      const previousClientId = project.client_id;

      if (clientId) {
        const clientUser = store.users.get(clientId);
        if (!clientUser || clientUser.role !== "CLIENT") {
          return jsonError(400, "Usuario no encontrado o no tiene rol CLIENT");
        }
      }

      project.client_id = clientId;
      let members = store.projectMembers.get(project.id) ?? [];
      if (previousClientId && previousClientId !== clientId) {
        members = members.filter(
          (m) => !(m.user_id === previousClientId && m.assigned_role === "CLIENT")
        );
      }
      if (clientId) {
        const existing = members.find((m) => m.user_id === clientId);
        if (!existing) {
          members.push({
            id: crypto.randomUUID(),
            project_id: project.id,
            user_id: clientId,
            assigned_role: "CLIENT",
            created_at: new Date().toISOString(),
          });
        } else {
          existing.assigned_role = "CLIENT";
        }
      }
      store.projectMembers.set(project.id, members);

      appendAuditLog(store, {
        actor_user_id: auth.user.id,
        action: "project.client_assigned",
        entity_type: "project",
        entity_id: project.id,
        metadata_json: { client_id: clientId },
      });
      return NextResponse.json(project);
    }

    if (method === "PATCH" && (action === "lead" || action === "lead-designer")) {
      const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
      if ("response" in auth) return auth.response;
      if (!canAccessProject(store, auth.user, project)) {
        return jsonError(403, "Sin acceso a este proyecto");
      }
      const body = await readJsonBody(request);
      const leadId =
        typeof body.lead_designer_id === "string" && body.lead_designer_id.trim()
          ? body.lead_designer_id.trim()
          : null;

      if (!leadId) {
        return jsonError(422, "Debes indicar un líder de proyecto válido");
      }

      const newLead = store.users.get(leadId);
      if (!newLead) {
        return jsonError(404, "Usuario no encontrado");
      }
      if (newLead.role !== "LEAD_DESIGNER") {
        return jsonError(422, "El usuario seleccionado no tiene rol LEAD_DESIGNER");
      }
      if (!newLead.is_active) {
        return jsonError(403, "El usuario seleccionado está inactivo");
      }

      const previousLeadId = project.lead_designer_id;
      project.lead_designer_id = newLead.id;

      let members = store.projectMembers.get(project.id) ?? [];
      if (previousLeadId && previousLeadId !== newLead.id) {
        members = members.filter(
          (m) =>
            !(
              m.user_id === previousLeadId &&
              m.assigned_role === "LEAD_DESIGNER"
            )
        );
      }
      if (!members.some((m) => m.user_id === newLead.id)) {
        members.push({
          id: crypto.randomUUID(),
          project_id: project.id,
          user_id: newLead.id,
          assigned_role: "LEAD_DESIGNER",
          created_at: new Date().toISOString(),
        });
      }
      store.projectMembers.set(project.id, members);

      appendAuditLog(store, {
        actor_user_id: auth.user.id,
        action: "project.lead_assigned",
        entity_type: "project",
        entity_id: project.id,
        metadata_json: {
          previous_lead_id: previousLeadId,
          new_lead_id: newLead.id,
        },
      });
      return NextResponse.json(project);
    }

    if (method === "POST" && action === "extra-round") {
      const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
      if ("response" in auth) return auth.response;
      if (!canAccessProject(store, auth.user, project)) {
        return jsonError(403, "Sin acceso a este proyecto");
      }
      if (project.status !== "active") {
        return jsonError(409, "El proyecto debe estar activo");
      }
      project.included_rounds += 1;
      project.remaining_rounds += 1;
      appendAuditLog(store, {
        actor_user_id: auth.user.id,
        action: "project.extra_round_granted",
        entity_type: "project",
        entity_id: project.id,
        metadata_json: {
          included_rounds: project.included_rounds,
          remaining_rounds: project.remaining_rounds,
        },
      });
      return NextResponse.json(project);
    }

    if (action === "members") {
      const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
      if ("response" in auth) return auth.response;
      if (!canAccessProject(store, auth.user, project)) {
        return jsonError(403, "Sin acceso a este proyecto");
      }
      const members = store.projectMembers.get(project.id) ?? [];

      if (method === "GET") {
        return NextResponse.json(
          members.map((m) => {
            const u = store.users.get(m.user_id);
            return {
              id: m.id,
              user_id: m.user_id,
              email: u?.email ?? "",
              full_name: u?.full_name ?? null,
              assigned_role: m.assigned_role,
              created_at: m.created_at,
            };
          })
        );
      }

      if (method === "POST") {
        const body = await readJsonBody(request);
        const userId = typeof body.user_id === "string" ? body.user_id : "";
        const target = store.users.get(userId);
        if (!target) return jsonError(404, "Usuario no encontrado");
        if (!target.is_active) return jsonError(403, "Usuario inactivo");
        if (members.some((m) => m.user_id === userId)) {
          return jsonError(409, "El usuario ya es miembro del proyecto");
        }
        const assignedRole =
          body.assigned_role === "LEAD_DESIGNER" ||
          body.assigned_role === "COLLABORATOR"
            ? body.assigned_role
            : target.role === "LEAD_DESIGNER"
              ? "LEAD_DESIGNER"
              : "COLLABORATOR";
        const newMember = {
          id: crypto.randomUUID(),
          project_id: project.id,
          user_id: userId,
          assigned_role: assignedRole as "LEAD_DESIGNER" | "COLLABORATOR" | "CLIENT",
          created_at: new Date().toISOString(),
        };
        members.push(newMember);
        store.projectMembers.set(project.id, members);

        appendAuditLog(store, {
          actor_user_id: auth.user.id,
          action: "project.member_added",
          entity_type: "project",
          entity_id: project.id,
          metadata_json: { user_id: target.id, assigned_role: assignedRole },
        });

        return NextResponse.json(
          {
            id: newMember.id,
            user_id: target.id,
            email: target.email,
            full_name: target.full_name,
            assigned_role: newMember.assigned_role,
            created_at: newMember.created_at,
          },
          { status: 201 }
        );
      }
    }
  }

  const removeMemberMatch = route.match(
    /^\/admin\/projects\/([^/]+)\/members\/([^/]+)$/
  );
  if (method === "DELETE" && removeMemberMatch) {
    const auth = requireRoles(request, store, ["SUPER_ADMIN", "LEAD_DESIGNER"]);
    if ("response" in auth) return auth.response;
    const [, projectId, userId] = removeMemberMatch;
    const members = store.projectMembers.get(projectId) ?? [];
    store.projectMembers.set(
      projectId,
      members.filter((m) => m.user_id !== userId)
    );
    return NextResponse.json({ status: "ok" });
  }

  // -------------------------------------------------------------------------
  // Brief, Stages, Deliverables, Specifications, Meetings (per project)
  // -------------------------------------------------------------------------
  if (method === "GET" && (route === "/brief/pending" || route === "/projects/brief/pending")) {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const myProjects = Array.from(store.projects.values()).filter(
      (p) => canAccessProject(store, auth.user, p) && Boolean(p.brief_sent_at)
    );
    const pendingBriefs = myProjects
      .map((p) => {
        const info = computeDetailedBriefProgress(store, p.id);
        return { project_id: p.id, project_title: p.title, ...info };
      })
      .filter((b) => b.has_pending);

    const first = pendingBriefs[0];
    return NextResponse.json({
      has_pending: Boolean(first),
      total_questions: first?.total_questions ?? 0,
      answered_questions: first?.answered_questions ?? 0,
      progress: first?.progress ?? 100,
      status: first ? "pending" : "completed",
      pending_briefs: pendingBriefs.map((b) => ({
        project_id: b.project_id,
        project_title: b.project_title,
        progress: b.progress,
      })),
    });
  }

  const projectSubMatch = route.match(/^\/projects\/([^/]+)\/(.+)$/);
  if (projectSubMatch) {
    const auth = getAuthenticatedUser(request, store);
    if ("response" in auth) return auth.response;
    const [, projectId, subPath] = projectSubMatch;
    const project = store.projects.get(projectId);
    if (!project) return jsonError(404, "Proyecto no encontrado");
    if (!canAccessProject(store, auth.user, project)) {
      return jsonError(403, "Sin acceso a este proyecto");
    }

    const handled = await handleProjectBriefAndAssetSubroutes({
      request,
      method,
      subPath,
      store,
      project,
      user: auth.user,
      readJsonBody,
    });
    if (handled) return handled;

    const stageHandled = await handleProjectStageSubroutes({
      request,
      method,
      subPath,
      store,
      project,
      user: auth.user,
      readJsonBody,
    });
    if (stageHandled) return stageHandled;

    if (subPath === "specifications") {
      const specs = store.specifications.get(projectId) ?? [];
      if (method === "GET") {
        return NextResponse.json(specs);
      }
      if (method === "POST") {
        if (auth.user.role === "CLIENT") {
          return jsonError(403, "Solo el estudio puede crear especificaciones");
        }
        const body = await readJsonBody(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return jsonError(422, "El nombre es obligatorio");
        const category = (
          ["furniture", "lighting", "finishes", "equipment", "other"].includes(
            String(body.category)
          )
            ? body.category
            : "other"
        ) as StoredSpecification["category"];
        let safeReferenceUrl: string | null = null;
        if (typeof body.reference_url === "string" && body.reference_url.trim()) {
          try {
            const parsed = new URL(body.reference_url.trim());
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return jsonError(422, "La URL de referencia debe usar http o https");
            }
            safeReferenceUrl = parsed.toString();
          } catch {
            return jsonError(422, "URL de referencia inválida");
          }
        }
        const now = new Date().toISOString();
        const spec: StoredSpecification = {
          id: crypto.randomUUID(),
          project_id: projectId,
          category,
          name,
          code: typeof body.code === "string" ? body.code : null,
          manufacturer:
            typeof body.manufacturer === "string" ? body.manufacturer : null,
          finish: typeof body.finish === "string" ? body.finish : null,
          dimensions:
            typeof body.dimensions === "string" ? body.dimensions : null,
          supplier: typeof body.supplier === "string" ? body.supplier : null,
          reference_url: safeReferenceUrl,
          location: typeof body.location === "string" ? body.location : null,
          notes: typeof body.notes === "string" ? body.notes : null,
          created_by: auth.user.id,
          created_at: now,
          updated_at: now,
        };
        specs.push(spec);
        store.specifications.set(projectId, specs);
        return NextResponse.json(spec, { status: 201 });
      }
    }

    if (method === "GET" && subPath === "meetings") {
      return NextResponse.json(
        store.meetings.filter((m) => m.project_id === projectId)
      );
    }
  }

  return jsonError(404, `Endpoint not found: ${method} /api/v1${route}`);
}

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  return handleRequest(request, context);
}
