# Plan de Implementación: Asignación de Cliente a Proyecto desde Interfaz (Admin y Lead Designer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuarios con rol `SUPER_ADMIN` y `LEAD_DESIGNER` puedan asignar o cambiar el cliente (`client_id`) de un proyecto de forma directa desde la interfaz de usuario en el panel de administración.

**Architecture:** 
1. Añadir un endpoint protegido en FastAPI (`PATCH /api/v1/projects/{project_id}/client`) que valide permisos (`SUPER_ADMIN` o `LEAD_DESIGNER` con membresía/acceso al proyecto) y actualice el `client_id` (y opcionalmente la tabla `project_members`).
2. Crear un endpoint `GET /api/v1/admin/users?role=CLIENT` (o similar) para listar usuarios con rol `CLIENT` disponibles para asignar.
3. Actualizar la vista del panel de administración del proyecto en Next.js (`frontend/app/admin/projects/[projectId]/page.tsx` o equivalente) para mostrar el cliente actual y un selector/modal para asignarlo o cambiarlo con los estilos *Tactile Brutalism*.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js (App Router), TypeScript, Tailwind CSS, pytest.

**Spec:** Requerimiento del usuario para facilitar la asignación de cuentas de clientes a proyectos directamente desde el UI.

## Global Constraints
- Estética *Tactile Brutalism* (bordes de `1px solid #111111`, fondo `#F7F7F5`, sin sombras).
- Mobile-First con áreas táctiles mínimas de `44px`.
- Roles autorizados: `SUPER_ADMIN` y `LEAD_DESIGNER`.
- Pruebas unitarias obligatorias en `pytest`.

---

## Task 1: Endpoint de Backend para Asignación de Cliente y Listado de Clientes

**Files:**
- Create/Modify: `backend/app/api/v1/endpoints/admin_projects.py` o `backend/app/api/v1/endpoints/projects.py`
- Test: `tests/backend/test_admin_projects.py` o nuevo test

**Interfaces:**
- Consumes: `project_id`, `client_id` (UUID o null)
- Produces: Project actualizado con el nuevo `client_id` y registro en `audit_logs`.

- [ ] **Step 1: Escribir test en `tests/backend/test_admin_projects.py` para asignar cliente a proyecto como Lead Designer y Admin**
- [ ] **Step 2: Ejecutar pytest para verificar fallo**
- [ ] **Step 3: Implementar endpoint `PATCH /api/v1/projects/{project_id}/client` y endpoint para listar clientes en el backend**
- [ ] **Step 4: Ejecutar pytest para verificar éxito**
- [ ] **Step 5: Commit**

---

## Task 2: Interfaz de Usuario en Panel de Administración (Frontend)

**Files:**
- Modify: `frontend/app/admin/projects/[projectId]/page.tsx` (o equivalente)
- Test/Verify: `npx tsc --noEmit` y `npm run build`

**Interfaces:**
- Consumes: Listado de usuarios clientes y cliente actual del proyecto.
- Produces: UI interactiva para asignar/cambiar cliente con selector y botón de guardado.

- [ ] **Step 1: Añadir componente de asignación de cliente en la página de detalle de proyecto del admin**
- [ ] **Step 2: Verificar compilación y tipos de TypeScript**
- [ ] **Step 3: Commit**
