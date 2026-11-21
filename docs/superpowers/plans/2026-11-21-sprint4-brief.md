# Sprint 4 — Brief (spec)

Fuente: instrucción directa del usuario (2026-11-21), sobre `AGENTS.md` y
`docs/architecture.md` como documentos vinculantes.

## Requerimientos

1. Modelos y migraciones para `project_stages` (`id`, `project_id`, `name`,
   `order_index`, `status`, `approved_by`, `approved_at`), `deliverables` y
   `deliverable_comments` (`x_pct`, `y_pct`, `page_or_frame`, texto y marca de
   consumo de ronda).
2. Candado secuencial de etapas: etapas posteriores permanecen `LOCKED` hasta
   que la etapa anterior esté `APPROVED` por el `CLIENT` asignado, con registro
   en `audit_logs`.
3. Visor de entregables mobile-first (soporte táctil para colocar pines mediante
   toque y zoom, sin depender de `hover`) y control de rondas: al solicitar
   cambios, decrementa `remaining_rounds`; al llegar a `0`, bloquea nuevas
   rondas gratuitas hasta que `SUPER_ADMIN` o `LEAD_DESIGNER` habilite una ronda
   extra (auditada en `audit_logs`).
4. Integración en el portal para que el `CLIENT` o el equipo agenden reuniones
   de revisión de etapa o levantamiento en Google Calendar (`meetings`) con
   registro en `audit_logs`.
5. Pruebas con `pytest` para candado de etapas, decremento de rondas, bloqueo en
   `0` y agendamiento de reuniones.

## Restricciones vinculantes (AGENTS.md / architecture.md)

- Un sprint por turno; detenerse al finalizar y reportar `pytest`.
- RBAC en servidor: autenticación, `is_active`, rol y membresía/propiedad de
  `project_id`. Nunca confiar en ocultamiento visual.
- Exclusiones: nada de ejecución de obra, montaje, inventario, compras de
  construcción ni cuadrillas.
- Toda tabla nueva: modelo SQLAlchemy + esquema Pydantic + migración Alembic +
  pruebas. Prohibido `create_all()` en producción.
- Acciones sensibles registradas en `audit_logs` (actor, acción, entidad,
  metadatos con `project_id` como string).
- UI Tactile Brutalism: `#F7F7F5` / `#111111` / `#EFECE6`, `border-radius: 0`,
  bordes `1px solid #111111`, retículas `gap: 1px` sobre fondo `#111111`, sin
  sombras ni degradados; etiquetas monospace `11px` mayúsculas
  `letter-spacing: 0.08em`; botones `↗` con inversión en `:hover`; áreas
  táctiles ≥ 44×44px; mobile-first desde 375px; nada crítico depende de `hover`.
- Google Calendar: OAuth2 con `GOOGLE_REFRESH_TOKEN` (vacío = desconectado →
  `CalendarNotConnectedError`), `freebusy` + solape local antes de crear evento,
  reserva local previa con compensación si falla Google, Meet automático,
  persistencia UTC, token nunca expuesto.
- `meetings`: exactamente un padre (`lead_id` XOR `project_id`),
  `end_time > start_time`, índice parcial único de inicios no cancelados.
- Uploads: límite 10 MiB, extensión derivada por servidor, clave
  `<project_id>/<uuid_hex><ext>`, descarga solo autenticada.
- Aislamiento por ítem: consultas filtran `id` + `project_id` del path; ids de
  otro proyecto → 404 sin fuga de existencia.
- Escrituras de proyecto exigen `status == ACTIVE` → si no, 409
  "Project is not active".
