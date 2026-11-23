# Brief Gating + Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team-only edit/delete of brief questions with an explicit "sent/ready" gate for clients, plus an admin-mediated password reset with mandatory change on login.

**Architecture:** FastAPI + async SQLAlchemy backend; two idempotent Alembic migrations (0011 `projects.brief_sent_at`, 0012 `users.must_change_password` + `password_reset_requests`). Gating enforced server-side in `brief.py` read/answer routes and in `api/deps.py` (password flag). Next.js frontend consumes the new fields/endpoints.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, passlib/bcrypt, pytest + pytest-asyncio (strict) + aiosqlite, Next.js App Router (TypeScript).

**Spec:** `docs/superpowers/specs/2026-11-23-brief-gating-password-reset-design.md`

## Global Constraints

- RBAC roles exactly: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`. Every protected endpoint: authenticated + `is_active` + role + project membership where applicable (existing deps in `backend/app/api/deps.py`).
- Team guard for question mutations = `require_team_member` (same as `POST /brief/questions`); client answer routes keep `require_roles(UserRole.CLIENT)` + CLIENT membership check.
- All sensitive actions audited via `backend/app/services/audit.py::log_audit`. Never log passwords (plain or hashed) in audit metadata or responses other than the one-time approve response.
- Migrations follow the idempotent inspector pattern of `backend/alembic/versions/0010_brief_item_client_confirmed.py` (no `IF NOT EXISTS`; check `sa.inspect(bind)`), revision ids `"0011"` (down `"0010"`) and `"0012"` (down `"0011"`).
- Passwords hashed only via `backend/app/core/security.py` (`get_password_hash` / `verify_password`). New-password schema bounds: `min_length=8, max_length=128` (matches `UserCreate`).
- Tests: `tests/backend/`, async fixtures from `conftest.py`, `@pytest.mark.asyncio` (strict mode), run from repo root: `python -m pytest tests/backend/<file> -v`.
- Frontend: Spanish UI copy; follow the existing style of each page (editorial rounded style on brief pages, `btn-brutal`/`border-border` brutalist style on login/admin-users); min 44px touch targets; no hover-only interactions; use `apiFetch`/`extractDetail` from `frontend/lib/api.ts`.
- Commit your own task when its tests pass (conventional message, e.g. `feat(brief): ...`); tasks run sequentially, one implementer at a time. Do NOT edit files outside your task's file list.

## Review Focus

1. CLIENT hitting read/media routes directly pre-send must not leak questions, counts or files → Task 1 gating tests.
2. Deleting a question with child images/audio must not orphan storage files or break FK/unique constraints → Task 1 delete tests.
3. Reset request for unknown/inactive email must be indistinguishable from a real one (enumeration) → Task 2 tests.
4. Flagged user with a valid JWT is blocked server-side on normal endpoints, but `/auth/me` + `/auth/change-password` stay reachable → Task 2 tests.
5. Approving a non-pending request → 409; custom temporary password < 8 chars → 422 → Task 2 tests.
6. Pre-send batch autosave must 409 before any partial mutation → Task 1 gating tests.

---

### Task 1: Backend — brief question edit/delete + ready gate (migration 0011)

**Files:**
- Modify: `backend/app/models/project.py`, `backend/app/schemas/project.py`, `backend/app/schemas/brief.py`, `backend/app/api/v1/endpoints/brief.py`, `backend/app/services/notifications.py`, `tests/backend/conftest.py`
- Create: `backend/alembic/versions/0011_project_brief_sent_at.py`, `tests/backend/test_brief_question_edit_delete.py`, `tests/backend/test_brief_ready_gate.py`, `tests/backend/test_migration_0011_brief_sent.py`

**Interfaces (Produces):**
- `Project.brief_sent_at: Mapped[datetime | None]` (DateTime(timezone=True), nullable). `ProjectRead.brief_sent_at: datetime | None = None`.
- `BriefQuestionUpdate(BaseModel)`: `extra="forbid"`; `prompt: str | None = Field(None, min_length=1, max_length=500)`; `category: BriefCategory | None = None`.
- `BriefSendResponse(BaseModel)`: `project_id: UUID`, `brief_sent_at: datetime`.
- `BriefPendingResponse.brief_sent: bool = False`.
- `notifications.py`: `async def notify_project_client(db: AsyncSession, project_id: UUID, event_type: str, payload: dict, exclude_user_id: UUID | None = None) -> list[Notification]` — recipients = `project.client_id` + members with `assigned_role == ProjectRole.CLIENT`, active users only, deduped, actor excluded; adds rows, does NOT commit (mirrors `notify_project_team`).
- `brief.py` helpers: `def require_brief_sent(project: Project) -> None` (409 `"Brief is not ready to be answered"` when `brief_sent_at is None`); `def client_sees_questions(project: Project, user: User) -> bool` (`user.role != UserRole.CLIENT or project.brief_sent_at is not None`).
- Routes: `PATCH /projects/{project_id}/brief/questions/{item_id}` → `BriefItemRead`; `DELETE /projects/{project_id}/brief/questions/{item_id}?force=false` → 204; `POST /projects/{project_id}/brief/send` → `BriefSendResponse`.

**Steps:**
- [ ] Write failing tests `test_brief_question_edit_delete.py`: team roles (SUPER_ADMIN; LEAD_DESIGNER/COLLABORATOR with membership) can PATCH prompt/category (200, values changed, audit `brief.question_update` exists); CLIENT member and non-member team user get 403; PATCH with both fields null → 422; PATCH unknown/cross-project item → 404; DELETE unanswered question → 204, row gone, audit `brief.question_delete`; DELETE answered question → 409, with `?force=true` → 204 and child `BriefItemImage` rows + storage files removed (use the `get_storage` dependency override pattern from `tests/backend/test_storage.py` / `test_brief.py`); inactive project → 409.
- [ ] Write failing tests `test_brief_ready_gate.py` (project with `brief_sent_at=None`, CLIENT member + questions): CLIENT `GET /brief` returns only references; `GET /brief/pending` returns `brief_sent=false`, zero counts, `items=[]`, `has_pending_brief=false`; client `GET /brief/pending` (global router) skips the project; PATCH answer, PATCH autosave (single AND batch `items`), POST response-file, DELETE image/audio, POST confirm all → 409 with no mutation; question media GET → 404 for CLIENT; team roles still see questions and counts. Then `POST /brief/send` by COLLABORATOR member → 200 sets `brief_sent_at`, creates `Notification(event_type="brief.ready")` for the client user, audit `brief.sent`; re-send → 409; CLIENT without membership → 403; after send: questions visible, answering works (200), `brief_sent=true`.
- [ ] Run both files, verify they fail for the right reasons (missing routes/fields).
- [ ] Implement: model + schemas + migration 0011 (add column via inspector; backfill `brief_sent_at = updated_at` for projects having a question with `status='completed'` OR non-null `answer`/`image_storage_key`/`audio_storage_key` OR a row in `brief_item_images`; portable SQL, EXISTS subqueries). Downgrade drops the column.
- [ ] Implement `brief.py`: new routes (reuse `_get_question_or_404`, `require_active_project`, `is_question_answered`); call `require_brief_sent(project)` in `answer_question`, `_apply_autosave`, `upload_response_file`, `delete_item_image`, `delete_item_audio`, `confirm_item` right after `require_active_project`; filter reads/media per `client_sees_questions`; zeroed pre-send status response; `notify_project_client` + audit on send. DELETE removes child image rows, deletes storage keys (child images, `audio_storage_key`, legacy `image_storage_key` when not mirrored by a child) tolerating `UploadValidationError`, then the item.
- [ ] Update `conftest.py::active_project` to set `brief_sent_at=datetime.now(timezone.utc)` (existing client-answer tests keep passing); gating tests null it explicitly or build their own project.
- [ ] Write `test_migration_0011_brief_sent.py` mirroring `test_migration_0010_client_confirmed.py` (upgrade idempotent on fresh + pre-existing column; backfill sets answered projects, leaves unanswered NULL).
- [ ] Run: `python -m pytest tests/backend/test_brief_question_edit_delete.py tests/backend/test_brief_ready_gate.py tests/backend/test_migration_0011_brief_sent.py tests/backend/test_brief.py tests/backend/test_notifications.py tests/backend/test_project_isolation.py -v` → all pass.

### Task 2: Backend — password reset flow (migration 0012)

**Files:**
- Modify: `backend/app/models/user.py`, `backend/app/models/__init__.py`, `backend/app/schemas/user.py`, `backend/app/schemas/auth.py`, `backend/app/api/deps.py`, `backend/app/api/v1/endpoints/auth.py`, `backend/app/api/v1/endpoints/admin_users.py`
- Create: `backend/app/models/password_reset_request.py`, `backend/alembic/versions/0012_password_reset.py`, `tests/backend/test_password_reset.py`, `tests/backend/test_migration_0012_password_reset.py`

**Interfaces (Produces):**
- `User.must_change_password: Mapped[bool]` (Boolean, default False, `server_default=text("false")`, nullable=False).
- `password_reset_request.py`: `PasswordResetRequestStatus(str, enum.Enum)` PENDING/APPROVED/REJECTED (values lowercase, `_missing_` tolerance like other enums); `PasswordResetRequest` table `password_reset_requests`: `id` UUID pk, `user_id` FK users.id indexed, `status` SAEnum(native_enum=False, values_callable) default PENDING server_default `"pending"`, `requested_at` DateTime(tz) NOT NULL, `resolved_at` nullable, `resolved_by` FK users.id nullable. Export both in `models/__init__.py`.
- Schemas: `auth.py`: `PasswordResetRequestCreate {email: str max_length=320}`, `ChangePasswordRequest {current_password: str min1 max128, new_password: str min8 max128}`. `user.py`: `Token.must_change_password: bool = False`; `UserRead.must_change_password: bool = False`; `PasswordResetRequestRead {id, user_id, user_email: str, status, requested_at, resolved_at: datetime | None, resolved_by: UUID | None}`; `TemporaryPasswordAssign {temporary_password: str | None = Field(None, min_length=8, max_length=128)}`; `PasswordResetApproveResponse {temporary_password: str, user: UserRead}`.
- `deps.py`: `get_current_active_user` additionally raises 403 detail `"password_change_required"` when `must_change_password`; new `get_current_active_user_allow_password_change` (is_active check only). `require_roles` keeps using the strict one.
- Routes: `POST /auth/password-reset-request` (public) → 200 `{"detail": "Si la cuenta existe, tu solicitud fue enviada al estudio."}` always; `POST /auth/change-password` (flag-tolerant dep) → `UserRead`; `GET /admin/password-reset-requests?status=` → `list[PasswordResetRequestRead]`; `POST /admin/password-reset-requests/{request_id}/approve` (body `TemporaryPasswordAssign`) → `PasswordResetApproveResponse`; `POST /admin/password-reset-requests/{request_id}/reject` → `PasswordResetRequestRead`. `/auth/me` switches to the flag-tolerant dep.

**Steps:**
- [ ] Write failing tests `test_password_reset.py`: request for existing active user creates one pending row; second request dedupes (still 1); unknown email and inactive user → identical 200 body, no row; non-admin cannot list/approve/reject (403); admin list shows `user_email`; approve without body password generates ≥8-char temp, updates hash (`verify_password` true), sets `must_change_password=True`, marks request approved with `resolved_by`, audit `user.password_reset_approve` metadata contains NO password; approve with custom `"TempPass123"` works; custom `"short"` → 422; approve/reject non-pending → 409; reject marks rejected + audit. Login with temp password → 200 `Token.must_change_password=true`; flagged user `GET /admin/users` (admin) or any `require_roles`/`get_current_active_user` endpoint → 403 `password_change_required`; `/auth/me` still 200 with flag; `POST /auth/change-password` wrong current → 401, same-as-current → 422, valid → 200 clears flag + audit `user.password_change`; login afterwards → flag false and normal access restored.
- [ ] Run file, verify failures.
- [ ] Implement model/schemas/migration 0012 (inspector: add `must_change_password` column if missing; `create_table` only if `not sa.inspect(bind).has_table("password_reset_requests")`; downgrade drops table + column).
- [ ] Implement deps guard + auth/admin endpoints per interfaces. Approve: `secrets.token_urlsafe(12)` when no custom password; hash via `get_password_hash`; commit user + request together; plaintext only in the approve response.
- [ ] Write `test_migration_0012_password_reset.py` (idempotent upgrade, defaults false/pending).
- [ ] Run: `python -m pytest tests/backend/test_password_reset.py tests/backend/test_migration_0012_password_reset.py tests/backend/test_auth.py tests/backend/test_auth_me.py tests/backend/test_admin_users.py tests/backend/test_rbac.py tests/backend/test_security.py -v` → all pass.

### Task 3: Frontend — brief pages (after Task 1)

**Files:**
- Modify: `frontend/app/admin/projects/[projectId]/brief/page.tsx`, `frontend/app/portal/projects/[projectId]/brief/page.tsx`

**Interfaces (Consumes from Task 1):** `ProjectRead.brief_sent_at`; `PATCH /api/v1/projects/{id}/brief/questions/{itemId}` body `{prompt?, category?}`; `DELETE .../brief/questions/{itemId}?force=true` → 204; `POST .../brief/send` → `{project_id, brief_sent_at}`; `BriefPendingResponse.brief_sent`.

**Steps:**
- [ ] Admin page: add `brief_sent_at` to `Project` interface; header badge "Borrador · no enviado" / "Enviado al cliente"; button "Confirmar y enviar al cliente ↗" (only when unsent + active; confirm via `window.confirm`; on success update project state + message). Per-question expanded panel: "Editar" toggles inline textarea (maxLength 500) + category select + Guardar/Cancelar → PATCH, update item in state; "Eliminar" → `window.confirm` (wording warns responses will be deleted when the question has any) → DELETE with `force=true` when answered, remove from state. Keep existing editorial classes, 44px targets, Spanish copy.
- [ ] Portal page: add `brief_sent_at` to `Project` interface; when project loaded and `brief_sent_at` null → render waiting card ("El estudio está preparando tu brief. Podrás responder cuando el equipo lo confirme y envíe.") instead of questionnaire + flow actions; references section stays. Guard autosave/upload handlers against the unsent state.
- [ ] Verify: `cd frontend && npx tsc --noEmit && npm run lint` (or `next lint`) pass; `npm run build` succeeds.

### Task 4: Frontend — auth pages (after Task 2)

**Files:**
- Modify: `frontend/app/login/page.tsx`, `frontend/app/admin/users/page.tsx`, `frontend/app/admin/layout.tsx`, `frontend/app/portal/layout.tsx`
- Create: `frontend/app/change-password/page.tsx`

**Interfaces (Consumes from Task 2):** `Token.must_change_password`; `UserRead.must_change_password`; `POST /api/v1/auth/password-reset-request {email}`; `POST /api/v1/auth/change-password {current_password, new_password}`; `GET /api/v1/admin/password-reset-requests?status=pending`; `POST /api/v1/admin/password-reset-requests/{id}/approve` (body `{}` or `{temporary_password}`) → `{temporary_password, user}`; `POST .../{id}/reject`.

**Steps:**
- [ ] Login page: after login, if `data.must_change_password` → `router.push("/change-password")` (before role routing). Add "¿Olvidaste tu contraseña?" toggle → email form → POST reset-request → generic success message ("Si la cuenta existe, tu solicitud fue enviada al estudio. El equipo te contactará."). Brutalist style (`border-border`, `btn-brutal`, 44px).
- [ ] Create `/change-password` page: same shell as login; requires token (else redirect `/login`); fields current/new/confirm (min 8); client-side confirm match; POST change-password; on success re-fetch `/auth/me` and route CLIENT→`/portal` else `/admin`; show `extractDetail` errors (403 `password_change_required` must NOT redirect away — `apiFetch` only redirects on 401).
- [ ] Both layouts: after `me` loads, if `me.must_change_password` → `router.replace("/change-password")` before role routing.
- [ ] Admin users page: pending-requests panel above the user grid (email, requested_at, "Asignar temporal" → approve with `{}`, show returned `temporary_password` once in a copyable monospace box with warning to share it securely; "Rechazar" → reject). Optional custom-password input per request. User rows: badge "Cambio de contraseña pendiente" when `user.must_change_password`. Refresh lists after actions.
- [ ] Verify: `cd frontend && npx tsc --noEmit && npm run lint` pass; `npm run build` succeeds.

### Task 5: Full verification (orchestrator)

- [ ] `python -m pytest tests/backend -q` → all pass.
- [ ] `cd frontend && npm run build` → succeeds.
- [ ] Review whole branch against spec (orchestrator); tasks were committed by their implementers.
