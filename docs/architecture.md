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

### 4.3 Entidades principales (conceptuales)

| Entidad | Rol en el negocio |
|---|---|
| `users` | Cuentas con rol, `is_active` y credenciales. |
| `leads` | Prospectos del front-office; origen de reuniones y propuestas. |
| `projects` | Proyecto de diseño con cliente, líder y miembros. |
| `project_members` | Membresía usuario↔proyecto (base del control de acceso). |
| `deliverables` | Entregables versionados con pines/comentarios y aprobación. |
| `ffe_items` | Especificaciones FF&E (ficha, acabado, proveedor sugerido, estado). |
| `pricing_config` | Reglas de precios editables por `SUPER_ADMIN`. |
| `payments` | Pagos y liquidaciones sujetos a validación. |
| `meetings` | Reuniones sincronizadas con Google Calendar. |
| `audit_logs` | Bitácora inmutable de acciones sensibles. |

### 4.4 Auditoría

Toda acción sensible (cambios de rol, activación/desactivación de cuentas,
edición de `pricing_config`, validación de pagos, creación/cancelación de
reuniones y acceso a datos de otro usuario) se registra en `audit_logs` con
actor, acción, entidad afectada, timestamp y metadatos relevantes.

## 5. Integración con Google Calendar

La agenda del estudio se sincroniza con **Google Calendar API** mediante
**OAuth 2.0**.

### 5.1 Autorización OAuth 2.0

1. El estudio inicia el flujo desde el back-office; se redirige a Google con
   `GOOGLE_CLIENT_ID` y `GOOGLE_REDIRECT_URI`.
2. Google devuelve un `code` que se canjea por `access_token` + `refresh_token`.
3. El **`refresh_token`** se persiste **cifrado** (nunca en logs, nunca en
   respuestas de API) y se usa para renovar el `access_token` de forma
   silenciosa antes de cada llamada.
4. Los scopes se limitan al mínimo necesario (`calendar.events`,
   `calendar.freebusy`, y el email de la cuenta cuando se requiera
   identificación).
5. Si el `refresh_token` es revocado o inválido, se marca la integración como
   desconectada y se solicita reconexión; no se reintenta indefinidamente.

Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_PROJECT_ID`, `GOOGLE_CALENDAR_ID` (por defecto `primary`).

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

### 5.3 Creación de eventos con Google Meet

- Al confirmar una reunión se crea el evento con
  `conferenceDataVersion=1` y una `createRequest` de tipo `hangoutsMeet`, de modo
  que Google genera el enlace de **Google Meet** automáticamente.
- Se persiste el identificador del evento y el enlace de Meet devueltos por la
  API.
- Si la creación falla, la reunión no se marca como confirmada (consistencia
  entre Google y la base local).
- Cancelar o reprogramar una reunión actualiza/elimina el evento remoto y deja
  rastro en `audit_logs`.

### 5.4 Tabla `meetings`

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

Restricciones: `end_time > start_time`, sin solapamientos para el mismo
asistente interno, e índice por `project_id`, `lead_id` y `start_time`.

### 5.5 Registro en `audit_logs`

Toda operación sobre reuniones (creación, reprogramación, cancelación,
reconexión OAuth, fallo de sincronización) se registra en `audit_logs` con el
actor, el `meeting_id`, el `google_event_id` cuando exista y el resultado de la
operación.

## 6. Seguridad de la API

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
