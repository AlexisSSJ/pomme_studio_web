# AGENTS.md — Pomme Studio

## 1. Dominio y Reglas de Negocio
- **`pomme_studio`** es una plataforma integral (front-office público, portal de clientes y back-office interno) para un estudio de **branding y diseño de interiores**.
- El estudio vende **únicamente diseño, dirección creativa, documentación ejecutiva y especificaciones (FF&E)**.
- **Exclusiones estrictas:** No crear módulos de ejecución de obra, montaje físico, inventario de obra, compras de construcción ni seguimiento de cuadrillas en campo.

## 2. Estrategia de Ejecución, Costos y Aprobación Obligatoria
- **Modo Planificación Primero (Gate Obligatorio):** Ante cualquier solicitud o sprint, el agente principal debe invocar la skill `superpowers` (`brainstorming` / `writing-plans`) y **únicamente redactar el plan de implementación detallado** (archivos a crear/modificar, subagentes requeridos y pruebas).
- **Prohibido despachar sin permiso modelos de alto costo:** **NUNCA** lances subagentes ni escribas código de producción automáticamente. Después de presentar el plan, **detente y pregunta explícitamente al usuario**: *"¿Apruebas este plan para despachar los subagentes?"*. Solo procede cuando el usuario responda afirmativamente.
- **Optimización de Costos y Enrutamiento de Modelos:**
  - Usa el modelo de planificación (`plan` / `qwen4-max`) exclusivamente para arquitectura y división de tareas.
  - Despacha tareas de lectura/búsqueda al subagente ligero (`explore` / `hy4-flash`) y la implementación/tests a los subagentes económicos (`build` / `glm-5.3` y `general` / `deepseek-v4.1-flash`).
  - Si algún modelo de OpenCode Go no está disponible o alcanza su límite de cuota, cambia automáticamente a su equivalente configurado de **Google** (`gemini-4-argon` para plan, `gemini-3.1-flash` para build/general, `gemini-3.1-flash-lite` para explore).

## 3. Roles y Seguridad (RBAC)
- Roles válidos: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`.
- **Control centralizado (`SUPER_ADMIN`):** Gestiona usuarios, asigna/revoca roles, activa/desactiva cuentas al instante (*kill switch* con `is_active`), edita `pricing_config`, valida pagos/liquidaciones y consulta `audit_logs`.
- **Seguridad obligatoria en API:** Todo endpoint protegido debe validar: usuario autenticado, `is_active == True`, rol permitido y membresía/propiedad sobre `project_id` cuando aplique. Nunca confiar solo en ocultamiento visual en frontend.

## 4. Sistema de Diseño UI (Tactile Brutalism & Mobile-First)
- **Estética:** *Tactile Brutalism* / retícula editorial inspirada en planos arquitectónicos y diseño editorial suizo.
- **Paleta:** Fondo principal `#F7F7F5`, tinta y bordes `#111111`, superficie secundaria `#EFECE6`. Prohibido usar sombras (`box-shadow`), degradados o colores saturados innecesarios.
- **Geometría y retícula:** Estricto `border-radius: 0px` en tarjetas, botones, inputs y modales. Usa bordes de `1px solid #111111` y grids con `gap: 1px` sobre fondo `#111111` con celdas `#F7F7F5` para evitar bordes dobles.
- **Tipografía y detalles:** Títulos en sans-serif geométrica (`letter-spacing: -0.03em`), etiquetas y numeraciones (`01`, `02`, `03`, `04`) en mayúsculas monospace (`11px`, `letter-spacing: 0.08em`), íconos monocromáticos de línea fina (`1.25px`) y botones con flecha diagonal `↗` que invierten colores en `:hover`.
- **Mobile-First y PWA:** En móvil (`375px` en adelante), las retículas colapsan a `1fr` conservando `gap: 1px`. Garantiza áreas táctiles mínimas de `44px x 44px`, soporte táctil (`onTap`/`onClick`) y zoom en el visor de pines de entregables (sin depender de `hover`), e incluye configuración de **PWA** (`manifest.json` e iconos ortogonales).

## 5. Integración con Google Calendar
- Integra **Google Calendar API** (OAuth 2.0 + manejo seguro de `refresh_token`) para consultar disponibilidad (`freebusy`) y crear eventos con **Google Meet** automático.
- Persiste las reuniones en una tabla `meetings` vinculada a `lead_id` o `project_id` (`google_event_id`, `meet_link`, `start_time`, `end_time`, `meeting_type`, `status`) y registra los cambios en `audit_logs`.