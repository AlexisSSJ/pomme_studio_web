# Brief Multimodal + Plantilla + Notificaciones + Normalización — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Respuestas multimodales (voz→texto, texto, hasta 2 imágenes) por pregunta de brief, plantilla automática al crear proyecto, notificación al equipo al completarse el brief, y normalización idempotente de briefs heredados en producción (Railway).

**Architecture:** Tabla hija `brief_item_images` para el límite de 2 imágenes (columnas legacy sincronizadas con la primera); servicio de transcripción HTTP configurable con fallback limpio sin API key; módulo de plantillas por `ServiceType` invocado desde `create_project`; tabla `notifications` + servicio `notify_project_team` disparado en la transición a COMPLETED; SQL de normalización idempotente compartido entre migración Alembic (corre en deploy Railway) y script CLI.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (Postgres/asyncpg en prod, SQLite en tests), Pydantic v2, httpx; Next.js App Router + Tailwind (Tactile Brutalism).

**Spec:** este plan es la spec aprobada por el usuario (gate AGENTS.md, respuesta "Si" del 2026-11-23).

## Global Constraints

- Dominio: solo diseño de branding/interiores, dirección creativa, documentación ejecutiva y FF&E. PROHIBIDO contenido de ejecución de obra, montaje físico, compras de construcción o cuadrillas (incluye textos de plantillas de brief).
- RBAC en cada endpoint protegido: usuario autenticado + `is_active == True` + rol permitido + membresía/propiedad sobre `project_id`. Deps existentes: `require_roles`, `require_team_member`, `require_active_project`, `get_membership`, `require_project_access_from_path` (en `backend/app/api/deps.py` y `brief.py`).
- UI Tactile Brutalism: fondo `#F7F7F5`, tinta/bordes `#111111`, superficie `#EFECE6`; `border-radius: 0px`; bordes `1px solid #111111`; grids `gap: 1px` sobre fondo `#111111` con celdas `#F7F7F5`; SIN `box-shadow` ni degradados; labels monospace 11px `letter-spacing: 0.08em` en mayúsculas; numeración `01`, `02`; áreas táctiles ≥44×44px; mobile-first 375px, retículas colapsan a `1fr`; sin dependencia de `hover`. Clases existentes: `.btn-brutal`, `.label-mono`, `.grid-brutal`.
- Storage: `LocalStorage` (`backend/app/services/storage.py`), `MAX_UPLOAD_BYTES = 10 MiB`, whitelist `BRIEF_RESPONSE_CONTENT_TYPES`, keys `<project_id>/<uuid>.<ext>`, nunca confiar en nombres del cliente.
- Migraciones Alembic: cabeza actual `0006_sprint5_drafts_ffe_handover.py`; nuevas revisiones encadenadas 0007→0008→0009; TODA migración de datos debe ser idempotente (se ejecuta en cada deploy: `alembic upgrade head && python scripts/seed_admin.py && uvicorn …`).
- Tests: pytest async estricto (`@pytest.mark.asyncio`), fixtures existentes en `tests/backend/conftest.py` (`media_storage`, `active_project`, `client_token`, `collaborator_token`, etc. — verificar nombres reales antes de usar).
- Enums de brief en DB usan valores minúscula (`question`, `reference`, `branding`, `interior`, `general`, `pending`, `in_progress`, `completed`); `ServiceType`: `branding`, `interior`, `integral`.
- Auditoría: `log_audit(db, actor_user_id=…, action=…, entity_type=…, entity_id=…, metadata=…)` de `backend/app/services/audit.py`.
- No introducir dependencias nuevas sin justificación; `httpx>=0.27` ya está en `backend/requirements.txt`.
- Commits frecuentes por tarea, mensajes convencionales (`feat:`, `fix:`, `test:`, `docs:`).

## Review Focus

1. 3ª imagen o imagen de otro proyecto → 409/404, nunca 500 (Task 1).
2. Re-subida de audio no borra la respuesta de texto ni re-notifica (Tasks 2 y 4).
3. Brief heredado con enums en mayúsculas o prompt nulo → lista y portal renderizan sin 500 (Task 5).
4. Migración ejecutada 2 veces en producción → sin duplicados de imágenes ni notificaciones (Tasks 1 y 5).
5. Miembro desactivado (`is_active=False`) o de otro proyecto → no recibe notificación ni ve datos (Task 4).

## Interfaces transversales (producidas/consumidas entre tareas)

- Task 1 produce: modelo `BriefItemImage` (`backend/app/models/brief_item_image.py`), schema `BriefImageRead {id: UUID, url: str, position: int, content_type: str | None}`, campo `BriefItemRead.images: list[BriefImageRead]`, endpoints `DELETE /projects/{pid}/brief/items/{iid}/images/{image_id}` y `GET /projects/{pid}/brief/items/{iid}/images/{image_id}/media`.
- Task 2 produce: `async def transcribe_audio(data: bytes, content_type: str) -> str | None` en `backend/app/services/transcription.py`; settings `TRANSCRIPTION_PROVIDER/API_KEY/API_URL/MODEL`.
- Task 3 produce: `async def seed_brief_from_template(db: AsyncSession, project: Project, actor_user_id: UUID) -> list[BriefItem]` en `backend/app/services/brief_templates.py` (NO hace commit).
- Task 4 produce: `async def notify_project_team(db: AsyncSession, project_id: UUID, event_type: str, payload: dict, exclude_user_id: UUID | None = None) -> list[Notification]` en `backend/app/services/notifications.py` (NO hace commit); modelo `Notification`; endpoints `GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`.
- Task 5 produce: `NORMALIZATION_STATEMENTS: list[str]` en `backend/app/services/brief_normalization.py` (SQL puro idempotente, importable sin efectos).

---

### Task 1: Imágenes múltiples (hasta 2) por pregunta — backend

**Files:**
- Create: `backend/app/models/brief_item_image.py`
- Create: `backend/alembic/versions/0007_brief_item_images.py`
- Modify: `backend/app/models/__init__.py` (registrar modelo; verificar cómo se exportan los demás)
- Modify: `backend/app/schemas/brief.py` (añadir `BriefImageRead`; `BriefItemRead.images`)
- Modify: `backend/app/api/v1/endpoints/brief.py` (upload, nuevos endpoints de imagen, media legacy)
- Test: `tests/backend/test_brief.py`

**Interfaces:**
- Consumes: `LocalStorage.save/resolve/delete`, `BRIEF_RESPONSE_CONTENT_TYPES`, deps RBAC existentes, `log_audit`.
- Produces: ver Interfaces transversales. `BriefItemImage`: `id` UUID PK default uuid4, `item_id` FK `brief_items.id` NOT NULL index, `storage_key` String(500) NOT NULL, `content_type` String(100) nullable, `size_bytes` Integer nullable, `position` Integer NOT NULL, `created_at` DateTime(tz) default now; `UniqueConstraint("item_id", "position", name="uq_brief_item_image_position")`.

**Comportamiento exacto:**
- `upload_response_file` con imagen: contar `BriefItemImage` del ítem; si ≥2 → HTTP 409 "Maximum of 2 images per question"; si no, borrar archivo de la imagen legacy SOLO si no está ya en la tabla (migración la copió), insertar fila con `position` = max+1 (1 o 2), sincronizar `item.image_storage_key`/`item.image_url` con la imagen de `position=1`, `item.content_type` real, `response_type="image"`, status COMPLETED (como hoy).
- `DELETE …/images/{image_id}`: CLIENT + membresía + proyecto activo; 404 si la imagen no pertenece al ítem/proyecto; `storage.delete(key)`; re-numerar positions restantes (1..n); re-sincronizar legacy fields (si no quedan imágenes → legacy a None); si el ítem queda sin ninguna respuesta (texto/transcripción/audio/imagen) → status PENDING; audit `brief.image_delete`.
- `GET …/images/{image_id}/media`: acceso por proyecto (`require_project_access_from_path`), `FileResponse` con el `content_type` almacenado (fallback `application/octet-stream`); 404 si archivo falta.
- `GET …/media` legacy: servir audio si `audio_storage_key`, si no la primera imagen; `media_type` desde `content_type` almacenado o derivado de la extensión, no hardcode.
- `BriefItemRead.images`: URLs `/api/v1/projects/{pid}/brief/items/{iid}/images/{image_id}/media`, ordenadas por position. `list_brief_items`, autosave responses y pending deben incluir `images` (poblar tras consulta; patrón existente de `progress` con `setattr`).
- Migración 0007: `down_revision` = revisión de 0006 (leer el archivo para el id exacto); crea tabla + índice + unique; copia idempotente: `INSERT INTO brief_item_images (id, item_id, storage_key, content_type, size_bytes, position, created_at) SELECT … FROM brief_items WHERE image_storage_key IS NOT NULL AND item_type='question' AND NOT EXISTS (SELECT 1 FROM brief_item_images WHERE item_id = brief_items.id)` con position=1, uuid generado (gen_random_uuid() en PG; usar enfoque compatible con SQLite si los tests corren migraciones — verificar cómo test_models_sprint3 valida migraciones y seguir ese patrón).

**Tests (nombres exactos, añadir a `tests/backend/test_brief.py`):**
- `test_upload_two_images_ok` — dos POST response-file con image/png → 200; GET brief lista `images` len 2, positions 1 y 2.
- `test_third_image_rejected_409` — tercera subida → 409; siguen 2 imágenes.
- `test_delete_image_resyncs_legacy` — borrar imagen 1 → restante pasa a position 1 y `image_url` legacy apunta a ella; borrar la última → `image_url` None.
- `test_image_media_download_content_type` — GET media de imagen subida como image/webp → header content-type image/webp.
- `test_image_upload_cross_project_404` — ítem de otro proyecto → 404.
- `test_collaborator_cannot_upload_response_403` — colaborador → 403 (comportamiento existente, preservar).
- `test_delete_image_cross_project_404`.

**Steps:**
- [ ] Leer `brief.py` completo, `conftest.py` y migración 0006 (id de revisión) antes de escribir código.
- [ ] Escribir los tests anteriores; correr `python3 -m pytest tests/backend/test_brief.py -q` y verificar que los nuevos FALLAN (rojo).
- [ ] Implementar modelo + migración + schemas + endpoints.
- [ ] Correr `python3 -m pytest tests/backend/test_brief.py tests/backend/test_models_sprint3.py -q` → todo verde.
- [ ] Correr suite completa `python3 -m pytest tests/backend -q` → sin regresiones.
- [ ] Commit: `feat(brief): allow up to two reference images per question with per-image endpoints`

### Task 2: Transcripción voz→texto configurable con fallback — backend

**Files:**
- Create: `backend/app/services/transcription.py`
- Modify: `backend/app/core/config.py` (settings nuevos)
- Modify: `.env.example` (raíz del repo — verificar ubicación real)
- Modify: `backend/app/api/v1/endpoints/brief.py` (`upload_response_file`, rama audio)
- Test: `tests/backend/test_brief.py`

**Interfaces:**
- Consumes: `settings` de `app.core.config`, httpx.
- Produces: `async def transcribe_audio(data: bytes, content_type: str) -> str | None`. Settings: `TRANSCRIPTION_PROVIDER: str = "openai"`, `TRANSCRIPTION_API_KEY: str = ""`, `TRANSCRIPTION_API_URL: str = "https://api.openai.com/v1/audio/transcriptions"`, `TRANSCRIPTION_MODEL: str = "whisper-1"`.

**Comportamiento exacto:**
- Sin API key (vacía) → return None inmediatamente, sin red, sin excepción.
- POST multipart a `TRANSCRIPTION_API_URL` con header `Authorization: Bearer <key>`, campos `model` y `file` (filename derivado de content_type vía `CONTENT_TYPE_EXTENSIONS`); timeout 30s; respuesta JSON campo `text`.
- Cualquier error (red, timeout, HTTP ≥400, JSON inválido) → log warning + return None. NUNCA propagar excepción al endpoint.
- En `upload_response_file` rama audio: si no llegó `transcription` en el Form → `text = await transcribe_audio(data, file.content_type)`; si text no vacío → guardar en `audio_transcription` Y `transcription`. El audio se guarda SIEMPRE aunque la transcripción falle. La respuesta de texto existente del ítem no se toca.
- Re-subir audio reemplaza el archivo de audio anterior (borrar key vieja vía `storage.delete`), no toca imágenes ni texto.

**Tests:**
- `test_audio_upload_transcribes_via_service` — monkeypatch de `transcribe_audio` (parchear donde se usa: `app.api.v1.endpoints.brief.transcribe_audio`) → respuesta con transcripción en ambos campos.
- `test_audio_upload_without_key_fallback_none` — settings sin key (monkeypatch), audio sube 200, transcripción None, archivo guardado.
- `test_audio_upload_service_error_still_saves_audio` — monkeypatch que devuelve None (simulando fallo) → 200, audio_url presente.
- `test_form_transcription_wins_over_service` — Form transcription="hola" + servicio parcheado que devolvería otra cosa → gana "hola", servicio no se llama.
- `test_audio_reupload_replaces_old_file` — subir 2 audios → solo el último archivo existe en media root; la respuesta de texto previa sigue intacta.

**Steps:**
- [ ] Tests en rojo → implementar → `python3 -m pytest tests/backend/test_brief.py -q` verde → suite completa verde.
- [ ] Commit: `feat(brief): configurable audio-to-text transcription with clean no-key fallback`

### Task 3: Plantilla automática de brief al crear proyecto — backend

**Files:**
- Create: `backend/app/services/brief_templates.py`
- Modify: `backend/app/api/v1/endpoints/admin_projects.py` (`create_project`, líneas ~62-99)
- Test: `tests/backend/test_admin_projects.py`

**Interfaces:**
- Consumes: `Project`, `ServiceType` (`app.models.lead`), `BriefItem`, `BriefItemType`, `BriefCategory`, `BriefStatus`, `log_audit`.
- Produces: `BRIEF_TEMPLATES: dict[ServiceType, list[tuple[str, BriefCategory]]]` + `async def seed_brief_from_template(db: AsyncSession, project: Project, actor_user_id: UUID) -> list[BriefItem]` — hace `db.add_all`, NO commit (el caller commitea). Si el proyecto ya tiene preguntas → no duplicar (return lista vacía).

**Contenido de plantillas (solo diseño; PROHIBIDO obra/montaje/ejecución/construcción/cuadrillas):**
- BRANDING (~8, categoría BRANDING + 1-2 GENERAL): esencia y valores de marca; público objetivo; personalidad/tONO de voz; competidores y diferenciación; referencias visuales admiradas; colores/tipografías preferidas o a evitar; aplicaciones previstas de la identidad (papelería, digital, señalética diseñada — no instalación); plazos y fechas clave del proyecto.
- INTERIOR (~8, categoría INTERIOR + 1-2 GENERAL): uso y actividades por espacio; estilo y atmósfera deseada; referencias visuales; paleta/materiales preferidos o a evitar; mobiliario existente a conservar (solo especificación FF&E); iluminación natural y ambiente deseado; presupuesto orientativo de FF&E (solo especificaciones, no compras de obra); restricciones del inmueble conocidas (solo como insumo de diseño).
- INTEGRAL (~12): unión de ambas (branding + interior) + 2 GENERAL sobre coherencia marca-espacio y prioridades.
- Todas `item_type=QUESTION`, `status=PENDING`, `created_by=actor_user_id`, `project_id=project.id`.

**Integración:** en `create_project`, tras crear miembros y antes del `commit`: `await seed_brief_from_template(db, project, current_user.id)`; tras commit, `log_audit(action="brief.template_seeded", entity_type="project", entity_id=project.id, metadata={"scope": project.scope_type.value, "questions": <count>})`.

**Tests:**
- `test_create_project_seeds_branding_template` — POST /admin/projects scope branding → GET brief del proyecto devuelve ≥6 preguntas, todas category branding/general, status pending.
- `test_create_project_seeds_interior_template` — análogo interior.
- `test_create_project_seeds_integral_template` — integral ≥10 preguntas, mezcla branding+interior.
- `test_template_questions_are_design_only` — ningún prompt contiene (case-insensitive): "obra", "montaje", "ejecución", "construcción", "cuadrilla", "instalación".
- `test_template_items_belong_to_project` — crear 2 proyectos; las preguntas de cada uno tienen su project_id (aislamiento).
- `test_seed_is_idempotent` — llamar `seed_brief_from_template` 2 veces → no duplica.

**Steps:**
- [ ] Tests en rojo → implementar → `python3 -m pytest tests/backend/test_admin_projects.py -q` verde → suite completa verde.
- [ ] Commit: `feat(projects): seed scope-aware design brief template on project creation`

### Task 4: Notificación al equipo al completarse el brief — backend

**Files:**
- Create: `backend/app/models/notification.py`
- Create: `backend/alembic/versions/0008_notifications.py`
- Create: `backend/app/services/notifications.py`
- Create: `backend/app/api/v1/endpoints/notifications.py`
- Modify: `backend/app/models/__init__.py`, router agregador de `backend/app/api/v1/` (verificar nombre exacto: `router.py` / `api.py`), `backend/app/schemas/` (crear `notification.py` con `NotificationRead {id, event_type, project_id, payload, read_at, created_at}`)
- Modify: `backend/app/api/v1/endpoints/brief.py` (trigger de completado)
- Test: crear `tests/backend/test_notifications.py`; añadir 1 test en `tests/backend/test_brief.py`

**Interfaces:**
- Consumes: `ProjectMember`, `ProjectRole`, `User.is_active`, `log_audit`, `compute_brief_progress` (existente en brief.py).
- Produces: modelo `Notification` (tabla `notifications`): `id` UUID PK, `user_id` FK users NOT NULL index, `project_id` FK projects nullable index, `event_type` String(100) NOT NULL, `payload` JSON (usar `sa.JSON` para compat SQLite/PG — verificar qué usa AuditLog y seguir el mismo tipo), `read_at` DateTime(tz) nullable, `created_at` DateTime(tz) default now. `notify_project_team(db, project_id, event_type, payload, exclude_user_id=None) -> list[Notification]` (add_all, NO commit).

**Comportamiento exacto:**
- Destinatarios: miembros del proyecto con `assigned_role ∈ {LEAD_DESIGNER, COLLABORATOR}` ∪ `project.lead_designer_id`; solo usuarios con `is_active=True`; deduplicar por user_id; excluir `exclude_user_id` (el cliente que completa).
- Trigger en `brief.py`: helper `async def _maybe_notify_completion(db, project_id, actor_id, was_completed: bool)` — capturar `was_completed` ANTES de aplicar cambios en `answer_question`, `_apply_autosave` y `upload_response_file`; tras commit, si `compute_brief_progress` da status COMPLETED y `was_completed` era False → `notify_project_team(event_type="brief.completed", payload={"project_id": str(pid), "project_title": …}, exclude_user_id=actor_id)` + `log_audit(action="brief.completed", entity_type="project", entity_id=pid, metadata={…})` + commit. Si ya estaba completado → NO re-notificar.
- Endpoints (router prefix `/notifications`, tags notifications): `GET ""` → lista del usuario actual (`require_roles` todos los roles o `get_current_active_user`), orden created_at desc, query param `unread_only: bool = False`, límite 50; `POST /{id}/read` → 404 si no es del usuario; `POST /read-all` → marca todas. Respuestas `NotificationRead`.
- Migración 0008: `down_revision` = revisión de 0007; crea tabla + índices; idempotente por diseño de alembic.

**Tests (`tests/backend/test_notifications.py`):**
- `test_completion_notifies_lead_and_collaborators` — proyecto con líder + colaborador + cliente; cliente completa todas las preguntas → 2 notificaciones (líder y colaborador), event_type brief.completed.
- `test_client_not_notified` — el cliente que completa no recibe notificación.
- `test_no_duplicate_notification_on_resave` — volver a guardar con brief ya completado → sigue habiendo las mismas notificaciones.
- `test_inactive_member_skipped` — colaborador con is_active=False → no recibe.
- `test_notifications_isolated_per_user` — usuario de otro proyecto no ve notificaciones ajenas (GET devuelve solo propias); POST read de notificación ajena → 404.
- `test_mark_read_and_read_all`.
- `test_completion_audit_logged` — existe AuditLog action="brief.completed".
- En `test_brief.py`: `test_completion_transition_triggers_notification` (vía autosave batch).

**Steps:**
- [ ] Tests en rojo → implementar → `python3 -m pytest tests/backend/test_notifications.py tests/backend/test_brief.py -q` verde → suite completa verde.
- [ ] Commit: `feat(brief): notify project team and audit when client completes the brief`

### Task 5: Normalización idempotente de briefs heredados + tolerancia — backend

**Files:**
- Create: `backend/app/services/brief_normalization.py`
- Create: `backend/alembic/versions/0009_normalize_brief_data.py`
- Create: `backend/scripts/normalize_briefs.py`
- Modify: `backend/app/models/brief_item.py` (`_missing_` tolerante en `BriefItemType` y `BriefCategory`, copiar patrón de `BriefStatus`)
- Test: crear `tests/backend/test_brief_normalization.py`

**Interfaces:**
- Consumes: engine/session de `app.db.session` (verificar nombres reales para el script), patrón CLI de `backend/scripts/seed_admin.py`.
- Produces: `NORMALIZATION_STATEMENTS: list[str]` — SQL puro, idempotente, compatible Postgres y SQLite (evitar funciones exclusivas de PG; usar `lower()`, `COALESCE`, `UPDATE … WHERE`, `INSERT … SELECT … WHERE NOT EXISTS`). Importable sin efectos secundarios.

**Statements (orden):**
1. Normalizar enums fuera de catálogo a minúscula: para cada columna (`item_type`, `category`, `status`): `UPDATE brief_items SET <col> = lower(<col>) WHERE lower(<col>) IN (<valores válidos>) AND <col> NOT IN (<valores válidos>)`.
2. `status` nulo o inválido → derivado: `UPDATE brief_items SET status = CASE WHEN (answer IS NOT NULL AND answer <> '') OR image_storage_key IS NOT NULL OR audio_storage_key IS NOT NULL OR COALESCE(transcription, audio_transcription, '') <> '' THEN 'completed' ELSE 'pending' END WHERE status IS NULL OR lower(status) NOT IN ('pending','in_progress','completed')`.
3. `category`/`item_type` nulos o inválidos tras paso 1 → `category='general'`; `item_type`: si tiene prompt → 'question', si tiene storage_key → 'reference', si no → 'question' con prompt placeholder (paso 4).
4. QUESTION con prompt nulo/vacío → `'[Pregunta pendiente de configurar]'` (preserva answer/archivos).
5. `response_type` nulo o vacío → derivado: audio si audio_storage_key, image si image_storage_key, text si answer no vacío; si nada → NULL se queda.
6. Sincronizar transcripciones: `UPDATE … SET transcription = audio_transcription WHERE transcription IS NULL AND audio_transcription IS NOT NULL` y viceversa.
7. Refuerzo copia imágenes legacy → `brief_item_images` position=1 donde no exista fila (mismo INSERT…SELECT…WHERE NOT EXISTS de 0007; para uuid usar hex random compatible — si PG/SQLite difieren, generar ids en Python dentro del script y en la migración usar `lower(hex(randomblob(16)))` solo si SQLite; RESOLVER: la migración 0007 ya hace la copia en PG; el statement 7 debe usar el mismo enfoque que 0007 para no divergir).

**Migración 0009:** `down_revision` = revisión de 0008; `upgrade()` ejecuta cada statement con `op.execute`; `downgrade()` no-op con docstring (reparación de datos no reversible, documentado).

**Script CLI `backend/scripts/normalize_briefs.py`:** patrón async de `seed_admin.py`; imprime conteo de anomalías ANTES (status inválidos, prompts nulos, response_type nulos con media, transcripciones desincronizadas, imágenes legacy sin fila hija), ejecuta los statements en una transacción, imprime conteo DESPUÉS; exit 0; seguro de re-ejecutar. Uso documentado: `railway run python scripts/normalize_briefs.py` (desde backend/).

**Tolerancia backend:** con `_missing_` en los 3 enums, filas heredadas no revientan al leer. Verificar que `GET /brief`, `GET /brief/pending` y autosave toleran filas con nulos (schemas ya tienen defaults).

**Tests (`tests/backend/test_brief_normalization.py`):** insertar filas "heredadas" con SQL crudo (session.execute(text(…))) saltando el ORM:
- `test_uppercase_status_normalized` — fila con status 'COMPLETED' → tras statements, 'completed'; GET brief del proyecto → 200.
- `test_null_prompt_repaired_preserving_answer` — question con prompt NULL y answer 'mi respuesta' → prompt placeholder, answer intacta.
- `test_null_response_type_derived` — fila con audio_storage_key y response_type NULL → 'audio'.
- `test_legacy_image_copied_to_images_table` — fila con image_storage_key sin hija → 1 fila en brief_item_images position 1.
- `test_normalization_idempotent_twice` — ejecutar statements 2 veces → mismo estado, sin duplicados.
- `test_legacy_row_listed_without_500` — GET /brief con fila heredada (uppercase category) → 200 y campo category válido.
- `test_pending_endpoint_tolerates_legacy_rows` — GET /brief/pending con filas heredadas → 200.

**Steps:**
- [ ] Tests en rojo → implementar → `python3 -m pytest tests/backend/test_brief_normalization.py -q` verde → suite completa verde.
- [ ] Commit: `fix(brief): idempotent normalization of legacy brief data with tolerant enums and CLI script`

### Task 6: Frontend portal — brief multimodal (2 imágenes + transcripción editable)

**Files:**
- Modify: `frontend/app/portal/projects/[projectId]/brief/page.tsx`
- Modify: `frontend/lib/api.ts` SOLO si hace falta (apiFetch ya soporta FormData y DELETE)

**Interfaces (backend ya implementado, Tasks 1-2):**
- `BriefItemRead.images: {id, url, position, content_type}[]` (url relativa `/api/v1/...`).
- Subida imagen: `POST /api/v1/projects/{pid}/brief/items/{iid}/response-file` FormData `file` → 409 si ya hay 2.
- Borrar: `DELETE /api/v1/projects/{pid}/brief/items/{iid}/images/{image_id}`.
- Audio: mismo response-file; respuesta incluye `audio_transcription`/`transcription` (puede ser null si no hay API key).
- Autosave existente: `PATCH …/items/{iid}/autosave` con `{answer, transcription, …}` (debounce 800ms ya implementado).

**Comportamiento exacto:**
- Type `BriefImage {id: string; url: string; position: number; content_type: string | null}`; estado por ítem desde `item.images`.
- Grid de hasta 2 previews: contenedor `grid grid-cols-2 gap-px bg-[#111111] border border-[#111111]`, celdas `bg-[#F7F7F5]`; cada imagen con botón eliminar (✕ o "ELIMINAR" label-mono, ≥44×44px, onClick — sin hover-dependency); zoom táctil simple (tap abre overlay a pantalla completa con borde 1px, tap cierra).
- Botón subir imagen: deshabilitado con 2, label mono `02/02 IMÁGENES`; con <2 muestra `0N/02`. Error 409 → mensaje visible "Máximo 2 imágenes por pregunta".
- Transcripción: tras subir audio, si viene transcripción → textarea editable precargada; si null → textarea vacía + aviso label-mono "TRANSCRIPCIÓN NO DISPONIBLE — ESCRIBE TU RESPUESTA"; el textarea se conecta al autosave existente (campo `transcription`).
- Render null-safe: `item.images ?? []`, `item.audio_url && …`, nunca acceder a campos de ítems incompletos sin guard.
- Estética: sin box-shadow, sin rounded, botones `.btn-brutal` existentes, mobile-first (375px, 1 columna).
- NO romper el flujo existente de texto/autosave ni la grabación MediaRecorder.

**Verificación:**
- [ ] `cd frontend && npx tsc --noEmit` → 0 errores.
- [ ] `npm run build` → build exitoso.
- [ ] Commit: `feat(portal): multimodal brief answers — two images with previews and editable transcription`

### Task 7: Frontend back-office — campana de notificaciones + vista admin del brief

**Files:**
- Create: `frontend/components/NotificationsBell.tsx`
- Create: `frontend/app/admin/projects/[projectId]/brief/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (integrar campana)
- Modify: layout del portal equivalente (verificar `frontend/app/portal/layout.tsx`) — misma campana para colaboradores

**Interfaces (backend Task 4):**
- `GET /api/v1/notifications?unread_only=true` → `NotificationRead {id, event_type, project_id, payload: {project_id, project_title}, read_at, created_at}[]`.
- `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`.
- Vista admin brief: `GET /api/v1/projects/{pid}/brief` (equipo tiene acceso de lectura — verificar deps del endpoint list; si el list actual restringe a cliente, ajustar en backend SOLO lo mínimo para permitir lectura al equipo con membresía).

**Comportamiento exacto:**
- `NotificationsBell`: botón ≥44×44 con ícono monocromático línea fina (SVG inline stroke 1.25) + badge numérico mono de no leídas; fetch al montar y al enfocar ventana (sin polling agresivo); panel desplegable borde 1px #111, fondo #F7F7F5, sin sombras; cada aviso: label-mono event + título de proyecto + fecha; tap marca leída y navega a `/admin/projects/{project_id}/brief` (o portal según rol); botón "MARCAR TODAS LEÍDAS".
- Vista admin brief (read-only): numeración `01`, `02` mono por pregunta, categoría como etiqueta, respuesta texto/transcripción, hasta 2 imágenes con zoom táctil (mismo patrón que Task 6), reproductor `<audio controls>`; estado del brief (progress) en cabecera; mobile-first 1fr.
- Enlace "BRIEF ↗" desde la navegación del proyecto admin existente (verificar `ProjectSidebar.tsx` / páginas de proyecto admin y añadir donde encaje el patrón).

**Verificación:**
- [ ] `cd frontend && npx tsc --noEmit` → 0 errores; `npm run build` → exitoso.
- [ ] Commit: `feat(admin): notifications bell and read-only multimodal brief view for the studio team`

### Task 8: Documentación + verificación integral

**Files:**
- Modify: `.env.example` (si Task 2 no lo actualizó completos: `TRANSCRIPTION_PROVIDER`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_API_URL`, `TRANSCRIPTION_MODEL` con comentarios)
- Modify: `README.md` (sección operaciones: normalización en deploy Railway vía `alembic upgrade head`; comando manual `railway run python scripts/normalize_briefs.py`; configuración de transcripción; límite 2 imágenes; notificaciones)

**Verificación final:**
- [ ] `python3 -m pytest tests/backend -q` → suite COMPLETA verde (reportar conteo).
- [ ] `cd frontend && npx tsc --noEmit && npm run build` → exitoso.
- [ ] `cd backend && alembic upgrade head` contra SQLite temporal si es viable (verificar env.py) o al menos `alembic history` sin errores de cadena 0006→0007→0008→0009.
- [ ] Commit: `docs: brief multimodal operations runbook (Railway normalization, transcription config)`
