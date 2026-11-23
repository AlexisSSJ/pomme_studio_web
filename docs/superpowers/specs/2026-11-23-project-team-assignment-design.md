# Project Team Assignment — Design

Status: approved by the user on 2026-11-23 (with the style amendment: the
project overview page and the team panel use the editorial style of the
brief pages and the new editorial navs, not the brutalist style).

## Intent

Projects are no longer single-person engagements: SUPER_ADMIN and the
project's lead designer manage the project's team (add/remove collaborators,
reassign the lead), with notifications, audit entries, and an editorial-style
admin UI.

## Scope

- Backend (no migration — `project_members` exists with unique
  (project_id, user_id) and roles LEAD_DESIGNER/COLLABORATOR/CLIENT):
  - `GET /admin/projects/{id}/members` — list members (email, full_name,
    assigned_role). Guard: SUPER_ADMIN or project-team LEAD_DESIGNER
    (same policy as PATCH /client: require_roles(SUPER_ADMIN, LEAD_DESIGNER)
    + require_team_member).
  - `GET /admin/team` — global LEAD_DESIGNER/COLLABORATOR users for the
    assignment selector (mirrors GET /clients).
  - `POST /admin/projects/{id}/members` `{user_id, assigned_role}` — add
    member. Validations: user exists & active; global-role compatibility
    (COLLABORATOR global → COLLABORATOR; LEAD_DESIGNER/SUPER_ADMIN global →
    COLLABORATOR or LEAD_DESIGNER); LEAD_DESIGNER assignment only for the
    project's current lead (change via PATCH /lead). 409 on duplicate
    (race-safe via IntegrityError). Notification `project.assigned` to the
    added user; audit `project.member_added`.
  - `DELETE /admin/projects/{id}/members/{user_id}` — remove member; 409 if
    the target is the project's CLIENT (use PATCH /client) or the assigned
    lead (use PATCH /lead); audit `project.member_removed`.
  - `PATCH /admin/projects/{id}/lead` `{lead_designer_id}` — reassign the
    lead: updates projects.lead_designer_id, removes the previous lead's
    LEAD_DESIGNER membership, adds the new one; audit `project.lead_assigned`.
  - Integrity fix in `PATCH /client`: changing the client now removes the
    previous client's CLIENT membership (residual-access bug found during
    inspection).
- Frontend `admin/projects/[projectId]/page.tsx`: full editorial restyle
  (brief-page language: editorial header, rounded-2xl stone cards,
  type-editorial/type-tech/type-ui, 44px targets, no grid-brutal/btn-brutal
  on the page) + new "Equipo del proyecto" panel: current members with
  role + remove action (respecting the 409 rules), collaborator selector
  (available team users only) and lead selector.

## Decisions (user-approved or ruled)

1. Team management: SUPER_ADMIN + project's LEAD_DESIGNER only
   (COLLABORATOR members cannot manage the team).
2. One client + one lead per project, many collaborators (multi-client is
   out of scope).
3. Assignment allowed in DRAFT and ACTIVE projects.
4. Lead reassignment + previous-client membership fix included for
   integrity of the flow.

## Non-goals

Multi-client projects, client-side team views, new migrations, changes to
RBAC of existing endpoints, changes to other admin pages.
