# Creación Directa de Proyectos sin Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir la creación de proyectos directamente desde la vista de proyectos del panel de administración sin requerir un `lead_id`, asignando opcionalmente título, scope, cliente y diseñador líder.

**Architecture:**
1. **Backend:** Actualizar el esquema Pydantic para creación de proyectos (`ProjectCreate` o similar) para que `lead_id` sea opcional (`Optional[UUID] = None`), y asegurar que el endpoint POST permita crear proyectos directos.
2. **Frontend:** Añadir un botón y formulario modal en `/admin/projects` para crear un nuevo proyecto directamente, seleccionando título, scope (`branding`, `interior`, etc.), rondas incluidas, cliente y diseñador líder.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js (App Router), TypeScript, Tailwind CSS, pytest.

**Spec:** Los proyectos no deben requerir un lead obligatoriamente y se deben poder crear directamente desde la interfaz de proyectos.

## Global Constraints
- Estética *Tactile Brutalism* (`1px solid #111111`, fondo `#F7F7F5`, sin `box-shadow`).
- Mobile-First con áreas táctiles mínimas de `44px`.
- Roles autorizados: `SUPER_ADMIN` y `LEAD_DESIGNER`.
- Pruebas unitarias en `pytest`.

---

## Task 1: Backend Support for Direct Project Creation

**Files:**
- Modify: `backend/app/schemas/project.py`
- Modify: `backend/app/api/v1/endpoints/admin_projects.py`
- Test: `tests/backend/test_admin_projects.py`

- [ ] **Step 1: Escribir test en `tests/backend/test_admin_projects.py` para crear proyecto directo sin lead**
- [ ] **Step 2: Ejecutar pytest para verificar fallo**
- [ ] **Step 3: Actualizar esquema y endpoint POST `/api/v1/admin/projects` para aceptar `lead_id = None`**
- [ ] **Step 4: Ejecutar pytest y verificar éxito**
- [ ] **Step 5: Commit**

---

## Task 2: Frontend UI for Direct Project Creation

**Files:**
- Modify: `frontend/app/admin/projects/page.tsx`

- [ ] **Step 1: Añadir modal / formulario de creación de proyecto directo en `/admin/projects`**
- [ ] **Step 2: Verificar TypeScript (`npx tsc --noEmit`) y build (`npm run build`)**
- [ ] **Step 3: Commit y Push**
