# Moodboard: Lámina Editorial Anotada (estilo referencia VEER) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el layout `editorial_collage` como la lámina de collage anotada de la referencia del usuario (VEER Café): lienzo de proporción fija con imágenes colocadas orgánicamente en slots de tamaños variados, y **anotaciones en serif itálica con líneas guía finas** cuyo texto es el **último comentario de cada imagen** (opción A confirmada).

**Architecture:** Backend: `MoodboardItemRead` gana `latest_comment: str | None` (último comentario por ítem, una consulta ordenada desc + first-per-item). Frontend: `CollageGrid` se reemplaza por `AnnotatedSheet` — contenedor `relative aspect-[3/2]` en md+ con slots absolutos desde una tabla maestra de 10 rects (spread-first: los primeros N slots quedan repartidos para cualquier N), imágenes `object-fit: cover`, anotación itálica Amiri + línea guía de 1px en el hueco reservado adyacente; móvil = columna con anotación inline y aspecto natural. `atelier_grid` y `monograph_strip` NO se tocan. Click (imagen o anotación) = seleccionar → panel existente, sin cambios.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2 + pytest; Next.js App Router (TS), Tailwind, `useProtectedMedia`.

**Spec:** Conversación 2026-11-24: referencia `VEER Café Identity & Logo Design _ Minimalist & Elegant Visual Style.jpg` (collage orgánico + anotaciones itálicas con leader lines + swatches). Opción A: anotación = último comentario. Llamadas: solo `editorial_collage` cambia; swatches fuera de alcance; sin numeración en este layout; header de lámina existente se conserva sobre el lienzo.

## Global Constraints

- UI Tactile Brutalism: radio 0, sin sombras, `#F9FAF4`/`#111111`/`#EFECE6`; anotaciones `type-editorial italic` (Amiri) `text-[11px] md:text-[12px] leading-snug line-clamp-2`; líneas guía `bg-foreground` de 1px; SIN bordes alrededor de imágenes; targets ≥44px en controles; copy en español; mobile-first.
- `latest_comment` = texto completo del comentario más reciente (`created_at DESC, id DESC`); `None` sin comentarios. El truncado visual es CSS (`line-clamp-2`), no del payload.
- Tabla maestra de slots (x, y, w, h en % del lienzo; lado de anotación). Invariante: **sin solapes entre rects de imagen, gutters ≥2%**; el implementer puede ajustar ±3% manteniendo el invariante:
  ```
  1  {10,10,24,28} top      6  {56,62,18,24} bottom
  2  {56, 6,22,50} right    7  {78,60,18,30} bottom
  3  {32,40,20,26} top      8  {30,78,22,16} top
  4  { 6,44,20,38} top      9  {82,24,14,32} top
  5  {36, 8,14,26} top     10  { 8,90,18, 8} top
  ```
  N imágenes → primeros N slots. N=1 → caso especial `{30,20,40,60}` con anotación bottom.
- Reglas de anotación: caja del mismo ancho que la imagen (lado top/bottom: misma x, en el hueco vertical reservado, alto 6–8%; lado right: x = img.x+img.w+2, w = min(18, 100−x), y = img.y, alto 10%); líder = div de 1px que une el borde de la caja con el borde de la imagen (vertical para top/bottom, horizontal para right). Solo se renderiza si `latest_comment` no está vacío. Ejemplos trabajados: slot 1 → caja {10,2,24,7}, líder vertical de y9→y10 en x22; slot 2 → caja {80,6,18,10}, líder horizontal de x78→x80 en y11.
- Cada slot completo (imagen + anotación + líder) es UN `<button>` de selección (`onSelect(item)`, `aria-pressed`, outline de tinta en la imagen al seleccionar); los estados error/loading de `PieceFrame` siguen siendo seleccionables dentro del slot.
- Móvil (<md): `grid grid-cols-1 gap-6`, anotación itálica inline SOBRE la imagen (sin líder), imagen `h-auto w-full` (aspecto natural); sin numeración en este layout (los otros dos la conservan).
- Tests backend: `python -m pytest tests/backend/... -v`; frontend: `cd frontend && npx tsc --noEmit && npm run build`. Commit por task; no editar fuera de la lista.

## Review Focus

1. `latest_comment` debe reflejar el comentario MÁS RECIENTE tras post y tras delete del último (no el primero) → Task 1 tests.
2. Sin comentarios → sin anotación y sin líder (lámina limpia), nunca caja vacía → Task 2 (render condicional) + Task 1 (`None`).
3. Ningún par de rects de imagen se solapa para N=1..10 (invariante de la tabla) → Task 2: el implementer verifica aritméticamente los 10 prefijos y lo reporta; reviewer re-chequea.
4. Una imagen cuyo archivo falló sigue siendo seleccionable dentro de su slot (caption-botón existente) → Task 2.
5. El payload de listas no crece sin cota: `latest_comment` ≤2000 chars por ítem, una sola consulta extra (no N+1) → Task 1.

---

### Task 1: Backend — `latest_comment` en las listas de ítems

**Files:**
- Modify: `backend/app/schemas/moodboard.py`, `backend/app/api/v1/endpoints/moodboard.py`, `tests/backend/test_moodboard_comments.py`, `docs/architecture.md` (fila de `MoodboardItemRead` / nota de anotación)

**Interfaces (Produces):**
- `MoodboardItemRead.latest_comment: str | None = None`.
- `_item_reads`: una consulta `select(MoodboardComment).where(moodboard_item_id.in_(ids)).order_by(created_at.desc(), id.desc())`; dict first-per-item; `model_copy(update={"comment_count": ..., "latest_comment": ...})`. Sin N+1.

**Steps:**
- [ ] **Step 1: Tests fallando** en `test_moodboard_comments.py`: `test_latest_comment_in_item_lists` (2 comentarios con gap temporal → `GET ""` y `GET /boards/{id}/items` traen el texto del MÁS RECIENTE); `test_latest_comment_none_without_comments`; `test_latest_comment_updates_after_delete_of_latest` (borrar el último → el anterior pasa a ser `latest_comment`).
- [ ] **Step 2:** `python -m pytest tests/backend/test_moodboard_comments.py -x -v` → FAIL (campo ausente).
- [ ] **Step 3:** Implementar schema + `_item_reads` según Interfaces.
- [ ] **Step 4:** `python -m pytest tests/backend/test_moodboard_comments.py tests/backend/test_moodboard.py -v` → PASS; luego `python -m pytest tests/backend -q` → PASS.
- [ ] **Step 5:** Actualizar `docs/architecture.md` y commit `feat(moodboard): expose latest_comment for sheet annotations`.

### Task 2: Frontend — `AnnotatedSheet` reemplaza `CollageGrid`

**Files:**
- Modify: `frontend/components/MoodboardComposition.tsx`, `frontend/app/admin/projects/[projectId]/moodboard/page.tsx`, `frontend/app/portal/projects/[projectId]/moodboard/page.tsx`, `docs/architecture.md` (párrafo frontend de layouts)

**Interfaces:**
- Consumes (Task 1): `latest_comment: string | null` en el shape de ítems.
- `MoodboardItemData` += `latest_comment: string | null`; las interfaces locales de ítem de ambas páginas += el mismo campo.
- `AnnotatedSheet({ projectId, items, onSelect, selectedItemId })` interno del componente: md+ `relative w-full aspect-[3/2]`; slots absolutos (`left/top/width/height` en %) desde la tabla maestra; imagen `object-cover w-full h-full`; anotación + líder según reglas; móvil stack. `PieceFrame` se reutiliza para imagen/estados; la numeración `figcaption` se omite SOLO en este layout.

**Steps:**
- [ ] **Step 1:** Implementar `AnnotatedSheet` + tabla maestra + reglas de anotación/líder; verificar aritméticamente los 10 prefijos sin solapes (reportar la tabla de chequeo en el reporte).
- [ ] **Step 2:** Cablear en `MoodboardComposition` (rama `editorial_collage`), actualizar `MoodboardItemData` y los tipos locales de ambas páginas (solo el campo nuevo; nada más de las páginas cambia).
- [ ] **Step 3:** `cd frontend && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 4:** Actualizar `docs/architecture.md` y commit `feat(moodboard): annotated editorial sheet with italic comment captions`.
