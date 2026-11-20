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
| **Portal de clientes** | `CLIENT` | Consulta de proyectos, entregables, pines/decisiones, pagos y reuniones. |
| **Back-office interno** | `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR` | Gestión de leads, proyectos, entregables, FF&E, pricing, pagos y auditoría. |

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

- **Object storage compatible con S3** (Cloudflare R2 o AWS S3, o MinIO local).
- Bucket privado para entregables, planos, documentación ejecutiva y fichas de
  FF&E; los enlaces públicos se resuelven con `STORAGE_PUBLIC_URL`.
- Los binarios **no** se guardan en la base de datos: solo metadatos y la clave
  del objeto.
- Variables: `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_NAME`, `STORAGE_PUBLIC_URL`.

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
versionan secretos reales (`.env` está en `.gitignore`).

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
| `projects` | Proyecto de diseño con cliente, líder y miembros. | Sprint 1 + **Sprint 2** |
| `project_members` | Membresía usuario↔proyecto (base del control de acceso). | Sprint 1 |
| `deliverables` | Entregables versionados con pines/comentarios y aprobación. | Sprint 1 |
| `ffe_items` | Especificaciones FF&E (ficha, acabado, proveedor sugerido, estado). | Sprint 1 |
| `pricing_config` | Reglas de precios editables por `SUPER_ADMIN`. | Sprint 1 |
| `payments` | Pagos y liquidaciones sujetos a validación. | Sprint 1 |
| `meetings` | Reuniones sincronizadas con Google Calendar. | **Sprint 2** |
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
| `balance_paid` | bool | Indica si el anticipo fue recibido. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

`lead_id` tiene la restricción única `uq_projects_lead_id` para impedir conversiones
duplicadas; los proyectos legados pueden conservar `lead_id = NULL` (se permiten
múltiples valores NULL).

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
| `meeting_type` | enum | `discovery` \| `proposal` \| `review` \| `follow_up`. |
| `status` | enum | `scheduled` \| `confirmed` \| `cancelled` \| `completed` \| `no_show`. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `end_time > start_time`; exactamente uno de `lead_id` o `project_id` debe estar presente; índices sobre `lead_id`, `project_id` y `start_time`. El índice parcial único `ux_meetings_start_time_active` impide dos reuniones con el mismo `start_time` cuando `status != 'cancelled'`; para las Discovery Calls de 30 minutos sobre un único calendario, igual inicio equivale a solapamiento.

### 4.4 Auditoría

Toda acción sensible implementada (cambios de rol, activación/desactivación de
cuentas, edición de `pricing_config`, validación de pagos, creación de reuniones
y acceso a datos de otro usuario) se registra en `audit_logs` con actor, acción,
entidad afectada, timestamp y metadatos relevantes. La cancelación de reuniones
y su auditoría son comportamiento futuro, no parte de Sprint 2.

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
| `meeting_type` | enum/text | Tipo de reunión (p. ej. discovery, propuesta, revisión, seguimiento). |
| `status` | enum/text | `scheduled`, `confirmed`, `cancelled`, `completed`, `no_show`. |
| `created_at` / `updated_at` | timestamptz | Auditoría temporal. |

Restricciones: `end_time > start_time`, exactamente un padre (`lead_id` o
`project_id`), índices por `project_id`, `lead_id` y `start_time`, y el índice
parcial único `ux_meetings_start_time_active` para inicios no cancelados.

### 5.6 Registro en `audit_logs`

En Sprint 2 la creación exitosa de una reunión se registra en `audit_logs` con
actor público `NULL`, `meeting_id`, `google_event_id`, `lead_id` e inicio. La
auditoría de reprogramación, cancelación, reconexión OAuth y fallos de
sincronización es **comportamiento futuro**, no implementado en este sprint.

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

### 6.2 Validaciones transversales

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
