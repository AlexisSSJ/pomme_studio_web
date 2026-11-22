# Arquitectura — Pomme Studio

> Documento de referencia técnica de `pomme_studio_web`. Define el stack, los
> roles y permisos, las reglas de negocio, la integración con Google Calendar,
> el modelo de seguridad de la API y el sistema de diseño de la interfaz.

## 1. Visión general

`pomme_studio` es una plataforma integral para un estudio de **branding y diseño
de interiores**. Se compone de tres superficies sobre una misma API:

| Superficie | Audiencia | Propósito |
|---|---|---|
| **Front-office público** | Visitantes y prospectos | Presentación del estudio, portafolio, captación de leads y agendamiento de reuniones. |
| **Portal de clientes** | `CLIENT` | Consulta de sus proyectos, brief (cuestionario y referencias), moodboard con reacciones, entregables, pines/decisiones, pagos y reuniones. |
| **Back-office interno** | `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR` | Gestión de leads, proyectos, entregables, FF&E, pricing, pagos y auditoría. |

En Sprint 3 el portal de clientes se materializa en la ruta `/portal`
(proyectos del cliente, brief y moodboard) y la gestión de brief/moodboard del
equipo en `/admin/projects/{id}/brief` y `/admin/projects/{id}/moodboard`; el
login redirige por rol (`CLIENT` → `/portal`). Ver §7.6.

El repositorio es un **monorepo** con dos aplicaciones desacopladas que se
comunican por HTTP:

```
pomme_studio_web/
├── backend/              # API FastAPI (Python)
│   ├── app/
│   │   ├── api/          # Routers y dependencias (v1)
│   │   ├── core/         # Configuración y seguridad
│   │   ├── db/           # Sesión y base declarativa de SQLAlchemy
│   │   ├── models/       # Modelos ORM
│   │   └── schemas/      # Esquemas Pydantic
│   └── alembic/          # Migraciones de base de datos
├── frontend/             # Next.js 14 (App Router) + TypeScript + Tailwind
├── tests/                # pytest (backend) y pruebas de frontend
├── docs/                 # Documentación (este archivo, planes)
└── .env.example          # Contrato de variables de entorno
```

## 2. Stack tecnológico

### 2.1 Backend

| Componente | Tecnología | Notas |
|---|---|---|
| Lenguaje | **Python 3.12** | Tipado estático en firmas públicas. |
| Framework HTTP | **FastAPI** `>=0.115` | Routers versionados bajo `/api/v1`. |
| Servidor ASGI | **Uvicorn** `[standard]` | `--reload` solo en desarrollo. |
| Validación / settings | **Pydantic 2** + **pydantic-settings** | Configuración centralizada en `app/core/config.py`. |
| ORM | **SQLAlchemy 2.0 async** | Sesiones `AsyncSession`, sin I/O bloqueante en handlers. |
| Migraciones | **Alembic** | Toda tabla nueva requiere su migración en `backend/alembic/versions/`. |
| Driver de BD | **asyncpg** | `postgresql+asyncpg://`. |
| Cliente HTTP saliente | **httpx** | Llamadas a Google APIs. |
| Almacenamiento | **boto3** | Cliente S3-compatible para subir/descargar entregables. |
| Errores | `HTTPException` + handlers | Respuestas consistentes; nunca filtrar trazas ni secretos. |

Las dependencias exactas se declaran en `backend/requirements.txt`.

### 2.2 Frontend

| Componente | Tecnología | Notas |
|---|---|---|
| Framework | **Next.js 14** (App Router) | Server Components por defecto; `"use client"` solo cuando se requiere interacción. |
| Lenguaje | **TypeScript** `^5.6` | `strict` habilitado; sin `any` implícitos. |
| Estilos | **Tailwind CSS** `^3.4` | Tokens de la paleta *Tactile Brutalism* en `tailwind.config.ts`. |
| Utilidades | `clsx`, `tailwind-merge`, `class-variance-authority` | Composición de clases vía `cn()` en `lib/utils.ts`. |
| Iconografía | `lucide-react` | Íconos monocromáticos de línea fina (`1.25px`). |
| PWA | `manifest` + iconos ortogonales | Instalable en móvil; ver sección 7. |

### 2.3 Base de datos

- **PostgreSQL** como única fuente de verdad.
- Conexión vía `DATABASE_URL` (`postgresql+asyncpg://…`).
- Convenciones: claves primarias UUID, columnas `created_at` / `updated_at` en
  UTC, borrado lógico cuando aplique, índices en claves foráneas y en
  `project_id`.
- Cambios de esquema **siempre** mediante Alembic; prohibido `create_all()` en
  producción.

### 2.4 Storage

- **Decisión Sprint 3 (interina):** los medios de brief y moodboard se guardan
  en **disco local** bajo `MEDIA_ROOT` (por defecto `<repo>/media/`), con un
  directorio por `project_id` y claves generadas por el servidor (servicio
  `LocalStorage`). La descarga es **siempre autenticada** vía endpoints
  `/file`; no existe mount público de estáticos.
- Los binarios **no** se guardan en la base de datos: solo metadatos y la
  `storage_key` del objeto.
- **Migración pendiente:** object storage compatible con S3 (Cloudflare R2 o
  AWS S3, o MinIO local) con bucket privado. Las variables `STORAGE_ENDPOINT`,
  `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`,
  `STORAGE_BUCKET_NAME` y `STORAGE_PUBLIC_URL` ya están reservadas en la
  configuración y no deben reutilizarse para otro propósito.
- Límites y validaciones de subida: ver §6.3.

### 2.5 Autenticación

- **JWT** firmados con `SECRET_KEY` y `ALGORITHM` (por defecto `HS256`).
- Access token de vida corta (`ACCESS_TOKEN_EXPIRE_MINUTES`) y refresh token de
  vida larga (`REFRESH_TOKEN_EXPIRE_DAYS`).
- Contraseñas con **passlib[bcrypt]**; nunca se almacenan en claro.
- El token transporta el identificador de usuario; el rol y `is_active` se
  **revalidan contra la base de datos** en cada request protegido para que la
  revocación sea inmediata.

### 2.6 Testing

- **pytest** + **pytest-asyncio** para el backend; `TestClient`/`httpx` para
  endpoints.
- Suite organizada en `tests/backend/`; toda funcionalidad nueva debe incluir
  pruebas (camino feliz + casos de autorización y error).
- Pruebas de frontend en `tests/frontend/`.
- Comando de verificación: `pytest tests/backend -v`.

### 2.7 Entornos

`ENVIRONMENT` ∈ `development | staging | production`. `DEBUG` debe ser `false`
en producción. Las variables se documentan en `.env.example` y **nunca** se
versionan secretos reales (`.env` está en `.gitignore`). Sprint 4 añade
`PROJECT_MEETING_MINUTES` (por defecto `60`), que fija la duración de las
reuniones de proyecto (ver §5.2).

## 3. Roles y permisos (RBAC)

Existen exactamente **cuatro** roles válidos. Se almacenan en el usuario y se
validan en el backend, no solo en la interfaz.

| Rol | Descripción | Alcance típico |
|---|---|---|
| **`SUPER_ADMIN`** | Control centralizado de la plataforma. Gestiona usuarios, asigna y revoca roles, activa/desactiva cuentas al instante (*kill switch* con `is_active`), edita `pricing_config`, valida pagos y liquidaciones, y consulta `audit_logs`. | Global (todos los proyectos, leads y configuración). |
| **`LEAD_DESIGNER`** | Dirección creativa y responsable del proyecto. Define propuestas, entregables, especificaciones FF&E, hitos y aprueba el trabajo del equipo; gestiona la agenda del estudio. | Proyectos donde es líder o miembro; lectura amplia de leads asignados. |
| **`COLLABORATOR`** | Equipo de diseño. Produce y actualiza documentación ejecutiva, planos, tableros y FF&E, y carga entregables. | Solo proyectos donde tiene membresía activa. |
| **`CLIENT`** | Cliente del estudio. Consulta el avance de sus proyectos, revisa y aprueba entregables, deja comentarios, ve reuniones y el estado de sus pagos. | Únicamente sus propios proyectos (`project_id` con propiedad/membresía). |

Reglas transversales:

- Un usuario tiene **un** rol activo; los cambios de rol se registran en
  `audit_logs`.
- `SUPER_ADMIN` es el único que puede administrar usuarios, roles y
  `pricing_config`.
- `CLIENT` **nunca** accede al back-office ni a datos de otros clientes.
- El frontend puede ocultar acciones por rol, pero la decisión de autorización
  siempre ocurre en el servidor.

## 4. Reglas de negocio

### 4.1 Alcance del servicio

El estudio vende **únicamente**:

1. **Diseño** (conceptual, espacial, de interiores y de marca).
2. **Dirección creativa**.
3. **Documentación ejecutiva** (planos, memorias, especificaciones, detalles).
4. **Especificaciones FF&E** (mobiliario, accesorios y equipamiento).

Todo módulo, entidad y flujo del producto debe poder mapearse a uno de estos
cuatro entregables.

### 4.2 Exclusiones explícitas (non-goals)

Queda **prohibido** crear módulos, tablas o flujos para:

- **Ejecución de obra** (gestión de contratistas, cronogramas de construcción).
- **Montaje físico** de mobiliario o instalaciones.
- **Inventario de obra** o control de materiales en sitio.
- **Compras de construcción** (órdenes de compra, proveedores de obra,
  recepciones).
- **Seguimiento de cuadrillas** en campo (asistencia, avance por cuadrilla,
  reportes de sitio).

El sistema puede *documentar y especificar* lo que otros ejecutan, pero no
gestiona la ejecución. Ante una solicitud que implique alguna de estas
exclusiones, debe rechazarse o reformularse como entregable de diseño.

### 4.3 Entidades principales

| Entidad | Rol en el negocio | Estado |
|---|---|---|
| `users` | Cuentas con rol, `is_active` y credenciales. | Sprint 1 |
| `leads` | Prospectos del front-office; origen de reuniones y propuestas. | **Sprint 2** |
| `projects` | Proyecto de diseño con cliente, líder y miembros; liquidación final desacoplada. | Sprint 1 + Sprint 2 + **Sprint 5** |
| `project_members` | Membresía usuario↔proyecto (base del control de acceso). | Sprint 1 |
| `ffe_items` | Especificaciones FF&E (ficha, acabado, proveedor sugerido, estado). | Sprint 1 |
| `pricing_config` | Reglas de precios editables por `SUPER_ADMIN`. | Sprint 1 |
| `payments` | Pagos y liquidaciones sujetos a validación. | Sprint 1 |
| `meetings` | Reuniones sincronizadas con Google Calendar. | **Sprint 2** |
| `brief_items` | Brief del proyecto: preguntas del cuestionario y referencias subidas. | **Sprint 3** |
| `moodboard_items` | Piezas de inspiración del moodboard cargadas por el equipo. | **Sprint 3** |
| `moodboard_reactions` | Reacciones (`like`/`dislike`/`comment`) de los clientes a las piezas. | **Sprint 3** |
| `project_stages` | Fases secuenciales del flujo de trabajo, con candado y aprobación del cliente. | **Sprint 4** |
| `deliverables` | Entregables versionados dentro de una etapa, con pines/comentarios, drafts y handover final. | Sprint 1 → Sprint 4 → **Sprint 5** |
| `deliverable_comments` | Pines de revisión anclados a un punto porcentual de un entregable. | **Sprint 4** |
| `project_specifications` | Especificaciones FF&E (mobiliario, luminarias, recubrimientos) para ejecución externa sin inventario ni compras. | **Sprint 5** |
| `audit_logs` | Bitácora inmutable de acciones sensibles. | Sprint 1 |

#### 4.3.1 `leads`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `contact_name` | string(255) | Nombre del prospecto. |
| `email` | string(320) | Correo de contacto (indexado, no único). |
| `service_type` | enum | `branding` \| `interior` \| `integral`. |
| `space_type` | enum / null | `residential` \| `commercial` \| `hospitality` \| `office`. |
| `area_m2` | numeric(10,2) / null | Metros cuadrados aproximados. |
| `budget_range` | enum / null | `under_10k` \| `10k_25k` \| `25k_50k` \| `50k_100k` \| `over_100k`. |
| `status` | enum | `new` \| `contacted` \| `qualified` \| `proposal_sent` \| `converted` \| `discarded`. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

#### 4.3.2 `projects`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `title` | string(255) | Nombre del proyecto. |
| `lead_id` | UUID / null | FK a `leads.id` (proyecto generado desde un lead). |
| `client_id` | UUID / null | FK a `users.id` (cliente asignado). |
| `lead_designer_id` | UUID / null | FK a `users.id` (diseñador líder). |
| `scope_type` | enum / null | `branding` \| `interior` \| `integral`. |
| `status` | enum | `draft` \| `active` \| `on_hold` \| `completed` \| `cancelled`. |
| `included_rounds` | int | Rondas de cambio incluidas en la propuesta. |
| `remaining_rounds` | int | Rondas de cambio aún disponibles. |
| `balance_paid` | bool | Indica si la liquidación final fue pagada y validada por `SUPER_ADMIN` (Sprint 5). La activación del proyecto no marca esta bandera (`False` por defecto). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

`lead_id` tiene la restricción única `uq_projects_lead_id` para impedir conversiones
duplicadas; los proyectos legados pueden conservar `lead_id = NULL` (se permiten
múltiples valores NULL).

En Sprint 5, `balance_paid` queda formalmente desacoplado de la activación del
proyecto: la activación (`POST /admin/projects/{project_id}/activate`) establece el
estado del proyecto en `active`, pero conserva `balance_paid = False`. La bandera
representa la liquidación o saldo final del proyecto, validada exclusivamente por
`SUPER_ADMIN` mediante `POST /admin/projects/{project_id}/validate-final-payment`
para desbloquear las descargas de los archivos originales de entregables finales
(`is_final_handover` vía `/file`).

#### 4.3.3 `meetings`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `lead_id` | UUID / null | FK a `leads.id` (reuniones de captación). |
| `project_id` | UUID / null | FK a `projects.id` (reuniones de seguimiento). |
| `google_event_id` | string(255) / null | ID del evento en Google Calendar. |
| `meet_link` | string(512) / null | URL de Google Meet generada por Google. |
| `start_time` | timestamptz | Inicio en UTC. |
| `end_time` | timestamptz | Fin en UTC. |
| `meeting_type` | enum | `discovery` \| `proposal` \| `review` \| `follow_up` \| `survey` (Sprint 4). |
| `status` | enum | `scheduled` \| `confirmed` \| `cancelled` \| `completed` \| `no_show`. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `end_time > start_time`; exactamente uno de `lead_id` o `project_id` debe estar presente; índices sobre `lead_id`, `project_id` y `start_time`. El índice parcial único `ux_meetings_start_time_active` impide dos reuniones con el mismo `start_time` cuando `status != 'cancelled'`; para las Discovery Calls de 30 minutos sobre un único calendario, igual inicio equivale a solapamiento.

#### 4.3.4 `brief_items`

Preguntas del cuestionario y archivos de referencia dentro del brief de un
proyecto (migración `0004`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `project_id` | UUID | FK a `projects.id` (indexada). |
| `item_type` | enum | `question` \| `reference`. |
| `category` | enum | `branding` \| `interior` \| `general`. |
| `prompt` | string(500) / null | Texto de la pregunta (obligatorio si `question`). |
| `answer` | text / null | Respuesta del cliente a la pregunta. |
| `note` | string(1000) / null | Nota adjunta a una referencia. |
| `file_name` | string(255) / null | Nombre original del archivo (solo metadato). |
| `content_type` | string(100) / null | MIME declarado del archivo. |
| `size_bytes` | int / null | Tamaño en bytes. |
| `storage_key` | string(500) / null | Clave en el storage (obligatoria si `reference`). |
| `created_by` | UUID | FK a `users.id` (autor de la fila). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricción `ck_brief_item_shape`: una fila `question` exige `prompt` no nulo y
una fila `reference` exige `storage_key` no nulo.

#### 4.3.5 `moodboard_items`

Piezas de inspiración cargadas por el equipo para que el cliente reaccione
(migración `0004`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `project_id` | UUID | FK a `projects.id` (indexada). |
| `title` | string(255) | Título de la pieza. |
| `description` | text / null | Descripción opcional. |
| `file_name` | string(255) | Nombre original del archivo (metadato). |
| `content_type` | string(100) | MIME (solo imágenes permitidas). |
| `size_bytes` | int | Tamaño en bytes. |
| `storage_key` | string(500) | Clave en el storage. |
| `sort_order` | int | Orden de presentación (por defecto `0`). |
| `created_by` | UUID | FK a `users.id` (autor de la carga). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

#### 4.3.6 `moodboard_reactions`

Reacción única por usuario y pieza (migración `0004`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `moodboard_item_id` | UUID | FK a `moodboard_items.id` (indexada). |
| `user_id` | UUID | FK a `users.id` (indexada). |
| `reaction` | enum | `like` \| `dislike` \| `comment`. |
| `comment` | text / null | Texto de la reacción (obligatorio si `comment`). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `uq_moodboard_reaction_user` hace única la pareja
`(moodboard_item_id, user_id)` — base del upsert de reacciones — y
`ck_reaction_comment_required` exige texto no vacío cuando
`reaction = 'comment'`.

#### 4.3.7 `project_stages`

Fase ordenada del flujo de trabajo de un proyecto (migración `0005`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `project_id` | UUID | FK a `projects.id` (indexada). |
| `name` | string(255) | Nombre de la etapa. |
| `order_index` | int | Posición en el flujo (≥ 0). |
| `status` | enum | `locked` \| `active` \| `approved`. |
| `approved_by` | UUID / null | FK a `users.id` (cliente que aprobó). |
| `approved_at` | timestamptz / null | Momento de la aprobación. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `uq_project_stage_order` hace única la pareja
`(project_id, order_index)`; `ck_stage_order_non_negative` exige
`order_index >= 0`; `ck_stage_approval_shape` exige que una etapa
`approved` tenga `approved_by` y `approved_at`.

#### 4.3.8 `deliverables`

Versión de un entregable dentro de una etapa (migraciones `0005` y `0006`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `project_id` | UUID | FK a `projects.id` (indexada). |
| `stage_id` | UUID | FK a `project_stages.id` (indexada). |
| `title` | string(255) | Título de la versión. |
| `version` | int | Número de versión dentro de la etapa (≥ 1, default 1). |
| `file_name` | string(255) | Nombre original del archivo (metadato). |
| `content_type` | string(100) | MIME (solo imágenes permitidas). |
| `size_bytes` | int | Tamaño en bytes. |
| `storage_key` | string(500) | Clave en el storage. |
| `status` | enum | `in_review` \| `changes_requested` \| `approved`. |
| `is_client_visible` | bool | Visibilidad en portal de clientes (`False` = borrador interno, `True` = publicado; default `False`, migración `0006`). |
| `is_final_handover` | bool | Marca de entrega final protegida por liquidación `balance_paid` (default `False`, migración `0006`). |
| `published_at` | timestamptz / null | Momento UTC en que fue publicado al cliente (migración `0006`). |
| `published_by` | UUID / null | FK a `users.id` (miembro del equipo que publicó la versión; migración `0006`). |
| `created_by` | UUID | FK a `users.id` (autor de la carga). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `uq_deliverable_stage_version` hace única la pareja
`(stage_id, version)` — backstop de la carrera de uploads concurrentes —,
`ck_deliverable_version_positive` exige `version >= 1`, y
`fk_deliverables_published_by` enlaza `published_by` con `users.id`.

#### 4.3.9 `deliverable_comments`

Pin de revisión anclado a un punto porcentual de un entregable
(migración `0005`).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `deliverable_id` | UUID | FK a `deliverables.id` (indexada). |
| `created_by` | UUID | FK a `users.id` (autor del pin). |
| `x_pct` / `y_pct` | float | Coordenadas del pin en porcentaje (0–100). |
| `page_or_frame` | int | Página o frame del documento (≥ 1, default 1). |
| `body` | text | Texto del pin (no puede estar en blanco). |
| `round_number` | int | Ronda de cambios a la que pertenece (default 1). |
| `consumes_round` | bool | `True` cuando la ronda del pin ya fue consumida. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `ck_comment_x_pct` y `ck_comment_y_pct` fijan el rango
0–100, `ck_comment_page` exige `page_or_frame >= 1` y `ck_comment_body`
rechaza cuerpos whitespace-only a nivel de base (la capa de schema ya los
rechaza con `422` antes de llegar aquí).

#### 4.3.10 `project_specifications`

Especificaciones de catálogo FF&E (mobiliario, luminarias, acabados, equipamiento)
asociadas a un proyecto para ejecución externa sin inventario ni compras
(migración `0006`, Sprint 5).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `project_id` | UUID | FK a `projects.id` (indexada). |
| `category` | enum | `furniture` \| `lighting` \| `finishes` \| `equipment` \| `other`. |
| `name` | string(255) | Nombre descriptivo del elemento o especificación. |
| `code` | string(120) / null | Código interno de referencia o clave de plano. |
| `manufacturer` | string(255) / null | Fabricante o marca. |
| `finish` | string(255) / null | Acabado, color o material especificado. |
| `dimensions` | string(255) / null | Dimensiones o medidas especificadas. |
| `supplier` | string(255) / null | Proveedor o distribuidor sugerido. |
| `reference_url` | string(500) / null | Enlace a ficha técnica o catálogo del fabricante/proveedor. |
| `location` | string(255) / null | Ubicación sugerida o espacio dentro del proyecto. |
| `notes` | text / null | Notas técnicas o recomendaciones de instalación/ejecución. |
| `created_by` | UUID | FK a `users.id` (autor del registro). |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `ck_specification_name` exige `length(trim(name)) > 0` (el nombre no
puede ser vacío ni componerse exclusivamente de espacios en blanco).

**Exclusión estricta (§4.2 Non-goals):** la entidad está diseñada exclusivamente
para documentación ejecutiva y especificación técnica de diseño para ejecución
externa. Queda estrictamente prohibido incluir columnas o flujos para cantidades,
precios unitarios, costos totales, inventario, control de existencias, compras de
obra o contratistas.

### 4.4 Auditoría

Toda acción sensible implementada (cambios de rol, activación/desactivación de
cuentas, edición de `pricing_config`, validación de pagos, creación de reuniones
y acceso a datos de otro usuario) se registra en `audit_logs` con actor, acción,
entidad afectada, timestamp y metadatos relevantes. La cancelación de reuniones
y su auditoría son comportamiento futuro, no parte de Sprint 2.

En Sprint 3 se auditan además las acciones de brief y moodboard:
`brief.question_create`, `brief.answer`, `brief.reference_upload`,
`moodboard.item_create`, `moodboard.item_delete`, `moodboard.reaction` y
`moodboard.reaction_delete`, con `entity_type` `brief_item`, `moodboard_item` o
`moodboard_reaction` y `project_id` (como string) en los metadatos.

En Sprint 4 se auditan las acciones del flujo de etapas, entregables y rondas:
`stage.create`, `stage.approve` y `stage.unlock` (entidad `project_stage`),
`deliverable.create`, `deliverable.approve` y `deliverable.changes_requested`
(entidad `deliverable`), `deliverable.comment` (entidad `deliverable_comment`),
`project.extra_round_granted` (entidad `project`) y `meeting.create` para las
reuniones de proyecto, ahora con el **actor autenticado** (`actor_user_id`),
a diferencia de las reuniones de lead de Sprint 2, cuyo actor es `NULL`.

En Sprint 5 se auditan las acciones de validación de liquidación final, publicación
de entregables y catálogo de especificaciones FF&E:
- `project.final_payment_validated` (entidad `project`): validación de la
  liquidación o saldo final del proyecto ejecutada por `SUPER_ADMIN`.
- `deliverable.publish`, `deliverable.unpublish` y `deliverable.final_handover`
  (entidad `deliverable`): publicación hacia el portal de clientes, reversión a
  borrador interno y marcado de entrega final protegida por gate de balance,
  ejecutados por `LEAD_DESIGNER` o `SUPER_ADMIN` con membresía/rol de equipo.
- `specification.create`, `specification.update` y `specification.delete`
  (entidad `project_specification`): creación, edición y eliminación de ítems de
  especificación FF&E realizadas por el equipo asignado al proyecto.

### 4.5 Etapas, entregables y rondas de cambio (Sprint 4)

- **Regla de creación de etapas.** La primera etapa de un proyecto nace
  `ACTIVE` (no tiene predecesores). Una etapa posterior nace `LOCKED` salvo
  que **todas** las etapas con `order_index` menor estén `APPROVED`, en cuyo
  caso nace `ACTIVE`. Consecuencia documentada: crear etapas fuera de orden
  tras aprobaciones puede dejar varias etapas `ACTIVE` simultáneamente; el
  spec no exige la invariante de una sola `ACTIVE`.
- **Candado secuencial.** Solo el cliente asignado (rol `CLIENT` con
  membresía `CLIENT`) aprueba una etapa `ACTIVE`. La aprobación desbloquea
  la siguiente etapa `LOCKED` por `order_index` — la de menor índice mayor
  que la aprobada, sin importar el orden de creación — y se auditan
  `stage.create`, `stage.approve` y `stage.unlock`.
- **Rondas de cambio.** `request-changes` decrementa `remaining_rounds`,
  voltea la versión a `changes_requested` y marca `consumes_round = True`
  los pines no consumidos del entregable, en una sola transacción. Con
  `remaining_rounds = 0` → `409 "No remaining change rounds"`. La ronda
  extra (`POST /admin/projects/{pid}/extra-round`) es auditada
  (`project.extra_round_granted`) e incrementa `included_rounds` y
  `remaining_rounds`. El `round_number` de un pin se fija al crearlo como
  `included_rounds − remaining_rounds + 1`; el pin en sí no consume ronda.
- **Entregables.** Solo imágenes este sprint; `page_or_frame` se persiste
  (default 1) para el soporte multipágina futuro. El versionado por etapa
  es `max+1` con `uq_deliverable_stage_version` de backstop; un conflicto
  de versión (uploads concurrentes) → `409 "Deliverable version conflict"`
  con limpieza del archivo ya guardado. Un body de pin whitespace-only →
  `422` en la capa de schema.
- **Reuniones de proyecto.** `meeting_type` añade `survey` (levantamiento en
  sitio); el booking es por cualquier miembro con el proyecto `ACTIVE`, el
  asistente de Google Meet es el cliente del proyecto y el actor
  autenticado queda en `audit_logs` (`meeting.create`). Duración por
  defecto: `PROJECT_MEETING_MINUTES` (§5.2).

## 5. Integración con Google Calendar

La agenda del estudio se sincroniza con **Google Calendar API** mediante
**OAuth 2.0**.

### 5.1 Autorización OAuth 2.0

1. El estudio inicia el flujo desde el back-office; se redirige a Google con
   `GOOGLE_CLIENT_ID` y `GOOGLE_REDIRECT_URI`.
2. Google devuelve un `code` que se canjea por `access_token` + `refresh_token`.
3. El **`refresh_token`** se almacena en la variable de entorno
   `GOOGLE_REFRESH_TOKEN`. Un valor **vacío** significa que la integración está
   **desconectada**; en ese caso cualquier llamada a Calendar falla inmediatamente
   con `CalendarNotConnectedError`. El token **nunca** se expone en respuestas de
   API ni en mensajes de error.
4. Los scopes se limitan al mínimo necesario (`calendar.events`,
   `calendar.freebusy`, y el email de la cuenta cuando se requiera
   identificación).
5. **Comportamiento futuro (no implementado en Sprint 2):** si el
   `refresh_token` es revocado o inválido, marcar la integración como desconectada
   y solicitar reconexión, sin reintentos indefinidos. En Sprint 2 el fallo de
   Google se propaga como `CalendarAPIError` sin cambiar estado de conexión.

> **Decisión Sprint 2:** el flujo de consentimiento OAuth y la persistencia
> cifrada del `refresh_token` en base de datos se aplazan a un sprint posterior.
> Durante este sprint el token se lee directamente de `GOOGLE_REFRESH_TOKEN`.

Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_PROJECT_ID`, `GOOGLE_CALENDAR_ID` (por defecto `primary`),
`GOOGLE_REFRESH_TOKEN`.

### 5.2 Consulta de disponibilidad (`freebusy`)

- Antes de proponer un horario se consulta el endpoint **`freebusy`** de Google
  Calendar para el rango solicitado y el `GOOGLE_CALENDAR_ID` configurado.
- La respuesta se normaliza a intervalos ocupados y se calculan los huecos
  disponibles según la duración del `meeting_type`.
- La zona horaria se maneja explícitamente (UTC en persistencia, TZ del estudio
  para presentación).
- Las consultas de disponibilidad se pueden cachear brevemente, pero **nunca** se
  confirma una reunión sin una verificación final previa a la creación del
  evento.

El horario de operación del estudio se configura con:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `STUDIO_TIMEZONE` | `America/Mexico_City` | Zona horaria IANA para mostrar horarios hábiles. |
| `STUDIO_BUSINESS_START` | `09:00` | Inicio de la jornada (`HH:MM`). |
| `STUDIO_BUSINESS_END` | `18:00` | Fin de la jornada (`HH:MM`). |
| `DISCOVERY_CALL_MINUTES` | `30` | Duración por defecto de una Discovery Call. |
| `PROJECT_MEETING_MINUTES` | `60` | Duración por defecto de una reunión de proyecto (revisión o levantamiento). Sprint 4. |

### 5.3 Verificación final antes de confirmar

Antes de crear el evento remoto se ejecuta una verificación final y una reserva
local transaccional:

1. **`freebusy`** de Google sobre el slot exacto solicitado.
2. **Solapamiento local**: se consultan las reuniones de la base de datos con
   `status != cancelled` cuyo intervalo `[start_time, end_time)` intersecte el
   slot. Un solape produce `SlotUnavailableError` (HTTP `409`) sin crear evento.
3. Se inserta y confirma una reserva `scheduled`, todavía sin evento ni enlace.
   El índice parcial único `ux_meetings_start_time_active` sobre `start_time`
   (`status != 'cancelled'`) convierte una carrera perdedora en `IntegrityError`,
   que se traduce a HTTP `409`. Como todas las reservas Sprint 2 son Discovery
   Calls de 30 minutos alineadas a la retícula y usan un solo calendario, igual
   `start_time` es una invariante completa de solapamiento para estos casos.
4. Solo después de reservar se crea el evento remoto. Un fallo elimina la reserva
   antes de propagar el error; si la confirmación local falla tras crear el
   evento, se intenta borrar el evento y también la reserva.

La comprobación previa reduce llamadas remotas innecesarias y el invariante de
base de datos es la barrera frente a carreras; la comprobación por sí sola no se
presenta como prevención de carreras. Si un timeout deja un resultado incierto
(evento posiblemente creado pero respuesta perdida, sin `event_id` para
compensar), queda un residual: una tarea de reconciliación Google↔BD es trabajo
futuro y no forma parte de Sprint 2.

### 5.4 Creación de eventos con Google Meet

- Al confirmar una reunión se crea el evento con
  `conferenceDataVersion=1` y una `createRequest` de tipo `hangoutsMeet`, de modo
  que Google genera el enlace de **Google Meet** automáticamente.
- Tras reservar localmente, se persiste el identificador del evento y el enlace
  de Meet devueltos por la API y la reunión pasa a `confirmed`.
- Si la creación falla, se elimina la reserva y no queda reunión confirmada. Si
  Google devuelve un `event_id` pero ningún `entryPoint` de video, se intenta
  borrar ese evento antes de devolver `CalendarAPIError`.
- **Comportamiento futuro (no implementado en Sprint 2):** cancelar o
  reprogramar una reunión actualizando/eliminando el evento remoto y dejando
  rastro en `audit_logs`.

### 5.5 Tabla `meetings`

Cada reunión se vincula a un `lead_id` **o** a un `project_id` (nunca a ambos de
forma ambigua) y persiste:

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `lead_id` | UUID / null | Lead asociado (reuniones de captación). |
| `project_id` | UUID / null | Proyecto asociado (reuniones de seguimiento). |
| `google_event_id` | text | ID del evento en Google Calendar. |
| `meet_link` | text | URL de Google Meet generada por Google. |
| `start_time` | timestamptz | Inicio en UTC. |
| `end_time` | timestamptz | Fin en UTC. |
| `meeting_type` | enum/text | `discovery` \| `proposal` \| `review` \| `follow_up` \| `survey` (Sprint 4). Las reuniones de proyecto solo usan `review` y `survey`. |
| `status` | enum/text | `scheduled`, `confirmed`, `cancelled`, `completed`, `no_show`. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `end_time > start_time`, exactamente un padre (`lead_id` o
`project_id`), índices por `project_id`, `lead_id` y `start_time`, y el índice
parcial único `ux_meetings_start_time_active` para inicios no cancelados.

Las reuniones de proyecto (Sprint 4) las agenda cualquier miembro con el
proyecto `ACTIVE` — con una `stage_id` opcional que viaja en los metadatos de
la auditoría, no en la tabla — y el asistente de Google Meet es el cliente del
proyecto (o el correo del actor si el proyecto no tiene cliente).

### 5.6 Registro en `audit_logs`

En Sprint 2 la creación exitosa de una reunión se registra en `audit_logs` con
actor público `NULL`, `meeting_id`, `google_event_id`, `lead_id` e inicio. La
auditoría de reprogramación, cancelación, reconexión OAuth y fallos de
sincronización es **comportamiento futuro**, no implementado en ese sprint.

En Sprint 4, las reuniones de proyecto (revisión/levantamiento) también se
registran con `meeting.create`, pero con el **actor autenticado**
(`actor_user_id`) y `project_id` (más `stage_id` cuando se eligió etapa) en los
metadatos; la acción queda listada en §4.4.

## 6. Seguridad de la API

### 6.1 Endpoints introducidos en Sprint 2

Los siguientes contratos se implementaron durante el Sprint 2 (leads, proyectos,
reuniones y autenticación). Todos los paths usan el prefijo `/api/v1`.

| Método | Path | Roles permitidos | Propósito |
|---|---|---|---|
| `POST` | `/leads` | Público | Crear un lead desde el front-office. |
| `GET` | `/leads/availability?date=YYYY-MM-DD` | Público | Consultar slots disponibles para Discovery Calls. |
| `POST` | `/leads/{id}/meetings` | Público | Agendar una Discovery Call para un lead. |
| `GET` | `/leads` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Listar todos los leads (más recientes primero). |
| `GET` | `/leads/{id}` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Detalle de un lead. |
| `GET` | `/admin/leads/{id}/quote` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Cotizar un lead con la última `pricing_config`. |
| `POST` | `/admin/leads/{id}/proposal` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Generar propuesta y marcar el lead como `proposal_sent`. |
| `POST` | `/admin/leads/{id}/convert` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Convertir un lead en proyecto `draft`. |
| `GET` | `/admin/projects` | `SUPER_ADMIN`, `LEAD_DESIGNER` | Listar proyectos: `SUPER_ADMIN` ve todos; `LEAD_DESIGNER` solo los propios o con membresía. |
| `POST` | `/admin/projects/{id}/activate` | `SUPER_ADMIN` | Activar un proyecto `draft` tras recibir el anticipo. |
| `GET` | `/auth/me` | Cualquier usuario autenticado y activo | Perfil del usuario actual. |

La superficie pública de leads y agenda queda con **hardening pendiente (rate
limiting / mitigación de bots en superficie pública)**; no se implementó en
Sprint 2.

### 6.2 Endpoints introducidos en Sprint 3

Los siguientes contratos se implementaron durante el Sprint 3 (proyectos del
usuario, brief y moodboard). Todos los paths usan el prefijo `/api/v1`.

| Método | Path | Roles permitidos | Propósito |
|---|---|---|---|
| `GET` | `/projects` | Cualquier usuario autenticado y activo | Proyectos del usuario: `SUPER_ADMIN` ve todos; el resto solo los de su membresía (más recientes primero). |
| `GET` | `/projects/{id}` | Miembros del proyecto / `SUPER_ADMIN` | Detalle de un proyecto. |
| `GET` | `/projects/{pid}/brief` | Cualquier miembro | Listar el brief (preguntas y referencias, más antiguos primero). |
| `POST` | `/projects/{pid}/brief/questions` | Equipo | Crear una pregunta del cuestionario (proyecto `ACTIVE`). |
| `PATCH` | `/projects/{pid}/brief/items/{id}` | `CLIENT` con membresía `CLIENT` | Responder/actualizar la respuesta de una pregunta (proyecto `ACTIVE`). |
| `POST` | `/projects/{pid}/brief/references` | Cualquier miembro | Subir un archivo de referencia (multipart; proyecto `ACTIVE`). |
| `GET` | `/projects/{pid}/brief/items/{id}/file` | Cualquier miembro | Descargar el archivo de una referencia. |
| `GET` | `/projects/{pid}/moodboard` | Cualquier miembro | Listar piezas con conteos (`like`/`dislike`/`comment`) y `my_reaction`. |
| `POST` | `/projects/{pid}/moodboard` | Equipo | Subir una pieza (multipart, solo imágenes; proyecto `ACTIVE`). |
| `DELETE` | `/projects/{pid}/moodboard/items/{id}` | Equipo | Eliminar pieza, sus reacciones y su archivo (proyecto `ACTIVE`). |
| `GET` | `/projects/{pid}/moodboard/items/{id}/file` | Cualquier miembro | Descargar la imagen de una pieza. |
| `POST` | `/projects/{pid}/moodboard/items/{id}/reactions` | `CLIENT` con membresía `CLIENT` | Upsert de la reacción propia (201 nueva, 200 reemplaza; proyecto `ACTIVE`). |
| `DELETE` | `/projects/{pid}/moodboard/items/{id}/reactions` | `CLIENT` con membresía `CLIENT` | Eliminar la reacción propia (proyecto `ACTIVE`). |
| `GET` | `/projects/{pid}/moodboard/items/{id}/reactions` | Cualquier miembro | Listar las reacciones de una pieza (más antiguas primero). |

Reglas de acceso específicas de Sprint 3:

- **Lecturas** (listados, detalle y descargas): cualquier miembro del proyecto,
  con cualquier `status`; `SUPER_ADMIN` pasa siempre.
- **Escrituras** (crear preguntas, responder, subir referencias o piezas,
  reaccionar, eliminar): exigen `project.status == ACTIVE`; si no → `409
  "Project is not active"`.
- **Equipo** (`require_team_member`): `SUPER_ADMIN` pasa; `LEAD_DESIGNER`
  requiere membresía `assigned_role=LEAD_DESIGNER` **o** ser
  `project.lead_designer_id`; `COLLABORATOR` requiere membresía
  `assigned_role=COLLABORATOR`. Sin membresía → `403 "No access to this
  project"`; membresía insuficiente (incluido `CLIENT`) → `403 "Insufficient
  permissions"`.
- **Acciones de cliente** (responder el brief, reaccionar): rol `CLIENT` más
  membresía `assigned_role=CLIENT` en el proyecto.
- **Aislamiento por ítem:** toda consulta filtra `id == item_id AND project_id
  == project_id del path`; un id de ítem de otro proyecto responde `404`, sin
  fuga de existencia.

Queda con **hardening pendiente** (documentado, no implementado en Sprint 3):
la carrera de INSERT concurrente en el upsert de reacciones (bajo carrera
extrema un `IntegrityError` puede llegar como `500`; el único
`uq_moodboard_reaction_user` impide duplicados), la verificación de tamaño en
streaming para uploads (hoy se lee el archivo completo en memoria) y el focus
trap con cierre por `Escape` en el overlay del moodboard.

### 6.3 Uploads y descarga de medios (Sprint 3)

- **Límite de tamaño:** 10 MiB (10 485 760 bytes) por archivo → `413 "File
  exceeds the 10 MiB limit"`.
- **Tipos permitidos:** referencias de brief aceptan `image/jpeg`,
  `image/png`, `image/webp`, `image/gif` y `application/pdf`; el moodboard
  acepta **solo las cuatro imágenes**. Tipo no permitido → `422 "Unsupported
  file type"`.
- **Notas de referencia:** máximo 1000 caracteres → `422 "Note exceeds the
  1000 character limit"`.
- El nombre de archivo del cliente **nunca** construye rutas: la extensión la
  deriva el servidor del content-type validado y la clave es
  `<project_id>/<uuid_hex><ext>` (servicio `LocalStorage` sobre `MEDIA_ROOT`).
  Las claves se validan contra la raíz para rechazar rutas absolutas y
  traversal (`../`).
- **Descarga solo autenticada:** los archivos se sirven por endpoints `/file`
  con guard de membresía; no hay mount público de estáticos.
- El whitelist se evalúa sobre el content-type declarado; el sniffing de magic
  bytes queda fuera de alcance.

### 6.4 Validaciones transversales

Todo endpoint protegido aplica, **en este orden**, las siguientes validaciones:

1. **Autenticación** — token JWT válido, no expirado y con firma correcta. Sin
   token o con token inválido → `401 Unauthorized`.
2. **Cuenta activa (`is_active`)** — el usuario debe existir y tener
   `is_active == True`. Una cuenta desactivada pierde acceso de inmediato
   (*kill switch*), incluso si su token aún no expiró → `403 Forbidden`.
3. **Rol permitido** — el rol del usuario debe estar en la lista de roles
   autorizados del endpoint. Rol insuficiente → `403 Forbidden`.
4. **Propiedad/membresía de `project_id`** — cuando el recurso pertenece a un
   proyecto, se verifica que el usuario sea el líder, tenga membresía activa en
   `project_members` o sea el cliente propietario. Sin relación → `403`/`404`
   (sin filtrar la existencia del recurso).

Principios adicionales:

- **Nunca** confiar en el ocultamiento visual del frontend: toda regla se
  revalida en el servidor.
- Dependencias reutilizables en `app/api/deps.py` (`get_current_user`,
  `require_roles(...)`, `require_project_access(...)`) para evitar lógica de
  autorización duplicada.
- Validación de entrada con Pydantic; rechazo de campos desconocidos en payloads
  sensibles.
- Mensajes de error genéricos hacia el cliente; detalle completo solo en logs
  internos.
- Secretos exclusivamente por variables de entorno; prohibido hardcodearlos.
- CORS restringido a los orígenes del frontend (`localhost:3000` en desarrollo).

### 6.5 Endpoints introducidos en Sprint 4

Los siguientes contratos se implementaron durante el Sprint 4 (etapas,
entregables versionados, pines, rondas de cambio y reuniones de proyecto).
Todos los paths usan el prefijo `/api/v1`.

| Método | Path | Roles permitidos | Propósito |
|---|---|---|---|
| `GET` | `/projects/{pid}/stages` | Cualquier miembro / `SUPER_ADMIN` | Listar las etapas del proyecto en orden de flujo (`order_index`), cualquier `status`. |
| `POST` | `/projects/{pid}/stages` | Equipo (`require_team_member`) | Crear una etapa (proyecto `ACTIVE`): nace `ACTIVE` si todas las etapas de `order_index` menor están `APPROVED`; si no, `LOCKED`. Duplicado de `order_index` → `409 "Stage order already exists"`. |
| `POST` | `/projects/{pid}/stages/{sid}/approve` | `CLIENT` con membresía `CLIENT` | Aprobar una etapa `ACTIVE` (proyecto `ACTIVE`) y desbloquear la siguiente `LOCKED` por `order_index`. |
| `GET` | `/projects/{pid}/stages/{sid}/deliverables` | Cualquier miembro | Listar las versiones del entregable de la etapa (ascendente por versión), cualquier `status`. |
| `POST` | `/projects/{pid}/stages/{sid}/deliverables` | Equipo | Subir una nueva versión (multipart: `file` imagen + `title`; proyecto y etapa `ACTIVE`). Versión = max+1 → conflicto `409 "Deliverable version conflict"` (con limpieza del archivo); `413` > 10 MiB; `422` tipo no soportado. |
| `GET` | `/projects/{pid}/deliverables/{did}` | Cualquier miembro | Detalle de una versión (nunca expone `storage_key`). |
| `GET` | `/projects/{pid}/deliverables/{did}/file` | Cualquier miembro | Descargar el archivo de la versión. |
| `GET` | `/projects/{pid}/deliverables/{did}/comments` | Cualquier miembro | Listar los pines del entregable (orden de creación). |
| `POST` | `/projects/{pid}/deliverables/{did}/comments` | `CLIENT` con membresía `CLIENT` | Crear un pin sobre una versión `IN_REVIEW` (proyecto y etapa `ACTIVE`): `round_number = included − remaining + 1`, `consumes_round = False`; body en blanco → `422`. |
| `POST` | `/projects/{pid}/deliverables/{did}/approve` | `CLIENT` con membresía `CLIENT` | Aprobar una versión (proyecto y etapa `ACTIVE`); ya aprobada → `409 "Deliverable is already approved"`. |
| `POST` | `/projects/{pid}/deliverables/{did}/request-changes` | `CLIENT` con membresía `CLIENT` | Solicitar cambios en una versión `IN_REVIEW` (proyecto y etapa `ACTIVE`): consume una ronda y marca los pines pendientes; sin rondas → `409 "No remaining change rounds"`. |
| `GET` | `/projects/{pid}/meetings` | Cualquier miembro | Listar las reuniones del proyecto (por inicio). |
| `GET` | `/projects/{pid}/meetings/availability?date=YYYY-MM-DD` | Cualquier miembro | Slots de revisión/levantamiento para una fecha (fecha pasada → `422`; calendario desconectado → `503`; Google caído → `502`). |
| `POST` | `/projects/{pid}/meetings` | Cualquier miembro | Agendar una reunión de revisión o levantamiento (proyecto `ACTIVE`; `meeting_type` ∈ `review` \| `survey`; `stage_id` opcional; slot tomado → `409 "Slot no longer available"`). |
| `POST` | `/admin/projects/{pid}/extra-round` | `SUPER_ADMIN`, `LEAD_DESIGNER` con acceso de equipo | Habilitar una ronda extra (proyecto `ACTIVE`): incrementa `included_rounds` y `remaining_rounds`. `COLLABORATOR` → `403 "Insufficient permissions"` (role gate). |

Reglas de acceso específicas de Sprint 4:

- **Lecturas** (etapas, versiones, pines, archivos y reuniones): cualquier
  miembro del proyecto, con cualquier `status`; `SUPER_ADMIN` pasa siempre.
- **Escrituras:** exigen `project.status == ACTIVE` (si no → `409 "Project is
  not active"`). Las mutaciones de entregables y pines exigen además una etapa
  `ACTIVE` (`409 "Stage is locked"` / `409 "Stage is already approved"`) y,
  para pines y solicitar cambios, una versión `IN_REVIEW` (`409 "Deliverable
  is not in review"`); aprobar solo exige una versión no aprobada (`409
  "Deliverable is already approved"`).
- **Equipo** (`require_team_member`): misma semántica que Sprint 3
  (`SUPER_ADMIN` pasa; `LEAD_DESIGNER` con membresía o asignación;
  `COLLABORATOR` con membresía).
- **Acciones de cliente** (aprobar etapa, pinear, aprobar versión, solicitar
  cambios): rol `CLIENT` más membresía `assigned_role=CLIENT`. La aprobación de
  etapa es solo del cliente asignado.
- **Extra-round:** role gate `SUPER_ADMIN`/`LEAD_DESIGNER` **más**
  `require_team_member` (la dirección requiere membresía `LEAD_DESIGNER` o ser
  el `lead_designer_id` del proyecto).
- **Aislamiento por id:** toda consulta de etapa o entregable filtra por el
  `project_id` del path; un id de otro proyecto responde `404`, sin fuga de
  existencia.
- **Reuniones de proyecto:** el booking lo hace cualquier miembro (incluido el
  cliente) con el proyecto `ACTIVE`; el asistente del Meet es el cliente del
  proyecto. La duración la fija `PROJECT_MEETING_MINUTES` (§5.2).

Queda con **hardening pendiente** (documentado, no implementado en Sprint 4):

- La carrera de decremento concurrente de `remaining_rounds`: el guard
  secuencial (`remaining_rounds <= 0` → `409`) garantiza el piso 0, pero no hay
  lock de fila ni `UPDATE` condicional, así que dos `request-changes`
  concurrentes pueden decrementar desde el mismo valor leído.
- La serialización de uploads concurrentes de versiones: la versión se calcula
  como `max+1` sin lock; el único backstop es
  `uq_deliverable_stage_version`, que convierte al perdedor en `409` (con
  limpieza del archivo).
- El soporte PDF/multipágina del visor: `page_or_frame` se persiste (default 1)
  pero este sprint solo acepta imágenes.
- El focus trap y el cierre con `Escape` en el visor de pines.
- La creación de pines por teclado: hoy la colocación es pointer-only (los
  marcadores existentes sí son activables con `Enter`/`Space`).
- El quirk preexistente (Sprint 3) de whitespace en comentarios del moodboard:
  `MoodboardReactionCreate` normaliza el comentario con `strip()` antes de
  persistirlo (mutación silenciosa del texto del usuario), mientras que los
  pines de entregables se guardan verbatim y solo se rechaza el body en blanco;
  unificar el criterio queda pendiente.

### 6.6 Endpoints introducidos en Sprint 5

Durante el Sprint 5 se introdujeron los endpoints de publicación de entregables,
control de borradores, marcas de agua y descarga restringida para entrega final
(*final handover*), validación de liquidación final del proyecto y el catálogo de
especificaciones FF&E para ejecución externa. Todos los paths operan bajo el prefijo
`/api/v1`.

| Método | Path | Roles permitidos | Propósito |
|---|---|---|---|
| `POST` | `/admin/projects/{project_id}/validate-final-payment` | `SUPER_ADMIN` | Validar el pago final o liquidación del proyecto (`balance_paid = True`). Audita `project.final_payment_validated`. |
| `POST` | `/projects/{project_id}/deliverables/{id}/publish` | `LEAD_DESIGNER`, `SUPER_ADMIN` con membresía/rol de equipo | Publicar un entregable hacia el portal del cliente (`is_client_visible = True`, `published_at = now()`, `published_by = actor_id`). Proyecto `ACTIVE`. Audita `deliverable.publish`. |
| `POST` | `/projects/{project_id}/deliverables/{id}/unpublish` | `LEAD_DESIGNER`, `SUPER_ADMIN` con membresía/rol de equipo | Revertir un entregable a borrador interno (`is_client_visible = False`, `published_at = NULL`, `published_by = NULL`). Proyecto `ACTIVE`. Audita `deliverable.unpublish`. |
| `POST` | `/projects/{project_id}/deliverables/{id}/final-handover` | `LEAD_DESIGNER`, `SUPER_ADMIN` con membresía/rol de equipo | Marcar un entregable como entrega final sujeta a validación de pago (`is_final_handover = True`). Proyecto `ACTIVE`. Audita `deliverable.final_handover`. |
| `GET` | `/projects/{project_id}/deliverables/{id}/preview` | Cualquier miembro autorizado a ver el entregable | Previsualización JPEG con marca de agua diagonal (`"POMME STUDIO · PREVIEW"`): endpoint de previsualización que siempre renderiza la imagen con marca de agua (independientemente de `balance_paid`). El archivo original sin marca de agua se sirve exclusivamente vía `/file`. |
| `GET` | `/projects/{project_id}/deliverables/{id}/file` | Miembros del proyecto con visibilidad (sujeto a gate de liquidación) | Descarga del binario original sin marca de agua. Gate: si `is_final_handover = True`, `balance_paid = False` y el solicitante es `CLIENT`, se bloquea con `403 Forbidden` (`"Final balance pending"`). El equipo del estudio siempre puede descargar el original sin restricciones; una vez validado `balance_paid = True`, el cliente también puede descargarlo libremente. |
| `GET` | `/projects/{project_id}/specifications` | Cualquier miembro del proyecto / `SUPER_ADMIN` | Listar especificaciones FF&E del proyecto ordenadas por `created_at` ascendente. |
| `POST` | `/projects/{project_id}/specifications` | Equipo del proyecto (`require_team_member`, proyecto `ACTIVE`) | Crear especificación FF&E. Nombre no vacío (`ck_specification_name`). Audita `specification.create`. |
| `GET` | `/projects/{project_id}/specifications/{id}` | Cualquier miembro del proyecto / `SUPER_ADMIN` | Consultar detalle de una especificación FF&E por ID. |
| `PATCH` | `/projects/{project_id}/specifications/{id}` | Equipo del proyecto (`require_team_member`, proyecto `ACTIVE`) | Actualizar campos de una especificación FF&E. Audita `specification.update`. |
| `DELETE` | `/projects/{project_id}/specifications/{id}` | Equipo del proyecto (`require_team_member`, proyecto `ACTIVE`) | Eliminar una especificación FF&E. Audita `specification.delete`. |

#### Reglas de visibilidad y borradores (*Draft / Publish gates*)

- **Creación según rol:** cuando un miembro con rol `COLLABORATOR` sube una versión de
  entregable (`POST /projects/{pid}/stages/{sid}/deliverables`), nace automáticamente
  como borrador interno (`is_client_visible = False`, `published_at = NULL`,
  `published_by = NULL`). Cuando quien sube es `LEAD_DESIGNER` o `SUPER_ADMIN`, nace
  inmediatamente publicada (`is_client_visible = True`, `published_at = now()`,
  `published_by = actor_id`).
- **Aislamiento en portal de cliente:** los usuarios con rol `CLIENT` únicamente
  tienen visibilidad de versiones publicadas (`is_client_visible = True`). En listados
  (`/stages/{sid}/deliverables`), los borradores son omitidos silenciosamente. En
  endpoints directos (`/deliverables/{id}`, `/deliverables/{id}/file`,
  `/deliverables/{id}/preview`, `/comments`), si un cliente consulta una versión en
  borrador se responde `404 Not Found`, sin filtrar su existencia.
- **Acceso del equipo:** `SUPER_ADMIN`, `LEAD_DESIGNER` y `COLLABORATOR` asignados al
  proyecto tienen acceso irrestricto tanto a borradores como a entregables publicados.
- **Permisos de publicación:** únicamente `LEAD_DESIGNER` (del proyecto) o
  `SUPER_ADMIN` (con acceso de equipo) pueden publicar (`/publish`), despublicar
  (`/unpublish`) o marcar entrega final (`/final-handover`). Un `COLLABORATOR` recibe
  `403 Forbidden` (`"Insufficient permissions"`).

#### Regla de entrega final y gate de pago (*Final Handover & Balance Gate*)

- **Desacople de activación:** la activación del proyecto (`POST /admin/projects/{id}/activate`)
  habilita el proyecto como `ACTIVE`, pero no afecta `balance_paid` (permanece en `False`).
- **Gate de entrega final:** cualquier entregable marcado como `is_final_handover = True`
  permanece condicionado a que el proyecto tenga `balance_paid = True` para la descarga del
  archivo original por parte del cliente.
- **Endpoint de preview (`GET /preview`):**
  - Devuelve siempre una previsualización JPEG generada en memoria con Pillow (`PIL`),
    superponiendo de forma diagonal y repetida el texto de marca de agua
    `"POMME STUDIO · PREVIEW"` en gris semi-transparente (`(120, 120, 120, 140)` rotado 30°).
  - Está disponible para cualquier miembro con acceso al entregable (cliente o equipo)
    sin importar el estado de `balance_paid`. Permite al cliente inspeccionar visualmente
    la entrega final mientras su saldo final está pendiente de liquidación.
- **Endpoint de archivo original (`GET /file`):**
  - Sirve el binario original íntegro y sin marca de agua.
  - Si el entregable tiene `is_final_handover = True` y el proyecto tiene `balance_paid = False`:
    - El cliente (`CLIENT`) tiene bloqueada la descarga, respondiendo con `403 Forbidden`
      (`"Final balance pending"`).
    - El equipo del estudio (`LEAD_DESIGNER`, `COLLABORATOR`, `SUPER_ADMIN`) puede descargar
      el original sin restricciones en todo momento para control de calidad y revisión técnica.
- **Liberación de descarga:** `SUPER_ADMIN` valida el pago final invocando
  `POST /admin/projects/{project_id}/validate-final-payment`, lo cual establece
  `balance_paid = True` y audita `project.final_payment_validated`. A partir de ese
  momento, la descarga del archivo original sin marca de agua vía `GET /file` queda
  completamente habilitada para el cliente.

## 7. UI / Diseño — *Tactile Brutalism*

La interfaz sigue la estética **Tactile Brutalism**: retícula editorial inspirada
en planos arquitectónicos y diseño editorial suizo. Es deliberadamente sobria,
monocromática y táctil.

### 7.1 Paleta

| Token | Valor | Uso |
|---|---|---|
| `background` | `#F7F7F5` | Fondo principal y celdas de la retícula. |
| `foreground` | `#111111` | Tinta, texto y bordes. |
| `surface` | `#EFECE6` | Superficie secundaria (paneles, bloques destacados). |
| `border` | `#111111` | Bordes de `1px solid`. |

Prohibido: `box-shadow`, degradados y colores saturados innecesarios.

### 7.2 Geometría y retícula

- **`border-radius: 0px`** estricto en tarjetas, botones, inputs y modales. El
  reset global vive en `globals.css`.
- Bordes de `1px solid #111111`.
- Las retículas se construyen con `gap: 1px` sobre un contenedor con fondo
  `#111111`, de modo que las celdas `#F7F7F5` producen separadores de exactamente
  1px y se evitan bordes dobles.

```css
.grid-brutal {
  display: grid;
  gap: 1px;
  background: #111111;   /* líneas de la retícula */
  border: 1px solid #111111;
}
.grid-brutal > * {
  background: #F7F7F5;   /* celda */
  border-radius: 0;
}
```

### 7.3 Tipografía y detalles

- Títulos en sans-serif geométrica con `letter-spacing: -0.03em`.
- Etiquetas y numeraciones (`01`, `02`, `03`, `04`) en mayúsculas monospace de
  `11px` con `letter-spacing: 0.08em`.
- Íconos monocromáticos de línea fina (`1.25px`).
- Botones con flecha diagonal `↗` que invierten colores en `:hover` (fondo
  `#111111`, texto `#F7F7F5`).

### 7.4 Mobile-first

- Diseño desde `375px` en adelante; el escritorio es una mejora progresiva.
- En móvil las retículas colapsan a `1fr` conservando `gap: 1px`.
- Áreas táctiles mínimas de `44px × 44px`.
- Interacción por `onTap`/`onClick`; ninguna función crítica depende de `hover`.
- El visor de pines de entregables soporta pinch-zoom y gestos táctiles.

### 7.5 PWA

- `manifest` (`manifest.json` / `app/manifest.ts`) con nombre, `start_url`,
  `display: standalone`, `background_color: #F7F7F5` y
  `theme_color: #111111`.
- Iconos **ortogonales** monocromáticos de `192×192` y `512×512`, sin degradados,
  coherentes con la estética.
- El manifiesto se referencia desde `app/layout.tsx`; la app debe ser instalable
  en móvil y funcionar correctamente con viewport seguro.

### 7.6 Portal de clientes y gestión de equipo (Sprint 3)

- **Portal `/portal`** (rol `CLIENT`): listado de los proyectos del cliente
  (`GET /api/v1/projects`), brief en `/portal/projects/{id}/brief` (responder
  cuestionario, subir referencias, descargar archivos) y moodboard en
  `/portal/projects/{id}/moodboard`. Las reacciones (me gusta / no me gusta /
  comentar) son botones táctiles de ≥ 44×44px con `aria-pressed`, sin depender
  de `hover`; tocar una imagen abre un overlay a pantalla completa con
  `touch-action: pinch-zoom` y botón de cierre ≥ 44px.
- **Gestión de equipo:** `/admin/projects/{id}/brief` (crear preguntas, ver
  respuestas del cliente, descargar referencias) y
  `/admin/projects/{id}/moodboard` (subir y eliminar piezas, ver conteos y
  comentarios). La eliminación usa confirmación inline de dos pasos.
- **Enrutado por rol:** el login redirige `CLIENT` → `/portal` y al equipo →
  `/admin`; el layout de admin reenvía a `/portal` cualquier `CLIENT`. Los
  `COLLABORATOR` cargan su lista de proyectos desde `GET /api/v1/projects`
  (endpoint de membresía) en lugar de `/api/v1/admin/projects`.
- **Pendiente:** focus trap y cierre con `Escape` en el overlay del moodboard.

### 7.7 Etapas, visor de pines y reuniones (Sprint 4)

- **Portal `/portal`** (rol `CLIENT`): `/portal/projects/{id}/etapas` —
  listado de etapas con estado, entregables por etapa y aprobación de etapa
  con confirmación inline de dos pasos —, `/portal/projects/{id}/entregables/{did}`
  — visor del entregable — y `/portal/projects/{id}/reuniones` — agenda de
  revisiones y levantamientos.
- **Gestión de equipo:** `/admin/projects/{id}/etapas` — crear etapas
  (nombre + orden), subir versiones a etapas `ACTIVE` (multipart), consultar
  pines en modo lectura, habilitar rondas extra con confirmación inline de
  dos pasos (el servidor rechaza a `COLLABORATOR` con `403` y el error se
  muestra al usuario) y agendar reuniones con el `MeetingScheduler` alimentado
  por las etapas del proyecto. El listado de proyectos enlaza cada tarjeta a
  Brief, Moodboard y Etapas.
- **Visor de pines táctil:** la colocación de pines es por toque
  (`pointerup` con tap-slop de 6 px), el zoom es de 1–4× por pinch o botones
  `−`/`+` ≥ 44px, y el desplazamiento es con un dedo; ninguna acción crítica
  depende de `hover`. Los marcadores existentes son activables por teclado
  (`Enter`/`Space`); la creación de pines es pointer-only (hardening
  pendiente, §6.5). Con `canReview = false` — el modo del equipo — los pines
  son de solo lectura y solo queda la descarga.

### 7.8 Sprint 5 — UI de borradores, FF&E y liberación por pago

- **Admin visibilidad de entregables:** en `/admin/projects/{id}/etapas`, los entregables muestran badges `BORRADOR`/`PUBLICADO` y `ENTREGA FINAL`; disponen de botones de acción para publicar, despublicar (con confirmación de 2 pasos) y marcar/desmarcar entrega final, restringidos a `LEAD_DESIGNER` y `SUPER_ADMIN` (`COLLABORATOR` ve solo badges).
- **Validación de pago final:** en `/admin/projects`, se añade el botón "Validar pago final" (restringido a `SUPER_ADMIN` cuando `!project.balance_paid`) que invoca `POST /admin/projects/{id}/validate-final-payment`.
- **Catálogo FF&E Admin (CRUD):** nueva ruta `/admin/projects/{id}/especificaciones` con listado, creación, edición en línea y eliminación (confirmación de 2 pasos) de especificaciones FF&E categorizadas (`furniture`, `lighting`, `finishes`, `equipment`, `other`) y enlace a URL externa (`reference_url`).
- **Portal Cliente FF&E (solo lectura):** nueva ruta `/portal/projects/{id}/especificaciones` con catálogo de solo lectura sin controles de escritura; enlace "Catálogo FF&E" desde `/portal`.
- **Visor Cliente con previsualización y candado de descarga:** `DeliverableViewer` conmuta la fuente de imagen a `/preview` (con marca de agua diagonal `"POMME STUDIO · PREVIEW"`) y oculta/bloquea el botón de descarga mostrando el aviso `"PAGO FINAL PENDIENTE · PREVISUALIZACIÓN"` cuando el entregable es `is_final_handover` y `balance_paid == False`. En `/portal/.../etapas`, los entregables muestran los badges `"ENTREGA FINAL"` y `"PAGO PENDIENTE"`.

## 8. Convenciones de contribución

- Un sprint por turno: migraciones, tipado, manejo de errores y pruebas en el
  mismo cambio.
- Toda tabla nueva requiere modelo SQLAlchemy, esquema Pydantic, migración
  Alembic y pruebas.
- Los endpoints nuevos documentan rol permitido y regla de acceso a
  `project_id`.
- `pytest tests/backend -v` debe pasar antes de integrar.
- Los cambios de contrato (variables de entorno, endpoints, entidades) se
  reflejan en este documento y en `.env.example`.
