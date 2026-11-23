# Moodboard: Carga por Drag & Drop / Paste + Comentarios Tipo Notion (solo hilos) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir imágenes al moodboard arrastrándolas o pegándolas con Ctrl/Cmd+V (sin formularios de título/descripción), y reemplazar el sistema de reacciones (like/dislike/comment) por **hilos de comentarios tipo Notion**: al hacer clic en una imagen se selecciona y se abre un panel lateral derecho donde cualquier miembro del proyecto (cliente y equipo) comenta.

**Architecture:** Nueva entidad `MoodboardComment` (hilo real: varios comentarios por usuario por imagen; la unicidad `(item, user)` de `MoodboardReaction` lo impide). La migración `0014` crea la tabla, **preserva** los comentarios existentes (backfill id-based desde reacciones `comment`) y elimina `moodboard_reactions` + sus endpoints (decisión del usuario, opción A: solo comentarios). Backend: `title` del upload pasa a opcional con auto-relleno (stem del filename → `Imagen {n}`); rutas `/items/{id}/comments` para cualquier miembro con proyecto ACTIVE. Frontend: `MoodboardComposition` gana selección (`onSelect`/`selectedItemId`) y pierde título/descripción/footer; nuevo componente compartido `MoodboardCommentPanel` (slide-over derecho en desktop, hoja completa en móvil) con zoom "Ampliar" y, en admin, borrado de pieza; admin sube por drop/paste con tope 10 e imágenes-solo.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, pytest + pytest-asyncio (strict) + aiosqlite; Next.js App Router (TypeScript), Tailwind, `apiFetch`/`extractDetail`/`useProtectedMedia`.

**Spec:** Decisión del usuario en conversación (2026-11-23): "imágenes con copy-paste o arrastrándolas, únicamente comentarios que aparecen a la derecha al seleccionar la imagen (tipo Notion), sin títulos ni descripciones" — opción **A** confirmada: solo comentarios para todos los roles, me gusta/no me gusta eliminados, panel en admin Y portal, zoom conservado vía botón "Ampliar" en el panel, móvil = hoja a pantalla completa.

## Design Decisions (llamadas de este plan)

1. **Entidad nueva, no extensión**: hilo Notion = N comentarios por usuario por imagen; `MoodboardReaction` tiene `uq_moodboard_reaction_user` (1 por usuario/imagen) → `moodboard_comments` nueva sin unicidad. Las reacciones `comment` existentes se **migran** al hilo (preservación de feedback real del cliente); `like/dislike` se descartan con la tabla.
2. **Title opcional con auto-relleno**: el schema BD mantiene `title NOT NULL` (compatibilidad); el endpoint auto-rellena: título provisto → trim; si no → stem del filename (≤255); si el stem es vacío → `Imagen {count+1}`. El frontend nunca envía título. `description` sigue aceptándose como `Form(None)` (compat) pero el frontend deja de enviarla y de renderizarla.
3. **Comentarios para cualquier miembro**: writes (`POST`/`DELETE`) exigen proyecto ACTIVE y membresía (`require_project_access_from_path` + scoped item); delete = autor o `SUPER_ADMIN`; reads en cualquier estado. Rutas anidadas bajo `/items/{item_id}/comments[/{comment_id}]` para reusar el scoping de aislamiento.
4. **Sin footer en las piezas**: la lámina queda como imágenes + numeración (`01.`, `02.`…); el `renderFooter` del contrato del componente se ELIMINA. El borrado de pieza (admin) se muda al header del panel.
5. **Zoom preservado**: el overlay pinch-zoom existente se abre desde el botón "Ampliar" del panel (no desde el click de la imagen, que ahora selecciona).
6. **Punto fácil de romper**: `DELETE /items/{id}` y `DELETE /boards/{id}` hoy borran `MoodboardReaction` explícitamente → deben borrar `MoodboardComment` (cascada manual, como el patrón vigente).

## Global Constraints

- Roles exactos: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`. Todo endpoint protegido valida autenticado + `is_active` + membresía (deps de `backend/app/api/deps.py`). Comentarios: cualquier miembro escribe (ACTIVE); autor o `SUPER_ADMIN` borra.
- Migración `0014` idempotente con patrón inspector (sin `IF NOT EXISTS`), revisión `"0014"`, down `"0013"`; portable PostgreSQL/SQLite (patrón `0010`–`0013`).
- Comentario: `comment: str` 1–2000 tras `strip()`; blank → 422. Auditoría: `moodboard.comment_create`, `moodboard.comment_delete` (metadata `{project_id}`); las acciones `moodboard.reaction*` desaparecen del código.
- `MoodboardItemRead` pierde `like_count`/`dislike_count`/`my_reaction`/`my_comment`; conserva `comment_count` (ahora = filas de `moodboard_comments`).
- Cap de 10 imágenes por board SIN CAMBIOS (409 `"Moodboard already has 10 images"` antes de `storage.save`); drop/paste filtran `image/jpeg|png|webp|gif` con mensaje claro, nunca descartan archivos en silencio.
- UI Tactile Brutalism: radio 0, sin sombras, `#F9FAF4`/`#111111`/`#EFECE6`, Amiri/Arial/Atkinson-mono (`label-mono` 11px), mobile-first, targets ≥44px, sin solo-hover, copy en español, composición sin bordes alrededor de imágenes. Panel: `md:w-[400px]` con `border-l border-border bg-background`; móvil `fixed inset-0`; pieza seleccionada con `outline` de tinta.
- Tests: `python -m pytest tests/backend/... -v` desde la raíz, async strict; frontend `cd frontend && npx tsc --noEmit && npm run build` (no hay toolchain ESLint en el repo — preexistente).
- Commit por task (conventional); no editar archivos fuera de la lista del task.

## Review Focus

1. Comentarios existentes del cliente (reacciones `comment`) deben **sobrevivir** al hilo nuevo — backfill id-preserving e idempotente → Task 1 `test_migration_0014_moodboard_comments.py`.
2. `like/dislike` eliminados por completo: sin rutas muertas, sin schemas/imports residuales de `MoodboardReaction`, listas sin exponer campos de reacción → Task 1 (grep + tests).
3. Upload sin título nunca debe 422/500 — auto-relleno determinista en ambos caminos (stem del filename, stem vacío) → Task 1 tests de auto-título.
4. Borrado de pieza/board debe cascadar los comentarios NUEVOS (no reacciones inexistentes) → Task 1 cascade test actualizado.
5. Drop/paste debe respetar tope 10 y solo-imágenes con mensajes claros; un 409 a mitad de tanda no deja la UI en estado mentiroso → Task 2 steps.
6. Comentario sobre pieza ajena (cross-project) → 404 indistinguible; comentario de otro autor no borrable por un tercero → Task 1 + extensión de `test_project_isolation.py`.

---

### Task 1: Backend — entidad MoodboardComment, migración 0014, rutas de comentarios y remoción de reacciones

**Files:**
- Create: `backend/app/models/moodboard_comment.py`, `backend/alembic/versions/0014_moodboard_comments.py`, `tests/backend/test_moodboard_comments.py`, `tests/backend/test_migration_0014_moodboard_comments.py`
- Delete: `backend/app/models/moodboard_reaction.py`
- Modify: `backend/app/models/__init__.py` (quitar `MoodboardReaction`/`ReactionType`, exportar `MoodboardComment`), `backend/app/schemas/moodboard.py`, `backend/app/api/v1/endpoints/moodboard.py`, `tests/backend/test_moodboard.py` (quitar tests de reacciones, helper sin título requerido, auto-título), `tests/backend/test_project_isolation.py` (params de reacciones → comentarios), `tests/backend/test_models_sprint3.py` (quitar tests/imports de `MoodboardReaction`), `docs/architecture.md` (modelo 4.3, endpoints, auditoría)

**Interfaces (Produces):**

- `backend/app/models/moodboard_comment.py`:
  ```python
  class MoodboardComment(Base):  # __tablename__ = "moodboard_comments"
      # id UUID pk default uuid4
      # moodboard_item_id UUID FK moodboard_items.id, index=True, nullable=False
      # user_id UUID FK users.id, index=True, nullable=False
      # comment Text NOT NULL
      # created_at / updated_at DateTime(timezone=True), defaults datetime.now(timezone.utc)
      # SIN unique constraints
  ```
  Exportar `MoodboardComment` en `models/__init__.py`; `MoodboardReaction`/`ReactionType` dejan de exportarse (archivo borrado).
- Schemas (`backend/app/schemas/moodboard.py`): eliminar `MoodboardReactionCreate`/`MoodboardReactionRead` y el import de `ReactionType`; añadir:
  ```python
  class MoodboardCommentCreate(BaseModel):
      model_config = ConfigDict(extra="forbid")
      comment: str = Field(min_length=1, max_length=2000)
      # model_validator: strip; blank tras strip → ValueError("Comment text is required")

  class MoodboardCommentRead(BaseModel):  # from_attributes=True
      id: UUID; moodboard_item_id: UUID; user_id: UUID
      author_name: str; comment: str; created_at: datetime
  ```
  `MoodboardItemRead`: quitar `like_count`, `dislike_count`, `my_reaction`, `my_comment`; `comment_count: int = 0` queda (fuente: `moodboard_comments`).
- Rutas (mismo router):
  - `GET /items/{item_id}/comments` → `list[MoodboardCommentRead]` — cualquier miembro, cualquier estado; orden `created_at ASC`; `author_name` vía JOIN `User.full_name`.
  - `POST /items/{item_id}/comments` body `MoodboardCommentCreate` → 201 `MoodboardCommentRead` — cualquier miembro, proyecto ACTIVE; audit `moodboard.comment_create` metadata `{project_id}`.
  - `DELETE /items/{item_id}/comments/{comment_id}` → 204 — autor o `SUPER_ADMIN`, ACTIVE; scoping: `_get_scoped_item` (proyecto) + comentario pertenece al ítem + (`comment.user_id == current_user.id` o rol SUPER_ADMIN); si no → 404 `"Comment not found"`; audit `moodboard.comment_delete` metadata `{project_id}`.
  - **ELIMINADAS**: `POST/DELETE /items/{item_id}/reactions`, `GET /items/{item_id}/reactions`, helper `_require_client_member`, imports de `MoodboardReaction`/`ReactionType`.
  - `DELETE /items/{item_id}` y `DELETE /boards/{board_id}`: la cascada manual borra ahora `MoodboardComment` (en vez de `MoodboardReaction`) antes de archivos/ítems.
  - `POST /boards/{board_id}/items`: `title: str | None = Form(None, max_length=255)`; auto-relleno: título provisto no-blank → `.strip()`; si no → `Path(file.filename or "").stem[:255].strip()`; si queda vacío → `f"Imagen {item_count + 1}"`. `description: str | None = Form(None)` sin cambios.
  - `GET ""` y `GET /boards/{board_id}/items`: `comment_count` = COUNT de `moodboard_comments` por ítem (GROUP BY en el helper `_item_reads`).

**Steps:**

- [ ] **Step 1: Escribir tests falliendo** en `tests/backend/test_moodboard_comments.py` (helpers de `test_moodboard.py`: `create_board`, `upload_piece`): `test_any_member_can_comment_201` (collaborator, client, lead asignado, super_admin → 201, audit `moodboard.comment_create`); `test_thread_multiple_comments_same_user_ordered` (2 comentarios del mismo usuario → 2 filas, ASC por `created_at`); `test_blank_comment_422` y `test_comment_over_2000_422`; `test_nonmember_comment_403` (`"No access to this project"`); `test_unauthenticated_comment_401`; `test_inactive_user_comment_403`; `test_comment_on_draft_409` (POST → 409 `"Project is not active"`; GET → 200); `test_delete_own_comment_204_then_404`; `test_cannot_delete_others_comment_404` (cliente2 intenta borrar comentario de cliente1); `test_super_admin_deletes_any_comment_204`; `test_author_name_in_read` (`author_name` == `full_name` del usuario); `test_comment_count_in_item_lists` (GET "" y GET /boards/{id}/items reflejan `comment_count`, sin campos de reacción en el shape); `test_delete_item_cascades_comments` (ítem con comentarios → DELETE ítem → filas de `MoodboardComment` gone); `test_delete_board_cascades_comments`.
- [ ] **Step 2: Verificar fallo:** `python -m pytest tests/backend/test_moodboard_comments.py -x -v` → FAIL (rutas inexistentes: 404/405).
- [ ] **Step 3: Ajustar `tests/backend/test_moodboard.py`:** eliminar los tests de reacciones (like/dislike upsert, comment-requires-text, team-cannot-react, nonmember-react, list-counts-and-my-reaction, team-sees-client-comments, delete-own-reaction, y las extensiones reaction de `test_inactive_user_403`/`test_unauthenticated_401`/`test_write_on_draft_409`); añadir `test_upload_without_title_autofills_filename_stem` (sin `title` → `data["title"] == "pin"` de `pin.png`) y `test_upload_without_title_empty_stem_autofills_imagen_n` (filename `.png` → `Imagen {n}`); el resto de asserts de shape actualizados (sin `like_count`/`my_reaction`…).
- [ ] **Step 4: Ajustar `tests/backend/test_project_isolation.py`:** reemplazar los params `moodboard-react`/`moodboard-reaction-delete`/`moodboard-reactions` por `moodboard-comment-create` (POST `/moodboard/items/{item_id}/comments`, body `{"comment": "Nota"}`), `moodboard-comment-delete` (DELETE `/moodboard/items/{item_id}/comments/{comment_id}`), `moodboard-comment-list` (GET `/moodboard/items/{item_id}/comments`); en `test_cross_project_item_ids_404`, el flujo de comentarios usa una pieza de B → 404 `"Moodboard item not found"`.
- [ ] **Step 5: Ajustar `tests/backend/test_models_sprint3.py`:** quitar imports y tests de `MoodboardReaction` (modelo borrado); el resto del archivo debe pasar.
- [ ] **Step 6: Implementar backend:** modelo `MoodboardComment` + registro; schemas; rutas de comentarios + remoción de reacciones + cascada a comentarios + `title` opcional con auto-relleno + `comment_count` nuevo; borrar `backend/app/models/moodboard_reaction.py`. Migración `0014_moodboard_comments.py`: create_table `moodboard_comments` (inspector) + índices; backfill `INSERT ... SELECT` desde `moodboard_reactions WHERE reaction='comment' AND comment IS NOT NULL` **conservando el id** (idempotente por PK, guard `NOT EXISTS`); drop índices + tabla `moodboard_reactions` (guardas inspector). Downgrade: recrear `moodboard_reactions` (DDL de 0004) + copiar el primer comentario por `(item, user)` como reacción `comment` + drop `moodboard_comments`.
- [ ] **Step 7: Verificar:** `python -m pytest tests/backend/test_moodboard_comments.py tests/backend/test_moodboard.py tests/backend/test_project_isolation.py tests/backend/test_models_sprint3.py -v` → PASS.
- [ ] **Step 8: Escribir `tests/backend/test_migration_0014_moodboard_comments.py`** (mirror del test de 0013: DDL manual de `moodboard_items` + `moodboard_reactions` post-0013 + filas semilla con reacciones like/comment): upgrade crea `moodboard_comments`, backfill preserva los `comment` (mismos id/texto/autor/fechas, likes descartados), re-run sin duplicar, tabla `moodboard_reactions` eliminada; downgrade recrea reacciones + copia primer comentario por (item,user).
- [ ] **Step 9: Verificar suite completa:** `python -m pytest tests/backend -q` → PASS.
- [ ] **Step 10: Actualizar `docs/architecture.md`** (modelo `moodboard_comments` reemplaza `moodboard_reactions`, tabla de endpoints: comments in / reactions out, auditoría `comment_create`/`comment_delete`, nota de título auto-relleno) y commit `feat(moodboard): notion-style comments for all members, drop reactions, title-less uploads`.

### Task 2: Frontend — panel de comentarios compartido + composición con selección + admin con drop/paste

**Files:**
- Create: `frontend/components/MoodboardCommentPanel.tsx`
- Modify: `frontend/components/MoodboardComposition.tsx`, `frontend/app/admin/projects/[projectId]/moodboard/page.tsx`

**Interfaces:**
- Consumes (Task 1): `GET/POST /items/{id}/comments`, `DELETE /items/{id}/comments/{commentId}`; `MoodboardItemRead` sin campos de reacción, con `comment_count`.
- Produces (Task 3 consume):
  ```tsx
  export interface MoodboardCommentData {
    id: string; moodboard_item_id: string; user_id: string;
    author_name: string; comment: string; created_at: string;
  }
  export function MoodboardCommentPanel(props: {
    projectId: string;
    item: MoodboardItemData | null;   // null = panel cerrado
    currentUserId?: string;            // habilita borrar solo comentarios propios
    onClose: () => void;
    onChanged?: () => void;           // refresca la lista de ítems (comment_count)
    headerExtra?: React.ReactNode;     // admin: eliminación de pieza en dos pasos
  }): React.ReactElement;
  ```
  Internos del panel: preview de la imagen (`useProtectedMedia`) + botón "Ampliar ↗" (overlay pinch-zoom, patrón vigente), label-mono `"{n} COMENTARIOS"`, hilo ASC (`author_name` + fecha + texto `type-editorial`), textarea (maxLength 2000, placeholder "Escribe un comentario") + "Comentar ↗" (≥44px), borrar comentario propio en dos pasos (solo si `comment.user_id === userId` actual — el id del usuario llega vía prop opcional `currentUserId?: string`), feedback `extractDetail`. Contenedor: `fixed inset-0 z-40 bg-background md:inset-y-0 md:left-auto md:right-0 md:w-[400px] md:border-l md:border-border`, con header (numeración + "Cerrar") y scroll interno.
- `MoodboardComposition` (modificado):
  - `MoodboardItemData` se alinea al shape nuevo del backend: quita `like_count`/`dislike_count`, conserva `comment_count: number` (además de `id`, `moodboard_id`, `title`, `description`).
  - Props: QUITA `renderFooter`; añade `onSelect?: (item: MoodboardItemData) => void` y `selectedItemId?: string | null`.
  - `PieceFrame`: click en la imagen → `onSelect(item)` (ya no abre overlay directo); pieza seleccionada → `outline: 2px solid var(--foreground)` (clase `outline outline-2 outline-foreground`); quita el bloque título/descripción (queda imagen + numeración `01.`; `alt` = `item.title`).
- Página admin: elimina el formulario "Nueva pieza" (título/descripción/orden/file) y el footer de piezas; añade:
  - Zona de carga: banda sobre la composición `label-mono` `"ARRASTRA IMÁGENES AQUÍ · O PEGA CON CTRL+V"` + contador `"{n} / 10 IMÁGENES"` + aviso sub-6 vigente.
  - `onDrop`/`onDragOver`/`onDragLeave` en el wrapper de la composición (highlight con `outline` de tinta mientras arrastra); `useEffect` con listener `paste` en `document` → `e.clipboardData?.files`.
  - `uploadFiles(files: FileList | File[])`: filtra `image/jpeg|png|webp|gif` (no-imagen → mensaje `"Solo se pueden agregar imágenes (JPG, PNG, WEBP o GIF)"`), sube secuencialmente `FormData` con **solo `file`** a `POST /boards/{boardId}/items`; 409 → `"Este moodboard ya tiene el máximo de 10 imágenes"` + recarga y detiene la tanda; recarga al terminar.
  - Selección: `selectedItemId` + `MoodboardCommentPanel` con `headerExtra` = eliminación de pieza en dos pasos (mover la lógica vigente); tras borrar pieza → cerrar panel + recargar.

**Steps:**

- [ ] **Step 1: Implementar `MoodboardCommentPanel.tsx`** según Interfaces (carga comentarios al cambiar `item`; post/delete; estados de error con banner, no conflation con vacío — seguir el patrón fix-wave del plan anterior).
- [ ] **Step 2: Modificar `MoodboardComposition.tsx`** (selección, sin título/descripción, sin `renderFooter`) y reescribir la página admin (dropzone + paste + panel; sin formulario).
- [ ] **Step 3: Verificar:** `cd frontend && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 4: Commit** `feat(admin): drag-and-drop and paste uploads with notion-style comment panel`.

### Task 3: Frontend — portal con panel de comentarios + docs

**Files:**
- Modify: `frontend/app/portal/projects/[projectId]/moodboard/page.tsx`, `docs/architecture.md` (párrafos frontend: panel de comentarios tipo Notion, drop/paste en admin, sin reacciones)

**Interfaces:**
- Consumes (Task 1): rutas de comentarios + shape nuevo de ítems. Consumes (Task 2): `MoodboardCommentPanel`, `MoodboardComposition` con `onSelect`/`selectedItemId`.

**Steps:**

- [ ] **Step 1: Reescribir la página portal:** pestañas de solo lectura + composición con selección; `MoodboardCommentPanel` SIN `headerExtra` (cliente comenta y borra solo los suyos — el backend lo impone); eliminar por completo el footer de reacciones (like/dislike/comentar/quitar, `my_reaction`/`my_comment`, `itemsById`); contador `"{n} / 10 IMÁGENES"` permanece; vacíos vigentes.
- [ ] **Step 2: Verificar:** `cd frontend && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 3: Actualizar `docs/architecture.md`** (secciones frontend de moodboard) y commit `feat(portal): notion-style comment panel, drop reaction flow`.
