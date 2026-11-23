# Moodboards Múltiples por Proyecto + Límite 6–10 Imágenes + 3 Layouts Editoriales — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear y gestionar **varios moodboards por proyecto** (con título, nota curatorial y layout persistente), limitar cada board a **6–10 imágenes** (tope estricto de 10, mínimo recomendado no bloqueante) y renderizar **tres composiciones editoriales** (`editorial_collage`, `atelier_grid`, `monograph_strip`) en admin y portal, manteniendo RBAC y aislamiento entre proyectos intactos.

**Architecture:** Nueva entidad `Moodboard` (tabla `moodboards`) asociada a `project_id`; `moodboard_items` gana `moodboard_id` (nullable + backfill a un board por defecto "Moodboard 01", patrón 0007). Endpoints board-scoped bajo el router existente `/projects/{project_id}/moodboard`; el upload plano `POST ""` se elimina en favor de `POST /boards/{board_id}/items` con validación del tope de 10 **antes** de escribir en storage. El frontend (admin + portal) reescribe sus páginas sobre un componente compartido `MoodboardComposition` que renderiza los 3 layouts como láminas limpias (sin bordes pesados alrededor de las imágenes).

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, pytest + pytest-asyncio (strict) + aiosqlite; Next.js App Router (TypeScript), Tailwind, `apiFetch`/`extractDetail`/`useProtectedMediaUrl`.

**Spec:** Solicitud del usuario "Tarea: Múltiples Moodboards por Proyecto, Carga de Imágenes (6–10 por Board) y Selector de Layouts Editoriales" (2026-11-23). Decisiones de diseño y enfoques en "Design Decisions".

## Design Decisions (enfoques considerados y llamadas de este plan)

1. **Agrupación de boards** — Alternativas: (a) tabla agrupadora `moodboards` (elegida: permite título/nota curatorial/layout/orden por board y backfill limpio), (b) columna de etiqueta denormalizada en `moodboard_items` (descartada: no permite nota curatorial ni layout por grupo), (c) board implícito único (status quo, no cumple el objetivo).
2. **Upload plano `POST /moodboard`** — se **elimina** y se reemplaza por `POST /moodboard/boards/{board_id}/items` (el tope de 10 exige alcance de board). `GET /moodboard` se **conserva** como agregado plano legado (añade `moodboard_id` al shape) para no romper lecturas existentes. Los únicos consumidores del POST eran las dos páginas frontend y los tests, todos actualizados en este plan.
3. **Visibilidad del cliente** — NO se añade flag de visibilidad por board: se mantiene la semántica actual (el CLIENT miembro ve todos los boards de su proyecto y reacciona; los writes siguen siendo solo equipo + proyecto ACTIVE). Non-goal documentado; un toggle por board sería follow-up.
4. **`moodboard_id` nullable** (patrón de 0007): la migración añade la columna nullable + FK, hace backfill creando "Moodboard 01" por proyecto con ítems, y el API siempre asigna el board en escrituras nuevas. Sin NOT NULL forzado (ADD COLUMN portable PostgreSQL/SQLite).
5. **Mínimo 6 imágenes** — recomendación visual, NO bloqueo: el backend expone `item_count` por board; el frontend advierte por debajo de 6 y solo bloquea/propaga error en el tope 10 (409).

## Global Constraints

- Roles exactos: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`. Todo endpoint protegido valida autenticado + `is_active` + rol + membresía/propiedad con los deps existentes de `backend/app/api/deps.py`: writes de boards y upload → `require_team_member` + `require_active_project`; lecturas → `require_project_access_from_path`; reacciones → CLIENT (sin cambios).
- Exclusiones de dominio (AGENTS.md): nada de ejecución de obra/inventario; el moodboard es composición de diseño.
- Migración `0013` idempotente con patrón inspector (sin `IF NOT EXISTS`), revisión `"0013"`, down `"0012"`; portable PostgreSQL/SQLite (patrón de `0010`/`0012`; ADD COLUMN estilo `0007`).
- Enum de layout exacto: `editorial_collage`, `atelier_grid`, `monograph_strip`; default `editorial_collage`; `native_enum=False` + `values_callable` (patrón `ReactionType`).
- Tope: máx **10** imágenes por board → 409 `"Moodboard already has 10 images"` ANTES de `storage.save`; mín **6** = solo indicación UI, nunca bloqueo.
- Auditoría vía `log_audit`: acciones nuevas `moodboard.board_create`, `moodboard.board_update`, `moodboard.board_delete`; `moodboard.item_create` añade `moodboard_id` a metadata.
- Storage sin cambios: `LocalStorage` + `MOODBOARD_CONTENT_TYPES` (solo imágenes), 10 MiB.
- UI Tactile Brutalism: radio 0, sin sombras/degradados, `#F9FAF4`/`#111111`/`#EFECE6`, tipografías Amiri (`type-title`, `type-editorial`), Arial (`type-ui`), Atkinson mono (`label-mono` 11px), mobile-first (colapsa a 1 col), targets ≥44px, sin interacciones solo-hover, overlay con `touchAction: "pinch-zoom"`, copy en español. Las composiciones NO usan `grid-brutal` ni bordes alrededor de las imágenes (lámina limpia con respiros generosos).
- Tests: `python -m pytest tests/backend/... -v` desde la raíz del repo, async strict; frontend: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`.
- Commit por task (conventional commits, p. ej. `feat(moodboard): ...`); no editar archivos fuera de la lista del task.

## Review Focus

1. La 11ª imagen → 409 y **ningún archivo extra** en storage (cap evaluado antes de `storage.save`) → Task 1, `test_upload_cap_10_then_409` (assert de conteo de archivos en el directorio media).
2. `DELETE /boards/{id}` elimina reacciones + archivos + ítems del board y **no toca** ítems de otros boards del mismo proyecto → Task 1, `test_delete_board_cascades`.
3. `board_id` del proyecto B usado bajo paths de A → 404 `"Moodboard not found"` indistinguible (aislamiento) → Task 1, extensión de `test_cross_project_item_ids_404`.
4. CLIENT nunca crea/edita/elimina boards ni sube imágenes (solo ve y reacciona); usuario inactivo y sin token bloqueados en las rutas nuevas → Task 1, `test_client_cannot_create_board_403`, `test_client_cannot_patch_or_delete_board_403`, `test_inactive_user_403`, `test_unauthenticated_401`.
5. Ítems legacy (`moodboard_id` NULL) tras el backfill no rompen `GET ""` ni las listas por board → Task 1, `test_migration_0013_moodboard_boards.py` (backfill sin duplicados) + `test_download_missing_file_404` sigue pasando sin `moodboard_id`.
6. Frontend con board a tope: botón de subida deshabilitado **y** manejo del 409 backend (condición de carrera) → Task 2, steps de la página admin.

---

### Task 1: Backend — entidad Moodboard, migración 0013, endpoints board-scoped y tests

**Files:**
- Create: `backend/app/models/moodboard.py`, `backend/alembic/versions/0013_moodboard_boards.py`, `tests/backend/test_migration_0013_moodboard_boards.py`
- Modify: `backend/app/models/moodboard_item.py`, `backend/app/models/__init__.py`, `backend/app/schemas/moodboard.py`, `backend/app/api/v1/endpoints/moodboard.py`, `tests/backend/test_moodboard.py`, `tests/backend/test_project_isolation.py`, `docs/architecture.md` (tabla de datos §4.3, tabla de endpoints ~líneas 647–664, acciones auditadas ~líneas 428–432)

**Interfaces (Produces):**

- `backend/app/models/moodboard.py`:
  ```python
  class MoodboardLayout(str, enum.Enum):
      EDITORIAL_COLLAGE = "editorial_collage"
      ATELIER_GRID = "atelier_grid"
      MONOGRAPH_STRIP = "monograph_strip"

  class Moodboard(Base):  # __tablename__ = "moodboards"
      # id UUID pk default uuid4
      # project_id UUID FK projects.id, index=True
      # title String(255) NOT NULL
      # curatorial_note Text NULL
      # layout_variant SAEnum(MoodboardLayout, name="moodboard_layout",
      #     native_enum=False, values_callable=lambda m: [x.value for x in m])
      #     NOT NULL, server_default="editorial_collage"
      # position Integer NOT NULL, server_default="0"
      # created_by UUID FK users.id
      # created_at / updated_at DateTime(timezone=True), defaults datetime.now(timezone.utc)
  ```
  Exportar `Moodboard` + `MoodboardLayout` en `backend/app/models/__init__.py`.
- `MoodboardItem.moodboard_id: Mapped[uuid.UUID | None]` — FK `moodboards.id`, `index=True`, nullable (patrón 0007: el API siempre lo asigna; el backfill cubre los legacy).
- Schemas (`backend/app/schemas/moodboard.py`):
  ```python
  class MoodboardCreate(BaseModel):
      model_config = ConfigDict(extra="forbid")
      title: str = Field(min_length=1, max_length=255)
      curatorial_note: str | None = Field(default=None, max_length=2000)
      layout_variant: MoodboardLayout = MoodboardLayout.EDITORIAL_COLLAGE
      position: int | None = None  # None → max(position)+1 o 0

  class MoodboardUpdate(BaseModel):
      model_config = ConfigDict(extra="forbid")
      title: str | None = Field(default=None, min_length=1, max_length=255)
      curatorial_note: str | None = Field(default=None, max_length=2000)
      layout_variant: MoodboardLayout | None = None
      position: int | None = None

  class MoodboardRead(BaseModel):  # from_attributes=True
      id: UUID; project_id: UUID; title: str; curatorial_note: str | None
      layout_variant: MoodboardLayout; position: int; item_count: int = 0
      created_by: UUID; created_at: datetime; updated_at: datetime
  ```
  `MoodboardItemRead` += `moodboard_id: UUID | None = None`.
- Rutas (mismo router, prefijo `/api/v1/projects/{project_id}/moodboard`), con helper `_get_scoped_board(db, project_id, board_id) -> Moodboard` (filtra id + `project_id`; 404 `"Moodboard not found"`):
  - `GET /boards` → `list[MoodboardRead]` — cualquier miembro; orden `position, created_at`; `item_count` por GROUP BY.
  - `POST /boards` → 201 `MoodboardRead` — equipo, ACTIVE; `position` default `max+1` o `0`; audit `moodboard.board_create` metadata `{project_id, title, layout_variant}`.
  - `PATCH /boards/{board_id}` → 200 `MoodboardRead` — equipo, ACTIVE; aplica SOLO `payload.model_fields_set` (`{}` = no-op; `curatorial_note: null` explícito limpia la nota); audit `moodboard.board_update` metadata `{project_id, fields: sorted(...)}`.
  - `DELETE /boards/{board_id}` → 204 — equipo, ACTIVE; borra reacciones (delete explícito), `storage.delete` de cada ítem, los ítems y el board; audit `moodboard.board_delete` metadata `{project_id, item_count}`.
  - `GET /boards/{board_id}/items` → `list[MoodboardItemRead]` con conteos y `my_reaction` — cualquier miembro; orden `sort_order, created_at` (reutilizar la lógica de conteos de `list_moodboard_items`, extraída a helper).
  - `POST /boards/{board_id}/items` → 201 multipart (`file`, `title`, `description?`, `sort_order=0`) — equipo, ACTIVE; cuenta ítems del board; `>= 10` → 409 `"Moodboard already has 10 images"` ANTES de `storage.save`; asigna `moodboard_id`; audit `moodboard.item_create` metadata += `moodboard_id`.
  - `GET ""` se conserva (lista plana de todos los boards, orden `sort_order, created_at`; el shape añade `moodboard_id`).
  - `POST ""` se ELIMINA (ruptura documentada; consumidores actualizados en este plan).
  - Rutas de ítem/reacción sin cambios: `DELETE /items/{item_id}`, `GET /items/{item_id}/file`, `POST/DELETE/GET /items/{item_id}/reactions`.

**Steps:**

- [ ] **Step 1: Escribir tests fallando** en `tests/backend/test_moodboard.py`:
  - Helpers: `create_board(client, project_id, token, *, title="Moodboard 01", curatorial_note=None, layout_variant=None)` → POST `/moodboard/boards`; `upload_piece(..., board_id=None)` → si `board_id is None` crea primero "Moodboard 01" y sube a `/moodboard/boards/{board_id}/items` (los tests existentes siguen funcionando sin cambios en sus call-sites).
  - Tests nuevos: `test_create_board_201` (defaults position 0, layout `editorial_collage`, `item_count 0`; audit `moodboard.board_create`); `test_second_board_position_and_list_order` (2 boards → positions 0 y 1; GET /boards ordenado); `test_client_cannot_create_board_403` (`"Insufficient permissions"`); `test_unassigned_collaborator_create_board_403` (`"No access to this project"`); `test_patch_board_fields_and_layout` (PATCH title/note/layout → 200 y persiste en GET; `{"curatorial_note": null}` limpia; `{}` no-op; layout inválido → 422; board desconocido → 404; audit `moodboard.board_update`); `test_client_cannot_patch_or_delete_board_403`; `test_upload_cap_10_then_409` (10 subidas → 201; 11ª → 409 `"Moodboard already has 10 images"`; conteo de archivos en `media_storage.root` sin cambios tras el 409); `test_upload_under_6_allowed` (3 subidas → 201; `item_count == 3` — el mínimo 6 nunca bloquea); `test_board_items_isolated` (subida a board A visible en `GET /boards/A/items`, ausente en `/boards/B/items`; `GET ""` muestra ambos); `test_delete_board_cascades` (board con ítems + reacciones de cliente → 204; reacciones/ítems/archivos eliminados; board B del mismo proyecto intacto; audit `moodboard.board_delete`); `test_board_routes_on_draft_409` (proyecto DRAFT: POST/PATCH/DELETE board y upload → 409 `"Project is not active"`; GET /boards → 200); extender `test_inactive_user_403` (GET /boards con token inactivo → 403) y `test_unauthenticated_401` (GET/POST /boards y POST /boards/{uuid}/items sin token → 401).
- [ ] **Step 2: Verificar fallo:** `python -m pytest tests/backend/test_moodboard.py -x -v` → FAIL (rutas/entidad inexistentes: 404/405 en lugar de 201).
- [ ] **Step 3: Implementar backend:** `models/moodboard.py` (+ registro en `models/__init__.py`), columna `moodboard_id` en `moodboard_item.py`, schemas, y endpoints en `endpoints/moodboard.py` (helper `_get_scoped_board`; extraer los conteos de reacciones a helper compartido entre `GET ""` y `GET /boards/{board_id}/items`; eliminar `POST ""`). Migración `0013_moodboard_boards.py`: create_table `moodboards` si no existe (inspector) + índice `ix_moodboards_project_id`; ADD COLUMN `moodboard_id` a `moodboard_items` si falta (nullable + `REFERENCES moodboards(id)`, portable); backfill con tablas Core (`sa.table`/`sa.column`, patrón 0007): por cada `project_id` con ítems `moodboard_id IS NULL` → reutilizar board existente del proyecto o insertar "Moodboard 01" (layout `editorial_collage`, position 0, `created_by` = `created_by` del ítem más antiguo, timestamps now UTC) y UPDATE de los ítems. Downgrade: columna + tabla con guardas inspector.
- [ ] **Step 4: Verificar:** `python -m pytest tests/backend/test_moodboard.py -v` → PASS.
- [ ] **Step 5: Extender `tests/backend/test_project_isolation.py`:** en `FOREIGN_ENDPOINTS` reemplazar el param `moodboard-upload` por `("POST", "/moodboard/boards/{board_id}/items", None, "moodboard-upload", id="moodboard-board-upload")` y añadir: `moodboard-boards-list` (GET `/moodboard/boards`), `moodboard-board-create` (POST `/moodboard/boards`, body `{"title": "Board ajeno"}`), `moodboard-board-patch` (PATCH `/moodboard/boards/{board_id}`, body `{"layout_variant": "atelier_grid"}`), `moodboard-board-delete` (DELETE `/moodboard/boards/{board_id}`), `moodboard-board-items` (GET `/moodboard/boards/{board_id}/items`); el `.format(item_id=...)` añade `board_id=uuid.uuid4()`. En `test_cross_project_item_ids_404`: crear `foreign_board` en B (`Moodboard(project_id=other_project.id, title="Board ajeno", ...)`) y verificar bajo paths de A: `GET /boards/{id}/items`, `PATCH /boards/{id}`, `DELETE /boards/{id}`, `POST /boards/{id}/items` → 404 `"Moodboard not found"`, y B intacto tras las llamadas. En `test_assigned_collaborator_writes_in_a_201_in_b_403`: crear board en A (201), subir pieza (201); en B: POST /boards → 403 `"No access to this project"`.
- [ ] **Step 6: Verificar:** `python -m pytest tests/backend/test_project_isolation.py -v` → PASS.
- [ ] **Step 7: Escribir `tests/backend/test_migration_0013_moodboard_boards.py`** (mirror de `test_migration_0012_password_reset.py`: carga del módulo vía importlib, `MigrationContext` + `Operations`, SQLite in-memory con DDL de `moodboard_items` post-0012): upgrade crea `moodboards` + columna `moodboard_id`; backfill de dos proyectos con ítems NULL crea un "Moodboard 01" por proyecto y los enlaza (re-run sin duplicados); un proyecto sin ítems no genera board; downgrade elimina columna y tabla; doble upgrade idempotente.
- [ ] **Step 8: Verificar suite completa:** `python -m pytest tests/backend/test_migration_0013_moodboard_boards.py -v` → PASS; luego `python -m pytest tests/backend -q` → PASS (incluye `test_models_sprint3.py`, `test_rbac.py`, `test_storage.py`).
- [ ] **Step 9: Actualizar `docs/architecture.md`:** fila de `moodboards` en la tabla de datos + sección 4.3 (columnas), tabla de endpoints (nuevas rutas boards; `POST /moodboard` plano eliminado), acciones de auditoría (`board_create/update/delete`), nota del límite 6–10 y del backfill "Moodboard 01".
- [ ] **Step 10: Commit:** `git add` de los archivos del task y `git commit -m "feat(moodboard): multiple boards per project with 6-10 image cap and layout variants"`.

### Task 2: Frontend — componente de composición compartido + página admin

**Files:**
- Create: `frontend/components/MoodboardComposition.tsx`
- Modify: `frontend/app/admin/projects/[projectId]/moodboard/page.tsx`

**Interfaces:**
- Consumes (Task 1): rutas boards + shapes `MoodboardRead`/`MoodboardItemRead` (JSON sobre `apiFetch`).
- Produces (Task 3 consume):
  ```tsx
  export type MoodboardLayout = "editorial_collage" | "atelier_grid" | "monograph_strip";

  export interface MoodboardItemData {
    id: string; moodboard_id: string | null; title: string;
    description: string | null; like_count: number; dislike_count: number; comment_count: number;
  }

  export function MoodboardComposition(props: {
    layout: MoodboardLayout;
    projectId: string;
    board: { title: string; curatorial_note: string | null };
    items: MoodboardItemData[];
    renderFooter: (item: MoodboardItemData, index: number) => React.ReactNode;
  }): React.ReactElement;
  ```
- `MoodboardComposition` renderiza primero la **cabecera de lámina**: `label-mono` "MOODBOARD — POMME STUDIO", `type-title` con `board.title`, `type-editorial` con la nota (si existe), separada por `.rule`. Luego cada ítem en un `PieceFrame` interno: imagen vía `useProtectedMediaUrl("/api/v1/projects/${projectId}/moodboard/items/${item.id}/file")` a tamaño natural (sin forzar aspect-ratio), botón que abre overlay a pantalla completa con `touchAction: "pinch-zoom"` y botón "Cerrar" (paridad con el overlay existente), numeración `label-mono` (`01.`, `02.`…), título `type-ui`, descripción `type-editorial`, y `renderFooter(item, index)` bajo la pieza. **Sin bordes ni `grid-brutal` alrededor de las imágenes.**
- Layouts (colapsan a 1 col en móvil):
  - `editorial_collage`: grid 12 columnas en md+, spans por índice en ciclo `[7,5,4,8,6,6,5,7,8,4]`, `gap-6 md:gap-8`.
  - `atelier_grid`: uniforme `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, `gap-8`.
  - `monograph_strip`: índice 0 a ancho completo con etiqueta `label-mono` "IMAGEN PRINCIPAL"; resto en tira (`lg:grid-cols-4`; móvil: scroll horizontal `snap-x`), `gap-6`.
- Página admin: estado `boards: MoodboardBoard[]` (shape `MoodboardRead`), `activeBoardId`, `items` del board activo (`GET /boards` + `GET /boards/{id}/items`); selector de boards numerado (`01`, `02`… botones `btn-brutal` con `aria-pressed`, ≥44px); formulario "Nuevo moodboard" (título requerido, nota curatorial opcional, select de layout con labels en español: "Lámina editorial · Collage asimétrico" / "Retícula de estudio · Mosaico modular" / "Banda focal + Secuencia"); contador `label-mono` `"{n} / 10 IMÁGENES"` y aviso bajo 6 (`"Faltan {6-n} imágenes para completar la lámina (mínimo recomendado: 6)"`, `type-ui`, no bloquea); switcher de layout (3 botones `aria-pressed` → PATCH, persistente); edición inline de título/nota (PATCH); eliminar board en dos pasos (paridad con piezas); subida al board activo deshabilitada a 10 con mensaje `"Este moodboard ya tiene el máximo de 10 imágenes"` **y** manejo del 409 del backend; footer admin por pieza: eliminar (dos pasos) + comentarios (GET reactions), conservando `apiFetch`/`extractDetail`.

**Steps:**

- [ ] **Step 1: Implementar `frontend/components/MoodboardComposition.tsx`** según Interfaces (hook `useProtectedMediaUrl` de `frontend/lib/useProtectedMediaUrl.ts`; overlay con cierre por botón "Cerrar", paridad del existente).
- [ ] **Step 2: Reescribir `frontend/app/admin/projects/[projectId]/moodboard/page.tsx`** sobre las rutas boards (interfaces TS locales: `MoodboardBoard`, `MoodboardItem` con `moodboard_id`), conservando la lógica de eliminación en dos pasos y de comentarios del `MoodboardPiece` existente como `renderFooter`. Al cargar: seleccionar automáticamente el primer board; si el proyecto no tiene boards → estado vacío "Todavía no hay moodboards. Crea el primero." con el formulario "Nuevo moodboard" accesible (la subida requiere board activo).
- [ ] **Step 3: Verificar:** `cd frontend && npx tsc --noEmit && npm run lint && npm run build` → PASS.
- [ ] **Step 4: Commit:** `git commit -m "feat(admin): multi-board moodboard with editorial layout selector"`.

### Task 3: Frontend — página portal (cliente)

**Files:**
- Modify: `frontend/app/portal/projects/[projectId]/moodboard/page.tsx`, `docs/architecture.md` (~líneas 953–966: descripción de páginas portal/admin moodboard)

**Interfaces:**
- Consumes (Task 1): rutas boards (solo lectura + reacciones existentes `POST/DELETE /items/{id}/reactions`).
- Consumes (Task 2): `MoodboardComposition`, `MoodboardItemData`, `MoodboardLayout`.

**Steps:**

- [ ] **Step 1: Reescribir la página portal:** `GET /boards` → pestañas numeradas de solo lectura (`btn-brutal` con `aria-pressed`, ≥44px); cabecera del board activo vía `MoodboardComposition` (título + nota); contador `label-mono` `"{n} / 10 IMÁGENES"` (sin avisos de equipo); `renderFooter` = controles de reacción existentes (Me gusta / No me gusta / Comentar / Quitar reacción, comentario propio mostrado), sin controles de equipo. Vacío: "Todavía no hay moodboards." / "Todavía no hay piezas en este moodboard."
- [ ] **Step 2: Verificar:** `cd frontend && npx tsc --noEmit && npm run lint && npm run build` → PASS.
- [ ] **Step 3: Actualizar `docs/architecture.md`** (secciones de portal/admin frontend: moodboard multi-board con layouts).
- [ ] **Step 4: Commit:** `git commit -m "feat(portal): multi-board moodboard view with editorial layouts"`.
