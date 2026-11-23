# Editorial Fixed Navbar — Design

Status: approved by the user on 2026-11-23 (Scope A: public front-office only).

## Intent

Restyle the public site's navigation after Field Studies Flora's fixed
left-margin editorial index: a translucent vertical column pinned to the
top-left corner, numbered with roman numerals, instead of the current inline
brand+tagline header. Admin and portal shells keep their existing navs.

## Scope

- Create `frontend/components/SiteNav.tsx` (desktop fixed column + mobile
  overlay behind a minimal translucent trigger).
- Modify `frontend/app/page.tsx` and `frontend/app/diagnostico/page.tsx`:
  replace the inline header with `<SiteNav />`, add section ids, add
  desktop left padding to `<main>` so nothing is covered.
- Untouched: routes, RBAC, auth flows, `globals.css` (background `#F9FAF4`
  and the Amiri/Arial/Atkinson type system stay exactly as-is), content
  components, admin/portal navs.

## Index structure

POMME STUDIO (brand) / I. Estudio → /#estudio / II. Servicios → /#servicios
with indented (1rem) sub-items Branding, Dirección creativa, Doc. ejecutiva,
FF&E → /#servicio-* / III. Contacto → /#contacto / IV. Diagnóstico →
/diagnostico (active on that route).

## Behavior

- Rest: whole block at opacity 0.40, `transition: opacity/transform 250ms`.
- Container hover: 0.75 overall; the link under the cursor reaches opacity 1
  with a subtle `translateX(4px)`; active route stays legible (0.9 + thin
  persistent underline).
- Mobile (<768px): fixed translucent trigger (POMME STUDIO · MENÚ,
  min 44px touch target) opens a clean overlay on `#F9FAF4` with the same
  numbered list; Escape closes; navigating an item closes it.
- Desktop content clearance: `<main>` gets an explicit left margin at `md:`
  so the fixed column never overlaps content.

## Non-goals

No scroll-spy, no new background colors or filled menu containers (except
the mobile overlay, which reuses the page background), no typography changes,
no changes to authenticated shells.
