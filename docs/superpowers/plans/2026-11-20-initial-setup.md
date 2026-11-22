# Configuración inicial de pomme_studio

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el repositorio `pomme_studio_web` con la estructura modular inicial, documentación de arquitectura, variables de entorno, estilos base *Tactile Brutalism*, manifiesto PWA y los entornos de backend/frontend arrancando sin errores.

**Architecture:** Backend en FastAPI (Python) con SQLAlchemy 2.0 async/Alembic para PostgreSQL; frontend en Next.js 14 + TypeScript + Tailwind CSS; tests con `pytest`; RBAC con 4 roles; integración futura con Google Calendar OAuth/API. Todo el diseño visual se basa en *Tactile Brutalism* (paleta monocromática, bordes de 1px, grids con `gap: 1px`, `border-radius: 0`, mobile-first y PWA).

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, SQLAlchemy 2.0 async, Alembic, asyncpg, python-jose, passlib, boto3; Next.js 14 (App Router), TypeScript, Tailwind CSS; pytest; PostgreSQL; S3/R2-compatible storage; Google Calendar API.

**Spec:** Solicitud inicial del usuario + `AGENTS.md` del repositorio.

## Global Constraints

- Roles válidos: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`.
- El estudio vende **solo** diseño, dirección creativa, documentación ejecutiva y especificaciones (FF&E). Nada de ejecución de obra, montaje físico, inventario de obra, compras de construcción ni seguimiento de cuadrillas.
- Paleta *Tactile Brutalism*: fondo principal `#F7F7F5`, tinta/bordes `#111111`, superficie secundaria `#EFECE6`. Prohibido `box-shadow`, degradados y colores saturados innecesarios.
- `border-radius: 0px` en tarjetas, botones, inputs y modales. Bordes `1px solid #111111`. Grids con `gap: 1px` sobre fondo `#111111` y celdas `#F7F7F5` para evitar bordes dobles.
- Mobile-first (`375px` en adelante), grids colapsan a `1fr`, áreas táctiles mínimas `44px x 44px`, PWA con `manifest.json` e iconos ortogonales.
- Todo endpoint protegido debe validar: usuario autenticado, `is_active == True`, rol permitido y membresía/propiedad sobre `project_id` cuando aplique.
- Usar `pytest` para verificar que el entorno base arranca sin errores.

## Review Focus

- El backend arranca y responde en `/health` sin depender de variables de entorno reales (usa defaults en desarrollo).
- El frontend compila (`next build`) o al menos levanta el servidor de desarrollo sin errores de configuración de Tailwind.
- `.env.example` incluye **todas** las variables de PostgreSQL, autenticación, S3/R2, Google Calendar OAuth/API y entorno.
- `docs/architecture.md` documenta los 4 roles, las exclusiones de negocio y la integración con Google Calendar.
- El manifiesto PWA y los iconos ortogonales están presentes y referenciados en el layout.

---

### Task 1: Estructura modular de directorios

**Files:**
- Create: `backend/` con subárbol mínimo (`app/`, `alembic/`, `requirements.txt`, `pyproject.toml` si aplica).
- Create: `frontend/` con subárbol Next.js.
- Create: `tests/` con subárboles `backend/` y `frontend/`.
- Create: `docs/` con `architecture.md` (Task 3) y carpeta `superpowers/plans/` (ya existe).
- Create: `.gitkeep` o archivos `__init__.py` necesarios para que los paquetes Python sean importables.

**Interfaces:**
- Produces: Árbol de directorios listo para recibir código en ambos lados.

- [ ] **Step 1: Crear directorios y archivos base**

Crear la siguiente estructura:

```
backend/
  app/
    __init__.py
    main.py
    core/
      __init__.py
      config.py
      security.py
    db/
      __init__.py
      base.py
      session.py
    models/
      __init__.py
      user.py
    api/
      __init__.py
      deps.py
      v1/
        __init__.py
        router.py
        endpoints/
          __init__.py
          health.py
    schemas/
      __init__.py
      user.py
  alembic/
    versions/
      .gitkeep
  alembic.ini
  requirements.txt
frontend/
  app/
    layout.tsx
    page.tsx
    globals.css
    manifest.ts (o manifest.json en public/)
  components/
    ui/
      .gitkeep
  public/
    icons/
      icon-192x192.png
      icon-512x512.png
  lib/
    utils.ts
  tailwind.config.ts
  postcss.config.js
  next.config.js
  tsconfig.json
  package.json
tests/
  backend/
    __init__.py
    test_health.py
  frontend/
    .gitkeep
docs/
  architecture.md
  .gitkeep
.env.example
.gitignore
```

- [ ] **Step 2: Verificar estructura**

Run: `find backend frontend tests docs -type f | sort`
Expected: Lista coherente con la estructura definida.

---

### Task 2: Generar `.env.example`

**Files:**
- Create: `.env.example`

**Interfaces:**
- Produces: Variables de entorno documentadas para PostgreSQL, auth, S3/R2, Google Calendar y entorno.

- [ ] **Step 1: Crear `.env.example` con todas las variables requeridas**

Incluir al menos:

```ini
# Environment
ENVIRONMENT=development
DEBUG=true
SECRET_KEY=change-me-in-production

# PostgreSQL
POSTGRES_SERVER=localhost
POSTGRES_PORT=5432
POSTGRES_USER=pomme_user
POSTGRES_PASSWORD=pomme_password
POSTGRES_DB=pomme_studio
DATABASE_URL=postgresql+asyncpg://pomme_user:pomme_password@localhost:5432/pomme_studio

# Auth
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ALGORITHM=HS256

# S3 / R2-compatible object storage
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET_NAME=pomme-studio-assets
STORAGE_PUBLIC_URL=https://cdn.example.com

# Google Calendar OAuth / API
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
GOOGLE_PROJECT_ID=...
GOOGLE_CALENDAR_ID=primary
```

- [ ] **Step 2: Verificar que todas las categorías están presentes**

Run: `grep -E "^(# |POSTGRES|DATABASE|SECRET|ACCESS|REFRESH|STORAGE_|GOOGLE_|ENVIRONMENT|DEBUG)" .env.example | head -40`
Expected: Al menos una variable de cada categoría listada.

---

### Task 3: Documentar arquitectura en `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md`

**Interfaces:**
- Produces: Documento de arquitectura con stack, roles, reglas de negocio e integración Google Calendar.

- [ ] **Step 1: Escribir `docs/architecture.md`**

El documento debe contener secciones:

1. **Stack tecnológico** (backend, frontend, base de datos, storage, auth, testing).
2. **Roles y permisos** (`SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT`) con una breve descripción de cada uno.
3. **Reglas de negocio**: solo diseño, dirección creativa, documentación ejecutiva y FF&E. Exclusiones explícitas (obra, montaje, inventario, compras de construcción, cuadrillas).
4. **Integración con Google Calendar**: OAuth 2.0, `refresh_token`, tabla `meetings` (`google_event_id`, `meet_link`, `start_time`, `end_time`, `meeting_type`, `status`), `audit_logs`, consulta `freebusy` y creación de eventos con Google Meet.
5. **Seguridad API**: validación de autenticación, `is_active`, rol permitido y propiedad/membresía de `project_id`.
6. **UI / Diseño**: resumen de *Tactile Brutalism*, paleta, grid `gap: 1px`, mobile-first y PWA.

- [ ] **Step 2: Verificar cobertura de requisitos**

Run: `grep -iE "SUPER_ADMIN|LEAD_DESIGNER|COLLABORATOR|CLIENT|FF&E|obra|montaje|Google Calendar|freebusy|meetings|audit_logs|border-radius|#F7F7F5|#111111" docs/architecture.md`
Expected: Cada término clave aparece al menos una vez.

---

### Task 4: Configurar backend base (FastAPI)

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/main.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/security.py`
- Create: `backend/app/db/base.py`
- Create: `backend/app/db/session.py`
- Create: `backend/app/api/deps.py`
- Create: `backend/app/api/v1/router.py`
- Create: `backend/app/api/v1/endpoints/health.py`
- Create: `tests/backend/test_health.py`
- Create: `backend/alembic.ini` (mínimo, listo para migraciones futuras)
- Create: `.gitignore` si no existe (ignorar `__pycache__`, `.env`, `node_modules`, `.next`, etc.)

**Interfaces:**
- Produces: Aplicación FastAPI importable, endpoint `/api/v1/health`, configuración centralizada, seguridad base para JWT/RBAC.

- [ ] **Step 1: Crear `backend/requirements.txt`**

Incluir:

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
pydantic-settings>=2.6.0
sqlalchemy[asyncio]>=2.0.36
alembic>=1.14.0
asyncpg>=0.30.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
python-multipart>=0.0.17
boto3>=1.35.0
httpx>=0.27.0
pytest>=8.3.0
pytest-asyncio>=0.24.0
```

- [ ] **Step 2: Crear `backend/app/core/config.py`**

Definir `Settings` con pydantic-settings. Cargar variables desde entorno con defaults de desarrollo. Incluir secciones: app, database, auth, storage, google_calendar.

- [ ] **Step 3: Crear `backend/app/core/security.py`**

Definir funciones mínimas:
- `verify_password(plain: str, hashed: str) -> bool`
- `get_password_hash(password: str) -> str`
- `create_access_token(data: dict, expires_delta: timedelta | None = None) -> str`
- `decode_access_token(token: str) -> dict | None`

Usar `passlib` para hashes y `python-jose` para JWT con `SECRET_KEY` y `ALGORITHM` de config.

- [ ] **Step 4: Crear `backend/app/main.py`**

Crear instancia FastAPI con:
- `title="Pomme Studio API"`
- `version="0.1.0"`
- Incluir router `/api/v1`.
- Endpoint raíz opcional que redirija a `/api/v1/health` o devuelva metadata.
- Manejo básico de CORS para desarrollo (`localhost:3000`).

- [ ] **Step 5: Crear `backend/app/api/v1/endpoints/health.py`**

Definir `@router.get("/health")` que retorne `{"status": "ok"}`.

- [ ] **Step 6: Crear `tests/backend/test_health.py`**

```python
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 7: Crear `.gitignore`**

Incluir al menos:

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
.env
.venv/
venv/

# Node / Next.js
node_modules/
.next/
out/
*.log

# IDE
.vscode/
.idea/

# OS
.DS_Store
```

- [ ] **Step 8: Verificar que el backend arranca**

Run: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pytest ../tests/backend/test_health.py -v`
Expected: `test_health_check` pasa.

---

### Task 5: Configurar frontend base (Next.js + Tailwind + Tactile Brutalism)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/lib/utils.ts`

**Interfaces:**
- Produces: Proyecto Next.js 14 con App Router, Tailwind configurado con paleta *Tactile Brutalism* y estilos base sin `border-radius`.

- [ ] **Step 1: Crear `frontend/package.json`**

```json
{
  "name": "pomme-studio-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.18",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Crear `frontend/tsconfig.json`**

Configuración estándar de Next.js TypeScript con paths `@/*` apuntando a `./*`.

- [ ] **Step 3: Crear `frontend/tailwind.config.ts`**

Extender tema con colores:

```typescript
colors: {
  background: '#F7F7F5',
  foreground: '#111111',
  surface: '#EFECE6',
  border: '#111111',
}
```

Opcionalmente agregar plugin para resetear `border-radius` a `0` en componentes comunes si es necesario; preferir estilos explícitos en CSS base.

- [ ] **Step 4: Crear `frontend/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #F7F7F5;
  --foreground: #111111;
  --surface: #EFECE6;
}

html,
body {
  background-color: var(--background);
  color: var(--foreground);
}

* {
  border-radius: 0 !important;
}
```

- [ ] **Step 5: Crear `frontend/app/layout.tsx`**

Layout raíz con metadata base, importación de `globals.css` y configuración de viewport.

- [ ] **Step 6: Crear `frontend/app/page.tsx`**

Página inicial mínima que muestre el nombre del estudio, una retícula de ejemplo con `gap: 1px` sobre fondo `#111111` y un botón con flecha `↗` para validar los estilos base.

- [ ] **Step 7: Verificar build**

Run: `cd frontend && npm install && npm run build`
Expected: Build completa sin errores (pueden aparecer warnings de lint, pero no errores).

---

### Task 6: Configurar PWA (manifest e iconos ortogonales)

**Files:**
- Create: `frontend/app/manifest.ts` o `frontend/public/manifest.json`
- Create: `frontend/public/icons/icon-192x192.png`
- Create: `frontend/public/icons/icon-512x512.png`
- Modify: `frontend/app/layout.tsx` para referenciar `manifest.json`.

**Interfaces:**
- Produces: Manifiesto PWA válido e iconos ortogonales monocromáticos referenciados.

- [ ] **Step 1: Crear `frontend/public/manifest.json`**

```json
{
  "name": "Pomme Studio",
  "short_name": "Pomme",
  "description": "Branding y diseño de interiores",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F7F7F5",
  "theme_color": "#111111",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 2: Generar iconos ortogonales**

Crear dos PNG monocromáticos ortogonales (formas rectangulares/squares, sin degradados) de 192x192 y 512x512. Si no hay herramienta gráfica disponible, generar archivos SVG y convertirlos, o usar ImageMagick si está instalado. Los iconos deben reflejar la estética *Tactile Brutalism*.

- [ ] **Step 3: Referenciar manifiesto en layout**

En `frontend/app/layout.tsx`, añadir:

```tsx
export const metadata = {
  manifest: '/manifest.json',
  // ... otros metadatos
};
```

- [ ] **Step 4: Verificar archivos PWA**

Run: `ls -la frontend/public/manifest.json frontend/public/icons/`
Expected: `manifest.json` e iconos presentes.

---

### Task 7: Verificación final de arranque

**Files:**
- No crea archivos nuevos; verifica todo.

**Interfaces:**
- Produces: Confirmación de que backend y frontend arrancan sin errores y tests pasan.

- [ ] **Step 1: Ejecutar tests de backend**

Run: `cd backend && source .venv/bin/activate && pytest ../tests/backend -v`
Expected: Todos los tests pasan.

- [ ] **Step 2: Levantar backend y comprobar `/health`**

Run (en background): `cd backend && source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
Run: `curl -s http://localhost:8000/api/v1/health`
Expected: `{"status":"ok"}`.
Detener el servidor tras la prueba.

- [ ] **Step 3: Verificar build de frontend**

Run: `cd frontend && npm run build`
Expected: Build exitosa.

- [ ] **Step 4: Confirmar estructura final**

Run: `find backend frontend tests docs .env.example -type f | sort`
Expected: Todos los archivos planificados están presentes.

- [ ] **Step 5: Commit inicial**

```bash
git add .
git commit -m "chore: initial project setup with modular structure, docs, env, styles and PWA"
```

Expected: Commit creado sin errores.

---

## Self-Review

- **Spec coverage:**
  - Estructura modular → Task 1.
  - `.env.example` → Task 2.
  - `docs/architecture.md` → Task 3.
  - Backend FastAPI base → Task 4.
  - Estilos *Tactile Brutalism* → Task 5.
  - Manifiesto PWA e iconos → Task 6.
  - Verificación de arranque → Task 7.
- **Step scan:** Cada step define una acción concreta y verificable.
- **Type consistency:** No hay interfaces cruzadas complejas; el backend expone `/api/v1/health` y el frontend es independiente.
- **Review Focus:** Todos los puntos de riesgo tienen un step de verificación asociado.
- **Proportion:** El plan describe la configuración inicial sin escribir el cuerpo completo del código.
