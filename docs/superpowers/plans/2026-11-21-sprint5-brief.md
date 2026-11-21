# Sprint 5 — Brief (spec)

Fuente: instrucción directa del usuario (2026-11-21) + diseño acordado en
brainstorming (aprobado con "Me parece bien"), sobre `AGENTS.md` y
`docs/architecture.md` como documentos vinculantes. Base de código: rama
`sprint4/stages-deliverables` (entregables versionados, etapas, pines, rondas).

## Requerimientos

1. **Flujo interno de borradores vs. publicación a cliente.** Los entregables
   tienen `is_client_visible`. Un `COLLABORATOR` solo puede crear/actualizar
   entregables como borrador interno (`is_client_visible=False`). La
   publicación a cliente (`is_client_visible=True`) la hacen `LEAD_DESIGNER` o
   `SUPER_ADMIN`. El `CLIENT` solo ve (lista, detalle, archivo, pines) los
   entregables publicados; un borrador interno responde 404 para el cliente
   (sin fuga de existencia). El equipo ve todos.
2. **Catálogo de especificaciones FF&E (`project_specifications`).** Enfocado en
   mobiliario, luminarias y recubrimientos: categoría, nombre, código de
   fabricante/producto, fabricante/marca, acabado/material, dimensiones,
   referencia de terceros (proveedor + URL de producto) y notas, para ejecución
   externa. **Sin cantidades, precios, stock, órdenes de compra ni inventario**
   (exclusiones de dominio). El equipo escribe; cualquier miembro lee.
3. **Liberación condicionada a `balance_paid`.** Los entregables marcados
   `is_final_handover=True` solo muestran previsualización con marca de agua
   mientras `project.balance_paid == False`, bloqueando la descarga final del
   archivo para el `CLIENT`. Al pasar `balance_paid` a `True` por `SUPER_ADMIN`
   se habilita la descarga final y se audita en `audit_logs`. El equipo siempre
   puede descargar el archivo final.
4. **Pruebas `pytest`** que verifiquen: bloqueo de descarga previo al pago final,
   habilitación posterior al pago, marca de agua/previsualización, flujo de
   borrador/publicación y la auditoría del cambio de `balance_paid`.
5. **Despliegue a producción en Railway** al terminar (proyecto existente
   `pomme-studio`, entorno `production`).

## Decisiones de diseño acordadas

- **Semántica de `balance_paid` (cambio respecto a Sprint 2):** hoy
  `POST /admin/projects/{id}/activate` marca `balance_paid=True` (anticipo).
  Para que el candado de entrega final sea significativo, la activación pasa a
  poner solo `status=ACTIVE` (anticipo recibido) **sin** tocar `balance_paid`.
  `balance_paid` pasa a significar **liquidación final**. Un endpoint nuevo de
  `SUPER_ADMIN` (`POST /admin/projects/{id}/validate-final-payment`) la marca
  `True` y audita. Se ajustan los asserts del test de activación
  (`test_admin_projects.py::test_activate_ok`) y la descripción en
  `docs/architecture.md`.
- **Marca de agua en servidor:** los entregables son imágenes (whitelist de
  Sprint 4). El preview se genera en servidor con **Pillow** (texto diagonal
  "POMME STUDIO · PREVIEW" sobre la imagen, servido como JPEG). Nueva
  dependencia `Pillow>=11.0`. El endpoint `/file` devuelve **403** para el
  `CLIENT` cuando `is_final_handover=True` y `balance_paid=False`; el endpoint
  `/preview` devuelve la imagen con marca de agua. Solo el `CLIENT` se bloquea.
- **Columnas nuevas en `deliverables`:** `is_client_visible` (bool, default
  `False`), `is_final_handover` (bool, default `False`), `published_at`
  (timestamptz nullable), `published_by` (FK `users.id` nullable). Migración
  Alembic `0006`.
- **Publicación:** `POST /projects/{pid}/deliverables/{id}/publish` y
  `.../unpublish` (LEAD_DESIGNER/SUPER_ADMIN con acceso de equipo). Marcar
  `is_final_handover` también es decisión de publicación (solo LEAD/SUPER).
- **Alcance (actualizado por el usuario tras aprobar el diseño):** backend + API
  + pytest **y UI** (frontend Next.js) en este mismo sprint. La UI cubre:
  gestión admin de visibilidad de entregables (publicar/despublicar/marcar
  handover final), botón de validación de pago final (SUPER_ADMIN), catálogo
  FF&E admin (CRUD) y portal cliente (entregables publicados con preview/marca
  de agua y candado de descarga, catálogo FF&E de solo lectura). Estética
  Tactile Brutalism mobile-first de `AGENTS.md` §4.

## Restricciones vinculantes (AGENTS.md / architecture.md)

- Un sprint por turno; detenerse al finalizar y reportar `pytest`.
- RBAC en servidor: autenticación (401 "Could not validate credentials"),
  `is_active` (403 "Inactive user"), rol (403 "Insufficient permissions"),
  membresía/propiedad de `project_id` (403 "No access to this project"). Nunca
  confiar en ocultamiento visual.
- Exclusiones: nada de ejecución de obra, montaje, inventario, compras de
  construcción ni cuadrillas.
- Toda tabla nueva: modelo SQLAlchemy + esquema Pydantic + migración Alembic +
  pruebas. Prohibido `create_all()` en producción.
- Acciones sensibles → `log_audit(db, actor_user_id=…, action=…, entity_type=…,
  entity_id=…, metadata={… "project_id": str(project_id) …})`.
- Aislamiento por ítem: consultas filtran `id` + `project_id` del path; ids de
  otro proyecto → 404 sin fuga de existencia.
- Escrituras de proyecto exigen `status == ACTIVE` → si no, 409 "Project is not
  active" (helper `require_active_project`).
- Uploads: límite 10 MiB → 413 "File exceeds the 10 MiB limit"; tipo no
  permitido → 422 "Unsupported file type"; clave `<project_id>/<uuid_hex><ext>`
  vía `LocalStorage`; descarga solo por endpoint autenticado.
- Enums SQLAlchemy: `SAEnum(..., native_enum=False, values_callable=lambda
  members: [m.value for m in members])`, valores lowercase, `server_default`
  lowercase.
- Sin módulos de obra/inventario/compras. FF&E es solo documentación de
  especificación.
