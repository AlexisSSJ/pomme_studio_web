# Sprint 5 Frontend Context — pomme_studio

Root: `/home/codespace/.local/share/opencode/worktree/2eb058/sprint5-drafts-ffe-handover/frontend`
All `file:line` references below are relative to that root unless absolute. Stack: Next.js `^14.2.35` (App Router), React `^18.3.1`, TypeScript `^5.6.3` (`strict: true`), Tailwind `^3.4.14`. Every page/component is `"use client"`; there are no server components fetching data, no React context, no state library — plain `useState` + `useCallback` loaders + `apiFetch`.

**Complete file inventory** (excluding `node_modules` — currently **not installed** — `.next`, `public/`, `scripts/generate-icons.mjs`):

```
app/layout.tsx, app/page.tsx (public marketing), app/globals.css, app/manifest.ts
app/login/page.tsx, app/diagnostico/page.tsx (public lead form)
app/admin/layout.tsx, app/admin/page.tsx (dashboard)
app/admin/{leads,pricing,users,audit}/page.tsx
app/admin/projects/page.tsx
app/admin/projects/[projectId]/{brief,etapas,moodboard}/page.tsx
app/portal/layout.tsx, app/portal/page.tsx
app/portal/projects/[projectId]/{brief,etapas,moodboard,reuniones}/page.tsx
app/portal/projects/[projectId]/entregables/[deliverableId]/page.tsx
components/DeliverableViewer.tsx, components/MeetingScheduler.tsx, components/ui/ (EMPTY dir)
lib/api.ts, lib/auth.ts, lib/utils.ts
next.config.js, tailwind.config.ts, tsconfig.json, package.json, postcss.config.js, Dockerfile
```

---

## 1. API client — `lib/api.ts` (80 lines, entire file relevant)

**Base URL** (`lib/api.ts:3-5`):
```ts
// Same-origin by default: Next.js rewrites proxy /api/v1/* to the backend
// (see next.config.js). NEXT_PUBLIC_API_URL overrides for split deployments.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
```
Proxy (`next.config.js:10-18`):
```js
async rewrites() {
  const target = process.env.API_PROXY_TARGET || "http://localhost:8000";
  return [
    { source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` },
  ];
},
```
Callers always pass the **full path including `/api/v1`** (e.g. `apiFetch("/api/v1/projects/${projectId}")`).

**`apiFetch` — exact signature and body** (`lib/api.ts:35-65`):
```ts
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  // With a FormData body the browser must set the Content-Type itself
  // (including the multipart boundary), so the JSON default is skipped.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }

  return response;
}
```
Key facts: returns the raw `Response` (does **not** throw on HTTP errors); callers check `res.ok`. 401 → clears token + hard redirect `/login`. JSON bodies are `JSON.stringify(...)` passed as `body`; FormData bodies skip the JSON Content-Type automatically.

**`apiFetchBlobUrl`** (`lib/api.ts:67-80`):
```ts
/**
 * Fetch a protected binary file and wrap it in a blob URL.
 *
 * The returned URL must be revoked by the caller once it is no longer
 * needed (unmount, state change, or after triggering a download).
 */
export async function apiFetchBlobUrl(path: string): Promise<string> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data, "Error al cargar el archivo"));
  }
  return URL.createObjectURL(await res.blob());
}
```
This **throws `Error` with the backend `detail` message** on non-ok — so a 403 `"Final balance pending"` from `/file` will surface as `error.message` in existing catch blocks (this is how the locked-download error already propagates today).

**Error normalization `extractDetail`** (`lib/api.ts:7-33`):
```ts
export function extractDetail(data: unknown, fallback: string): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    const messages = data
      .map((item) => {
        if (item !== null && typeof item === "object" &&
            "msg" in item && typeof item.msg === "string") {
          return item.msg;
        }
        return null;
      })
      .filter((message): message is string => message !== null);
    return messages.length > 0 ? messages.join("; ") : fallback;
  }
  if (data !== null && typeof data === "object") {
    if ("msg" in data && typeof data.msg === "string") return data.msg;
    if ("detail" in data) return extractDetail(data.detail, fallback);
  }
  return fallback;
}
```
Handles FastAPI `{"detail": "..."}` and 422 validation arrays of `{msg}`.

**Canonical call-site error idiom** (used everywhere, e.g. `app/admin/projects/[projectId]/etapas/page.tsx:108-113`):
```ts
} else {
  const data: unknown = await res.json().catch(() => ({}));
  setUploadMessage(extractDetail(data, "Error al subir el entregable"));
}
} catch {
  setUploadMessage("Error de conexión con el servidor");
} finally {
  setUploading(false);
}
```

**FormData upload idiom** (`app/admin/projects/[projectId]/etapas/page.tsx:92-99`):
```ts
const form = new FormData();
form.append("file", file);
form.append("title", trimmedTitle);
const res = await apiFetch(
  `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`,
  { method: "POST", body: form }
);
```

**Blob download idiom** (`components/DeliverableViewer.tsx:421-441`, quoted in §7; same pattern in `app/admin/projects/[projectId]/brief/page.tsx:117-137`).

`lib/utils.ts:8-10` exports `cn(...inputs: ClassValue[])` (clsx + tailwind-merge) but **no page currently uses it** — pages use template-string class concatenation.

---

## 2. Auth & role on the client

**Token storage** — `lib/auth.ts` (entire file, 18 lines):
```ts
const TOKEN_KEY = "pomme_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
export function isAuthenticated(): boolean {
  return getToken() !== null;
}
```
localStorage key: **`pomme_token`**. Bearer header added only in `apiFetch` (§1).

**Login** (`app/login/page.tsx:23-53`): raw `fetch` (not apiFetch) to `/api/v1/auth/login` with `{email, password}`; on success `setToken(data.access_token)` (line 36), then fetches `/api/v1/auth/me` with the fresh token and routes by role:
```ts
const me: { role: string } = await meRes.json();
router.push(me.role === "CLIENT" ? "/portal" : "/admin");   // line 46-47
...
router.push("/admin"); // fallback, line 53
```

**Role shape** — `Me` interface duplicated in both layouts (`app/admin/layout.tsx:9-18`, `app/portal/layout.tsx:9-18`) and `app/admin/projects/page.tsx:21-30`:
```ts
interface Me {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```
Roles used in UI: `SUPER_ADMIN`, `LEAD_DESIGNER`, `COLLABORATOR`, `CLIENT` (`app/admin/users/page.tsx:15`: `const ROLES = ["SUPER_ADMIN", "LEAD_DESIGNER", "COLLABORATOR", "CLIENT"];`).

**Admin guard** (`app/admin/layout.tsx:38-73`) — redirects CLIENT → `/portal`, fail-closed to `/login`:
```ts
useEffect(() => {
  if (!isAuthenticated()) {
    router.replace("/login");
    return;
  }
  let cancelled = false;
  async function loadMe() {
    try {
      const res = await apiFetch("/api/v1/auth/me");
      if (cancelled) return;
      if (res.ok) {
        const me: Me = await res.json();
        if (me.role === "CLIENT") {
          router.replace("/portal");
          return;
        }
        setChecked(true);
      } else {
        router.replace("/login");
      }
    } catch {
      if (!cancelled) router.replace("/login");
    }
  }
  loadMe();
  return () => { cancelled = true; };
}, [router]);
```
Until `checked`, renders only (`app/admin/layout.tsx:75-81`):
```tsx
<main className="flex min-h-screen items-center justify-center">
  <p className="label-mono">Cargando…</p>
</main>
```
**Portal guard** is identical but inverted (`app/portal/layout.tsx:43-46`): `if (me.role !== "CLIENT") { router.replace("/admin"); return; }`.

**Important:** layouts do NOT provide role via context/props. Any page needing role gates fetches `/api/v1/auth/me` itself — the only existing example is `app/admin/projects/page.tsx:56-78`:
```ts
useEffect(() => {
  async function load() {
    let role: string | null = null;
    try {
      const res = await apiFetch("/api/v1/auth/me");
      if (res.ok) {
        const meData: Me = await res.json();
        setMe(meData);
        role = meData.role;
      }
    } catch {
      // Silent: role-gated UI falls back to hidden controls.
    }
    // COLLABORATOR cannot list every project; the membership endpoint
    // scopes the list to the projects they belong to.
    await loadProjects(
      role === "COLLABORATOR" ? "/api/v1/projects" : "/api/v1/admin/projects"
    );
  }
  load();
}, [loadProjects]);
```
Role-gated button idiom (`app/admin/projects/page.tsx:131`): `{me?.role === "SUPER_ADMIN" && project.status === "draft" && ( … )}`. **A SUPER_ADMIN-only "validate final payment" button should follow this exact `me?.role === "SUPER_ADMIN"` pattern** (fetch `/auth/me` in the page; the etapas page currently does NOT fetch me — publish buttons gated to LEAD/SUPER would need the same addition, or rely on backend 403 + `extractDetail`).

Logout (both layouts, e.g. `app/admin/layout.tsx:89-97`): `onClick={() => { clearToken(); router.push("/login"); }}`, class `label-mono min-h-[44px] px-2 underline`.

Admin nav (`app/admin/layout.tsx:20-27`) is top-level only: Dashboard/Leads/Proyectos/Usuarios/Pricing/Auditoría. Per-project subpages are reached via buttons on the projects list (§5), not nav.

---

## 3. Design system ("Tactile Brutalism")

**`app/globals.css` CSS vars** (lines 5-10):
```css
:root {
  --background: #f7f7f5;
  --foreground: #111111;
  --surface: #efece6;
  --border: #111111;
}
```
**Global reset** (lines 12-17) — no radii, no shadows anywhere:
```css
@layer base {
  /* Tactile Brutalism: ninguna esquina redondeada, ninguna sombra. */
  * {
    border-radius: 0 !important;
    box-shadow: none !important;
  }
```
Also base: body Helvetica Neue stack (30-38); `h1..h4 { letter-spacing: -0.03em; font-weight: 600; text-wrap: balance; }` (40-47); `:focus-visible { outline: 2px solid var(--foreground); outline-offset: 2px; }` (59-62).

**Component classes** (`app/globals.css:71-159`), quoted exactly:
```css
.grid-brutal {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;
  background-color: var(--foreground);
  border: 1px solid var(--border);
}
.grid-brutal > * {
  background-color: var(--background);
  border-radius: 0;
}
.cell-surface > *,
.grid-brutal > .cell-surface {
  background-color: var(--surface);
}
@media (min-width: 768px) {
  .grid-brutal--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-brutal--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.label-mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.rule { border-top: 1px solid var(--border); }
.btn-brutal {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 44px;
  padding: 0 20px;
  border: 1px solid var(--foreground);
  background-color: var(--background);
  color: var(--foreground);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 120ms linear, color 120ms linear;
}
.btn-brutal--surface { background-color: var(--surface); }
.btn-brutal:hover,
.btn-brutal:focus-visible {
  background-color: var(--foreground);
  color: var(--background);
}
.btn-brutal__arrow {
  font-size: 14px;
  line-height: 1;
  transition: transform 120ms linear;
}
.btn-brutal:hover .btn-brutal__arrow,
.btn-brutal:focus-visible .btn-brutal__arrow {
  transform: translate(2px, -2px);
}
```
Plus `@media (prefers-reduced-motion: reduce)` disabling those transitions (161-171). Note: **no disabled-state styling exists** for `.btn-brutal`; pages just pass `disabled={busy}`.

**tailwind.config.ts tokens** (lines 11-48):
```ts
colors: {
  background: '#F7F7F5',
  foreground: '#111111',
  surface: '#EFECE6',
  border: '#111111',
},
fontFamily: {
  sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'system-ui', 'sans-serif'],
  mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
},
letterSpacing: { tightest: '-0.03em', label: '0.08em' },
borderRadius: { none:'0', sm:'0', DEFAULT:'0', md:'0', lg:'0', xl:'0', '2xl':'0', '3xl':'0', full:'0' },
```
So utilities in use: `bg-background`, `bg-surface`, `text-foreground`, `border-border`, `tracking-tightest`. Content globs: `./app/**/*.{ts,tsx}`, `./components/**/*.{ts,tsx}`, `./lib/**/*.{ts,tsx}`.

**Page skeleton** (representative: `app/admin/projects/page.tsx:101-114` + `app/admin/page.tsx:26-42`):
```tsx
return (
  <section>
    <h1 className="text-xl tracking-tightest">Proyectos</h1>
    {message && (
      <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
    )}
    {loading && projects.length === 0 ? (
      <p className="mt-4 text-sm">Cargando…</p>
    ) : projects.length === 0 ? (
      <p className="mt-4 text-sm">Todavía no hay proyectos.</p>
    ) : (
      <div className="grid-brutal mt-4">
        {projects.map((project) => ( …cell… ))}
      </div>
    )}
  </section>
);
```
Recurring atoms:
- Section subheading: `<h2 className="mt-6 text-lg tracking-tightest">…</h2>`
- Numbered mono label: `<p className="label-mono">{String(index + 1).padStart(2, "0")} · {STATUS_LABEL}</p>` (etapas pages)
- List cell: `<article className="flex flex-col gap-3 p-4">` or `<div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">`
- Title/meta: `<p className="text-sm font-semibold">{title}</p>` + `<p className="label-mono mt-1">…</p>`
- Action button: `className="btn-brutal min-h-[44px] px-3 text-xs"` (self-start when in a column: add `self-start`) with trailing `<span className="btn-brutal__arrow" aria-hidden="true">↗</span>`
- Banner/feedback: `<p className="border border-border bg-surface p-3 text-sm">{msg}</p>`
- Panel/form: `className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"`
- All UI copy is **Spanish**; status badges are plain `label-mono` text (e.g. `PAGADO`/`PENDIENTE`), no colored pill components exist. A draft/published badge would idiomatically be `label-mono` text like `{deliverable.is_client_visible ? "PUBLICADO" : "BORRADOR"}`.
- Layout shell (both layouts): `mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-2 sm:px-6`; root layout `app/layout.tsx:36-41` is `<html lang="es"><body className="min-h-screen bg-background text-foreground antialiased">`.

---

## 4. Admin stage/deliverable page — `app/admin/projects/[projectId]/etapas/page.tsx` (478 lines)

**Local interfaces** (lines 11-47) — note `Deliverable` **lacks the new Sprint-5 fields**; they must be added here (and in `DeliverableViewer.tsx:6-18`):
```ts
interface Project {
  id: string; title: string; status: string;
  included_rounds: number; remaining_rounds: number;
}
interface Stage {
  id: string; project_id: string; name: string; order_index: number;
  status: "locked" | "active" | "approved";
  approved_by: string | null; approved_at: string | null; created_at: string;
}
interface Deliverable {
  id: string; project_id: string; stage_id: string; title: string;
  version: number; file_name: string; content_type: string; size_bytes: number;
  status: "in_review" | "changes_requested" | "approved";
  created_by: string; created_at: string;
}
interface StageRow { stage: Stage; deliverables: Deliverable[]; }
```
`STAGE_STATUS_LABELS` (49-53): `{ locked: "Bloqueada", active: "En curso", approved: "Aprobada" }`.

**Page state shape** (`AdminEtapasPage`, lines 216-232):
```ts
const params = useParams<{ projectId: string }>();
const projectId = params?.projectId ?? "";
const [project, setProject] = useState<Project | null>(null);
const [rows, setRows] = useState<StageRow[]>([]);
const [message, setMessage] = useState("");
const [loading, setLoading] = useState(false);
const [stageName, setStageName] = useState("");
const [stageOrder, setStageOrder] = useState("0");
const [creatingStage, setCreatingStage] = useState(false);
const [stageMessage, setStageMessage] = useState("");
const [confirmingExtraRound, setConfirmingExtraRound] = useState(false);
const [grantingRound, setGrantingRound] = useState(false);
const [roundsMessage, setRoundsMessage] = useState("");
```

**Fetch pattern** (`load`, lines 234-283): project + stages in `Promise.all`, then fan-out one deliverables request per stage:
```ts
const load = useCallback(async () => {
  setLoading(true);
  try {
    const [projectRes, stagesRes] = await Promise.all([
      apiFetch(`/api/v1/projects/${projectId}`),
      apiFetch(`/api/v1/projects/${projectId}/stages`),
    ]);
    if (projectRes.ok) { setProject(await projectRes.json()); }
    else { const data: unknown = await projectRes.json().catch(() => ({}));
           setMessage(extractDetail(data, "Error al cargar el proyecto")); }
    let stages: Stage[] = [];
    if (stagesRes.ok) { stages = await stagesRes.json(); } else { … }
    const deliverableLists = await Promise.all(
      stages.map((stage) =>
        apiFetch(
          `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`
        ).then(async (res) => {
          if (!res.ok) return [];
          return (await res.json()) as Deliverable[];
        })
      )
    );
    setRows(stages.map((stage, index) => ({ stage, deliverables: deliverableLists[index] })));
  } catch { setMessage("Error de conexión con el servidor"); }
  finally { setLoading(false); }
}, [projectId]);
useEffect(() => { load(); }, [load]);
```
(This already consumes `GET /projects/{pid}/stages/{sid}/deliverables`, which the backend will filter for CLIENT.)

**`StageCard` subcomponent** (lines 55-214), props + state:
```ts
function StageCard({ projectId, number, stage, deliverables, onChanged }: {
  projectId: string; number: number; stage: Stage;
  deliverables: Deliverable[]; onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [viewerDeliverableId, setViewerDeliverableId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
```
Upload handler `uploadDeliverable(event: React.FormEvent)` (77-117): validates trimmed title + file presence, builds FormData (`file`, `title`), POSTs to `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`, on ok resets fields + `fileInputRef.current.value = ""` + calls `onChanged()` (which is `load`, passed at line 466).

**Deliverable rendering** (lines 130-169) — *this is where publish/unpublish/final-handover buttons + badges fit*, per deliverable, next to the version/status label and the "Ver pines" toggle:
```tsx
{deliverables.map((deliverable) => {
  const viewerOpen = viewerDeliverableId === deliverable.id;
  return (
    <div key={deliverable.id} className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{deliverable.title}</p>
      <p className="label-mono">
        V{deliverable.version} · {deliverableStatusLabel(deliverable.status)}
      </p>
      <button
        type="button"
        onClick={() => setViewerDeliverableId((prev) =>
          prev === deliverable.id ? null : deliverable.id)}
        aria-expanded={viewerOpen}
        className="btn-brutal min-h-[44px] self-start px-3 text-xs"
      >
        {viewerOpen ? "Ocultar pines" : "Ver pines"}
        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
      </button>
      {viewerOpen && (
        <div className="border border-border bg-surface p-3">
          <DeliverableViewer
            projectId={projectId}
            deliverableId={deliverable.id}
            canReview={false}
          />
        </div>
      )}
    </div>
  );
})}
```
Upload form renders only when `stage.status === "active"` (171-211): panel `flex flex-col gap-3 border border-border bg-background p-3`, header `<p className="label-mono">NUEVA VERSIÓN</p>`, text input + hidden file input wrapped in a 44px label (see §8), submit `btn-brutal … {uploading ? "Subiendo…" : "Subir entregable"}`.

**Mutation + two-step-confirm idiom already on this page** — `grantExtraRound` (321-349), the template for publish/final-handover actions:
```ts
async function grantExtraRound() {
  if (!confirmingExtraRound) { setConfirmingExtraRound(true); return; }
  setGrantingRound(true);
  setRoundsMessage("");
  try {
    const res = await apiFetch(
      `/api/v1/admin/projects/${projectId}/extra-round`, { method: "POST" }
    );
    if (res.ok) {
      setConfirmingExtraRound(false);
      setRoundsMessage("Ronda extra habilitada");
      await load();
    } else {
      const data: unknown = await res.json().catch(() => ({}));
      setRoundsMessage(extractDetail(data, "Error al habilitar la ronda"));
      setConfirmingExtraRound(false);
    }
  } catch { setRoundsMessage("Error de conexión con el servidor"); setConfirmingExtraRound(false); }
  finally { setGrantingRound(false); }
}
```
Button label swaps (393-397): `{grantingRound ? "Habilitando…" : confirmingExtraRound ? "Confirmar ronda extra" : "Habilitar ronda extra"}`.

Page JSX order (359-477): h1 "Etapas" → project meta label-mono → rounds meta → message banner → "RONDAS EXTRA" panel → "Nueva etapa" form (`createStage`, 285-319, POST `{name, order_index}`) → "Etapas del proyecto" `grid-brutal` of `StageCard`s (`onChanged={load}`) → "Agendar reunión" `<MeetingScheduler projectId={projectId} stages={sortedStages} />`.

**Natural insertion points for Sprint 5:** extend `Deliverable` interface with `is_client_visible: boolean; is_final_handover: boolean; published_at: string | null; published_by: string | null;`; add badge text into the `label-mono` line at 137-140; add per-deliverable action buttons (with per-id busy/confirm state, e.g. `Record<string, …>` like portal etapas §6, or lift into a small `DeliverableRow` component) calling `POST …/deliverables/{id}/publish` with `JSON.stringify({ is_final_handover })`, `…/unpublish`, `…/final-handover`, then `onChanged()`. Page currently has no `me`/role state — add `/auth/me` fetch if buttons must be hidden for COLLABORATOR (backend enforces 403 regardless).

---

## 5. Admin projects list — `app/admin/projects/page.tsx` (169 lines)

`Project` interface **already includes `balance_paid`** (lines 7-19):
```ts
interface Project {
  id: string; title: string;
  lead_id: string | null; client_id: string | null; lead_designer_id: string | null;
  scope_type: string | null; status: string;
  included_rounds: number; remaining_rounds: number;
  balance_paid: boolean;
  created_at: string;
}
```
State (33-37): `projects`, `me: Me | null`, `message`, `loading`, `activatingId: string | null`. Loader `loadProjects(path: string)` (39-54) is a plain apiFetch + `setProjects(await res.json())`; role-based path selection quoted in §2.

**Action pattern** — `activateProject` (80-99):
```ts
async function activateProject(projectId: string) {
  setActivatingId(projectId);
  setMessage("");
  try {
    const res = await apiFetch(`/api/v1/admin/projects/${projectId}/activate`, {
      method: "POST",
    });
    if (res.ok) {
      setMessage("Proyecto activado");
      loadProjects("/api/v1/admin/projects");
    } else {
      const data: unknown = await res.json().catch(() => ({}));
      setMessage(extractDetail(data, "Error al activar proyecto"));
    }
  } catch { setMessage("Error de conexión con el servidor"); }
  finally { setActivatingId(null); }
}
```

**Row JSX** (114-164) — balance badge + SUPER_ADMIN-gated action + nav links:
```tsx
<div className="grid-brutal mt-4">
  {projects.map((project) => (
    <div key={project.id}
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{project.title}</p>
        <p className="label-mono mt-1">
          {project.status} · {project.scope_type || "sin scope"}
        </p>
        <p className="label-mono mt-1">
          Rondas {project.remaining_rounds}/{project.included_rounds} ·{" "}
          {project.balance_paid ? "PAGADO" : "PENDIENTE"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {me?.role === "SUPER_ADMIN" && project.status === "draft" && (
          <button
            onClick={() => activateProject(project.id)}
            disabled={activatingId === project.id}
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            {activatingId === project.id ? "Activando…" : "Activar proyecto"}
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </button>
        )}
        <Link href={`/admin/projects/${project.id}/brief`} className="btn-brutal min-h-[44px] px-3 text-xs">Brief …</Link>
        <Link href={`/admin/projects/${project.id}/moodboard`} …>Moodboard …</Link>
        <Link href={`/admin/projects/${project.id}/etapas`} …>Etapas …</Link>
      </div>
    </div>
  ))}
</div>
```
**"Validar pago final" fits exactly beside "Activar proyecto"**: same `me?.role === "SUPER_ADMIN"` gate (condition e.g. `!project.balance_paid`), a new `validatingId` state mirroring `activatingId`, `POST /api/v1/admin/projects/${project.id}/validate-final-payment`, then either `loadProjects(...)` or replace the row from the returned `ProjectRead`. A new "FF&E"/"Especificaciones" `<Link>` button goes in the same `flex flex-wrap gap-2` group (lines 141-161).

---

## 6. Client portal stages — `app/portal/projects/[projectId]/etapas/page.tsx` (236 lines)

Interfaces (9-40): same `Project`/`Stage` as admin; **slimmer `Deliverable`** (28-35): `{ id, project_id, stage_id, title, version, status }`. `StageRow` identical.

State (52-61) adds per-stage feedback maps:
```ts
const [confirmingId, setConfirmingId] = useState<string | null>(null);
const [approvingId, setApprovingId] = useState<string | null>(null);
const [stageFeedback, setStageFeedback] = useState<Record<string, string>>({});
```
`load` (63-108) is **byte-for-byte the same fan-out pattern** as admin (§4): `Promise.all([project, stages])` then per-stage `apiFetch(\`/api/v1/projects/${projectId}/stages/${stage.id}/deliverables\`)` with `if (!res.ok) return [];`. Since the backend filters to published for CLIENT, **no client-side visibility filtering is needed** — the list just renders what comes back.

**Deliverable render → viewer link** (187-205):
```tsx
{deliverables.length > 0 && (
  <div className="flex flex-col gap-2">
    {deliverables.map((deliverable) => (
      <Link
        key={deliverable.id}
        href={`/portal/projects/${projectId}/entregables/${deliverable.id}`}
        className="btn-brutal min-h-[44px] px-3 text-xs"
      >
        <span className="truncate">
          {deliverable.title} · V{deliverable.version} ·{" "}
          {deliverableStatusLabel(deliverable.status)}
        </span>
        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
      </Link>
    ))}
  </div>
)}
```
Stage cell is `<article className="flex flex-col gap-3 p-4">` with numbered label `{String(index + 1).padStart(2, "0")} · {STAGE_STATUS_LABELS[stage.status]}` (175-178). Two-step stage approval `approveStage` (114-149) uses `confirmingId`/`approvingId` + `setStageFeedback((prev) => ({ ...prev, [stage.id]: msg }))`; button labels (214-218): `"Aprobando…" / "Confirmar aprobación" / "Aprobar etapa"`. This per-id `Record<string, string>` feedback pattern is the model for per-deliverable publish feedback if actions are added to lists.

Portal project list (`app/portal/page.tsx`) fetches `/api/v1/projects` (line 29) and renders Brief/Moodboard/Etapas/Reuniones link buttons (76-113); its `Project` interface already has `balance_paid: boolean` (line 17, currently unused in JSX). **A client "Catálogo FF&E" link button goes in this group.**

---

## 7. Client deliverable viewer — key Sprint-5 integration point

### Wrapper page `app/portal/projects/[projectId]/entregables/[deliverableId]/page.tsx` (33 lines, entire component):
```tsx
export default function EntregablePage() {
  const params = useParams<{ projectId: string; deliverableId: string }>();
  const projectId = params?.projectId ?? "";
  const deliverableId = params?.deliverableId ?? "";
  return (
    <section>
      <h1 className="text-xl tracking-tightest">Entregable</h1>
      <Link href={`/portal/projects/${projectId}/etapas`}
        className="btn-brutal mt-4 inline-flex min-h-[44px] px-3 text-xs">
        Volver a etapas <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="mt-4">
        <DeliverableViewer projectId={projectId} deliverableId={deliverableId} canReview />
      </div>
    </section>
  );
}
```

### `components/DeliverableViewer.tsx` (729 lines)

**Props** (71-81) — inline destructured type, no named interface:
```tsx
export default function DeliverableViewer({
  projectId, deliverableId, canReview, onChanged,
}: {
  projectId: string;
  deliverableId: string;
  canReview: boolean;
  onChanged?: () => void;
}) {
```
`canReview` is `true` only from the portal page; admin embeds pass `canReview={false}` (etapas page line 161) → pins read-only, no approve/request-changes.

**Local types**: `Deliverable` (6-18, same shape as admin etapas — needs the 4 new fields), `DeliverableComment` (20-31: `id, deliverable_id, created_by, x_pct, y_pct, page_or_frame, body, round_number, consumes_round, created_at`), and:
```ts
interface ProjectDetail {        // lines 33-36
  id: string;
  remaining_rounds: number;
}
```
**`ProjectDetail` must gain `balance_paid: boolean`** — `load()` already fetches the project (line 140) but only stores rounds (157-160):
```ts
if (projectRes.ok) {
  const project = (await projectRes.json()) as ProjectDetail;
  setRemainingRounds(project.remaining_rounds);
}
```

**State** (82-105): `deliverable`, `comments`, `remainingRounds: number | null`, `loading`, `message`, `url: string | null` (blob URL), `imageError: string`, `scale`, `pinMode`, `pendingPin: {x,y} | null`, `pinBody`, `sendingPin`, `pinFeedback`, `selectedCommentId`, `mutationBusy: "changes" | "approve" | null`, `actionFeedback`, `downloading`. Refs (107-125): `scrollRef`, `imageRef`, pointer-gesture refs.

**Endpoint constants** (127-128):
```ts
const filePath = `/api/v1/projects/${projectId}/deliverables/${deliverableId}/file`;
const isInReview = deliverable !== null && deliverable.status === "in_review";
```

**Metadata load** (130-166): `Promise.all` of `GET …/deliverables/{id}`, `GET …/deliverables/{id}/comments`, `GET /projects/{projectId}` with the standard `res.ok` / `extractDetail` handling.

**Image loading — blob URL effect** (172-201), the exact pattern to adapt for `/preview`:
```ts
useEffect(() => {
  let active = true;
  let objectUrl: string | null = null;

  apiFetchBlobUrl(filePath)
    .then((created) => {
      if (!active) { URL.revokeObjectURL(created); return; }
      objectUrl = created;
      setUrl(created);
    })
    .catch((error: unknown) => {
      if (active) {
        setImageError(
          error instanceof Error ? error.message : "Error al cargar la imagen"
        );
      }
    });

  return () => {
    active = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}, [filePath]);
```
Identical effect appears in `app/admin/projects/[projectId]/moodboard/page.tsx:54-83` and `app/portal/projects/[projectId]/moodboard/page.tsx:44-73`.

**Image render + zoom surface** (479-502):
```tsx
) : url ? (
  <div ref={scrollRef}
    className="relative max-h-[70vh] overflow-auto border border-border bg-surface">
    <div className="relative w-full select-none"
      style={{ transform: `scale(${scale})`, transformOrigin: "top left", touchAction: "none" }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel}>
      <img ref={imageRef} src={url} alt={deliverable.title}
        draggable={false} className="block w-full" />
      {comments.map(…numbered pin buttons positioned by left/top %…)}
```
Error/loading fallbacks (475-478, 541-545): `imageError` → `<p className="border border-border bg-surface p-3 text-sm">{imageError}</p>`; no url yet → `<p className="label-mono border border-border bg-surface p-3">Cargando imagen…</p>`. **A 403 from `/file` already lands in `imageError` via `apiFetchBlobUrl`'s thrown `extractDetail` message.**

Zoom/pins mechanics: constants `MIN_SCALE=1, MAX_SCALE=4, ZOOM_STEP=0.5, TAP_SLOP_PX=6` (43-47); pinch via two-pointer distance ratio (255-288), pan via scrollLeft/Top (277-287), tap-to-place pin computes % from `imageRef.getBoundingClientRect()` (312-322); zoom −/+ buttons + `ZOOM {scale.toFixed(1)}×` label (547-575); pin markers are 44×44 buttons with `data-pin-marker={comment.id}` (503-526). Pin submit `sendPin` (344-383) POSTs `{x_pct, y_pct, body}` to `…/comments`. Review mutations `runMutation(kind)` (385-419) POST `…/request-changes` or `…/approve` then `await load(); onChanged?.();`.

**Download — exact code** (421-441):
```ts
async function download() {
  if (downloading || !deliverable) return;
  setDownloading(true);
  setActionFeedback("");
  try {
    const blobUrl = await apiFetchBlobUrl(filePath);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = deliverable.file_name || "entregable";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    setActionFeedback(
      error instanceof Error ? error.message : "Error al descargar el archivo"
    );
  } finally {
    setDownloading(false);
  }
}
```
**Download button** (596-606), inside the `{url && ( …toolbar… )}` block:
```tsx
<button type="button" onClick={download} disabled={downloading}
  className="btn-brutal min-h-[44px] px-3 text-xs">
  {downloading ? "Descargando…" : "Descargar"}
  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
</button>
```
**Sprint-5 integration:** compute `locked = deliverable.is_final_handover && !balancePaid` (balance from the already-fetched project); when locked & client: point the image effect at `/api/v1/projects/${projectId}/deliverables/${deliverableId}/preview` (watermarked JPEG; same blob pipeline works unchanged), and disable/hide the download button or replace it with a `label-mono` "PAGO FINAL PENDIENTE" notice; keep `/file` for the unlocked case. `deliverableStatusLabel` is exported (59-63) and reused by both etapas pages:
```ts
export function deliverableStatusLabel(status: Deliverable["status"]): string {
  if (status === "in_review") return "En revisión";
  if (status === "changes_requested") return "Cambios solicitados";
  return "Aprobado";
}
```

---

## 8. Forms & destructive actions

**Exact input classes** (used verbatim across pages):
- Text/number/date/email/password input: `className="min-h-[44px] border border-border bg-background px-3 text-sm"` (e.g. `app/admin/projects/[projectId]/etapas/page.tsx:184`, `app/admin/users/page.tsx:82`; login adds `outline-none focus:border-foreground`, `app/login/page.tsx:76`).
- Select: same classes — `app/admin/users/page.tsx:100-108`:
```tsx
<select value={role} onChange={(e) => setRole(e.target.value)}
  className="min-h-[44px] border border-border bg-background px-3 text-sm">
  {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
</select>
```
- Typed-union select cast idiom — `app/admin/projects/[projectId]/brief/page.tsx:181-193`:
```tsx
<select value={category}
  onChange={(event) =>
    setCategory(event.target.value as "branding" | "interior" | "general")}
  className="min-h-[44px] border border-border bg-background px-3 text-sm">
  <option value="branding">Branding</option> …
```
(state typed at 44-46: `useState<"branding" | "interior" | "general">("branding")`). Same cast pattern in `components/MeetingScheduler.tsx:209-221` (`as MeetingTypeValue` from `TYPE_OPTIONS: {value,label}[]`, lines 30-33).
- Textarea: `className="min-h-[44px] border border-border bg-background p-3 text-sm"` (`app/admin/projects/[projectId]/brief/page.tsx:171-176` with `maxLength={500}`; `components/DeliverableViewer.tsx:622-628` with `maxLength={2000}` + placeholder).
- Label wrapper: `<label className="flex flex-col gap-1"><span className="label-mono">Título</span><input …/></label>`.
- File picker (hidden input inside a 44px label) — `app/admin/projects/[projectId]/etapas/page.tsx:187-198`:
```tsx
<label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 border border-border bg-background px-3">
  <span className="label-mono truncate">{file ? file.name : "Elegir imagen"}</span>
  <input ref={fileInputRef} type="file" accept="image/*"
    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
    className="sr-only" />
</label>
```
- Form panel: `<form onSubmit={…} className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4">`; inline form feedback `{msg && <p className="text-sm">{msg}</p>}`; page-level banner `<p className="mt-4 border border-border bg-surface p-3 text-sm">`.
- Submit button: `type="submit" disabled={busy} className="btn-brutal min-h-[44px] self-start px-3 text-xs"` with `{busy ? "Creando…" : "Crear …"}` + arrow span.

**Two-step inline delete confirmation — moodboard admin** (`app/admin/projects/[projectId]/moodboard/page.tsx`). State (43-45): `confirmingDelete`, `deleting`, `feedback`. Handler (85-111):
```ts
async function removePiece() {
  if (!confirmingDelete) {
    setConfirmingDelete(true);
    return;
  }
  setDeleting(true);
  setFeedback("");
  try {
    const res = await apiFetch(
      `/api/v1/projects/${projectId}/moodboard/items/${item.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      onChanged();
    } else {
      const data: unknown = await res.json().catch(() => ({}));
      setFeedback(extractDetail(data, "Error al eliminar la pieza"));
      setConfirmingDelete(false);
    }
  } catch {
    setFeedback("Error de conexión con el servidor");
    setConfirmingDelete(false);
  } finally {
    setDeleting(false);
  }
}
```
Button (171-185):
```tsx
<button type="button" onClick={removePiece} disabled={deleting}
  className="btn-brutal min-h-[44px] px-3 text-xs">
  {deleting ? "Eliminando…"
    : confirmingDelete ? "Confirmar eliminación"
    : "Eliminar"}
  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
</button>
```
**No `window.confirm`/modal dialogs exist anywhere** — first click arms, second click executes; errors reset the armed state. This is the idiom for specification DELETE and for unpublish/final-handover toggles.

**Form submit + error display template** (`app/admin/projects/[projectId]/brief/page.tsx:86-115`): `event.preventDefault()` → trim/validate with early `setFormMessage(...)` → `setCreating(true); setFormMessage("")` → `apiFetch(path, { method: "POST", body: JSON.stringify({...}) })` → ok: append created item (`setItems((prev) => [...prev, created])`), success message, reset fields; else `extractDetail`; catch: `"Error de conexión con el servidor"`; finally reset busy. PATCH examples: `app/admin/users/page.tsx:53-59` (`changeRole` → `PATCH …/role` with `{role}` then `loadUsers()`). Older pages (users, login) use `data.detail || fallback` directly; **new code should use `extractDetail` with `const data: unknown = await res.json().catch(() => ({}))`**.

---

## 9. Existing FF&E / specifications UI

**None exists.** Verified by grep across all `.ts/.tsx/.css`: the only FF&E mentions are marketing/metadata:
- `app/page.tsx:22` — services card `title: 'Especificaciones FF&E'`
- `app/layout.tsx:7` (meta description) and `:14` (keyword `'FF&E'`)

No `specifications` fetch, no category enums, no catalog route. `components/ui/` is an **empty directory**. Sprint 5 must create both pages from scratch; route naming should follow the existing Spanish convention (`etapas`, `entregables`, `reuniones`), e.g. `app/admin/projects/[projectId]/especificaciones/page.tsx` and `app/portal/projects/[projectId]/especificaciones/page.tsx`, with entry-point link buttons added to `app/admin/projects/page.tsx:141-161` and `app/portal/page.tsx:76-113`. The admin CRUD page can clone the moodboard admin structure (list + create form + per-item two-step delete) with the brief page's typed select for `category: "furniture" | "lighting" | "finishes" | "equipment" | "other"`; the client catalog is a read-only `grid-brutal` list (fields: name, code, manufacturer, finish, dimensions, supplier, reference_url, location, notes — `reference_url` would be the first external link; existing external-link idiom is `MeetingScheduler.tsx:337-347`: `<a href={…} target="_blank" rel="noreferrer" className="btn-brutal …">`).

---

## 10. Build / verify

**`package.json` scripts** (lines 5-10) — the complete set:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint"
}
```
- **`npm run build` = `next build` → runs the TypeScript typecheck** (Next 14 always typechecks during build using `tsconfig.json`). **Lint is effectively skipped**: there is **no `eslint` dependency** (0 occurrences in `package-lock.json`), no `eslint-config-next`, and **no `.eslintrc*` / `eslint.config.*` anywhere in the repo**. `npm run lint` (`next lint`) would interactively prompt to install ESLint — not usable as a non-interactive verify step. So the authoritative frontend verification is **`cd frontend && npm ci && npm run build`** (typecheck + compile). `node_modules` is currently **absent** in this worktree, so `npm ci` is required first.
- **`tsconfig.json`**: `"strict": true` (line 7), `target ES2017`, `moduleResolution: "bundler"`, `noEmit`, `isolatedModules`, path alias `"@/*": ["./*"]` (lines 21-23) — imports use `@/lib/api`, `@/components/DeliverableViewer`. No `noUncheckedIndexedAccess` (indexed access like `deliverableLists[index]` is used freely).
- **`any` discipline**: grep for `: any|as any|<any>|any[]` across all TS/TSX → **zero matches**. The codebase idiom is `const data: unknown = await res.json().catch(() => ({}))` + `extractDetail`, `as` casts for trusted JSON (`(await res.json()) as Deliverable[]`), `error instanceof Error ? error.message : fallback` in catches, and typed `useParams<{ projectId: string }>()`. New code must avoid `any` to match (strict mode doesn't ban `any` by itself, but nothing in the repo uses it).
- Dependencies of note (`package.json:11-28`): `next ^14.2.35`, `react ^18.3.1`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react` (the latter three barely/never used in pages). No test runner, no `test` script.
- `Dockerfile`: multi-stage node:20-alpine, `npm ci` → `npm run build` with `ARG API_PROXY_TARGET` (rewrites are baked at build time) → `npx next start -p ${PORT:-3000}`.

---

## Cross-cutting idioms checklist for task authors

1. `"use client"` first line; imports from `@/lib/api` (`apiFetch`, `apiFetchBlobUrl`, `extractDetail`) and `@/lib/auth` only where needed.
2. Route params: `const params = useParams<{ projectId: string }>(); const projectId = params?.projectId ?? "";`
3. Loader: `const load = useCallback(async () => { setLoading(true); try { …Promise.all… } catch { setMessage("Error de conexión con el servidor"); } finally { setLoading(false); } }, [projectId]); useEffect(() => { load(); }, [load]);` — mutations call `await load()` / `onChanged()` afterwards.
4. Every mutation: busy flag (`disabled={busy}` + "…ando/…iendo…" label), `extractDetail` on `!res.ok`, connection-error catch, `finally` reset.
5. Destructive/irreversible actions: two-step button-label confirmation (no dialogs).
6. Blob images: `apiFetchBlobUrl` + `active` flag + `URL.revokeObjectURL` cleanup effect keyed on the path; downloads via temporary `<a download>` + revoke.
7. Styling: only the atoms in §3/§8; 44px minimum touch targets; Spanish copy; `label-mono` uppercase meta/badges; `↗` arrow span on every `btn-brutal`.
8. Role gates: page-level `/api/v1/auth/me` fetch into `me` state + `me?.role === "SUPER_ADMIN" && …` (only existing precedent: admin projects list). Layouts already keep CLIENT out of `/admin` and staff out of `/portal`.
9. Interfaces are declared locally per file (duplicated across pages) — Sprint 5 field additions must be applied to each copy: `Deliverable` in admin etapas (30-42), `DeliverableViewer` (6-18), portal etapas (28-35, optional); `ProjectDetail` in viewer (33-36) needs `balance_paid`; `Project` in admin etapas (11-17) may need `balance_paid` if gating UI there.
