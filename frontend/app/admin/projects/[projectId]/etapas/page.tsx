"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import DeliverableViewer, {
  deliverableStatusLabel,
} from "@/components/DeliverableViewer";
import MeetingScheduler from "@/components/MeetingScheduler";

interface Project {
  id: string;
  title: string;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
}

interface Stage {
  id: string;
  project_id: string;
  name: string;
  order_index: number;
  status: "locked" | "active" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface Deliverable {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  version: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: "in_review" | "changes_requested" | "approved";
  is_client_visible: boolean;
  is_final_handover: boolean;
  published_at: string | null;
  published_by: string | null;
  created_by: string;
  created_at: string;
}

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

interface StageRow {
  stage: Stage;
  deliverables: Deliverable[];
}

const STAGE_STATUS_LABELS: Record<Stage["status"], string> = {
  locked: "Bloqueada",
  active: "En curso",
  approved: "Aprobada",
};

function StageCard({
  projectId,
  number,
  stage,
  deliverables,
  me,
  onChanged,
}: {
  projectId: string;
  number: number;
  stage: Stage;
  deliverables: Deliverable[];
  me: Me | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [viewerDeliverableId, setViewerDeliverableId] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpublishingConfirmId, setUnpublishingConfirmId] = useState<string | null>(null);
  const [handoverTogglingId, setHandoverTogglingId] = useState<string | null>(null);
  const [deliverableMessages, setDeliverableMessages] = useState<Record<string, string>>({});

  async function handlePublish(deliverable: Deliverable) {
    setPublishingId(deliverable.id);
    setDeliverableMessages((prev) => ({ ...prev, [deliverable.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverable.id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ is_final_handover: deliverable.is_final_handover }),
        }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverable.id]: extractDetail(data, "Error al publicar entregable"),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverable.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setPublishingId(null);
    }
  }

  async function handleUnpublish(deliverableId: string) {
    setPublishingId(deliverableId);
    setUnpublishingConfirmId(null);
    setDeliverableMessages((prev) => ({ ...prev, [deliverableId]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverableId}/unpublish`,
        { method: "POST" }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverableId]: extractDetail(data, "Error al despublicar entregable"),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverableId]: "Error de conexión con el servidor",
      }));
    } finally {
      setPublishingId(null);
    }
  }

  async function handleToggleHandover(deliverable: Deliverable) {
    setHandoverTogglingId(deliverable.id);
    setDeliverableMessages((prev) => ({ ...prev, [deliverable.id]: "" }));
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/deliverables/${deliverable.id}/final-handover`,
        {
          method: "POST",
          body: JSON.stringify({ is_final_handover: !deliverable.is_final_handover }),
        }
      );
      if (res.ok) {
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeliverableMessages((prev) => ({
          ...prev,
          [deliverable.id]: extractDetail(data, "Error al actualizar entrega final"),
        }));
      }
    } catch {
      setDeliverableMessages((prev) => ({
        ...prev,
        [deliverable.id]: "Error de conexión con el servidor",
      }));
    } finally {
      setHandoverTogglingId(null);
    }
  }

  async function uploadDeliverable(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setUploadMessage("El título no puede estar vacío");
      return;
    }
    if (!file) {
      setUploadMessage("Selecciona un archivo");
      return;
    }

    setUploading(true);
    setUploadMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", trimmedTitle);

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/stages/${stage.id}/deliverables`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        setUploadMessage("Entregable subido");
        setTitle("");
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        onChanged();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setUploadMessage(extractDetail(data, "Error al subir el entregable"));
      }
    } catch {
      setUploadMessage("Error de conexión con el servidor");
    } finally {
      setUploading(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 p-4">
      <p className="label-mono">
        {String(number).padStart(2, "0")} · {STAGE_STATUS_LABELS[stage.status]}
      </p>
      <p className="type-ui text-sm font-semibold">{stage.name}</p>

      {stage.status === "locked" && (
        <p className="type-editorial text-sm">Se desbloquea al aprobar la etapa anterior.</p>
      )}

      {deliverables.length > 0 && (
        <div className="flex flex-col gap-2">
          {deliverables.map((deliverable) => {
            const viewerOpen = viewerDeliverableId === deliverable.id;
            const isBusy = publishingId === deliverable.id || handoverTogglingId === deliverable.id;
            const msg = deliverableMessages[deliverable.id];
            const canManage = me?.role === "LEAD_DESIGNER" || me?.role === "SUPER_ADMIN";
            const confirmingUnpublish = unpublishingConfirmId === deliverable.id;

            return (
              <div key={deliverable.id} className="flex flex-col gap-2 border border-border bg-background p-3">
                <p className="type-ui text-sm font-semibold">{deliverable.title}</p>
                <p className="label-mono">
                  V{deliverable.version} ·{" "}
                  {deliverableStatusLabel(deliverable.status)}
                  {deliverable.is_client_visible ? " · PUBLICADO" : " · BORRADOR"}
                  {deliverable.is_final_handover ? " · ENTREGA FINAL" : ""}
                </p>

                {msg && <p className="type-ui text-sm text-red-600">{msg}</p>}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setViewerDeliverableId((prev) =>
                        prev === deliverable.id ? null : deliverable.id
                      )
                    }
                    aria-expanded={viewerOpen}
                    className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                  >
                    {viewerOpen ? "Ocultar pines" : "Ver pines"}
                    <span className="btn-brutal__arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>

                  {canManage && (
                    <>
                      {!deliverable.is_client_visible ? (
                        <button
                          type="button"
                          onClick={() => handlePublish(deliverable)}
                          disabled={isBusy}
                          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                        >
                          {publishingId === deliverable.id ? "Publicando…" : "Publicar"}
                          <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                        </button>
                      ) : confirmingUnpublish ? (
                        <button
                          type="button"
                          onClick={() => handleUnpublish(deliverable.id)}
                          disabled={isBusy}
                          className="btn-brutal min-h-[44px] self-start px-3 text-xs border-red-500 bg-red-50"
                        >
                          {publishingId === deliverable.id ? "Despublicando…" : "Confirmar despublicación"}
                          <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUnpublishingConfirmId(deliverable.id)}
                          disabled={isBusy}
                          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                        >
                          Despublicar
                          <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleToggleHandover(deliverable)}
                        disabled={isBusy}
                        className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                      >
                        {handoverTogglingId === deliverable.id
                          ? "Actualizando…"
                          : deliverable.is_final_handover
                          ? "Desmarcar entrega final"
                          : "Marcar entrega final"}
                        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                      </button>
                    </>
                  )}
                </div>

                {viewerOpen && (
                  <div className="border border-border bg-surface p-3 mt-2">
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
        </div>
      )}

      {stage.status === "active" && (
        <form
          onSubmit={uploadDeliverable}
          className="flex flex-col gap-3 border border-border bg-background p-3"
        >
          <p className="type-subtitle-caps text-sm">NUEVA VERSIÓN</p>
          <label className="flex flex-col gap-1">
            <span className="type-ui text-sm">Título</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={255}
              className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 border border-border bg-background px-3">
            <span className="type-ui truncate text-sm">
              {file ? file.name : "Elegir imagen"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
          {uploadMessage && <p className="type-ui text-sm">{uploadMessage}</p>}
          <button
            type="submit"
            disabled={uploading}
            className="btn-brutal min-h-[44px] self-start px-3 text-xs"
          >
            {uploading ? "Subiendo…" : "Subir entregable"}
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </form>
      )}
    </article>
  );
}

export default function AdminEtapasPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<StageRow[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [stageName, setStageName] = useState("");
  const [stageOrder, setStageOrder] = useState("0");
  const [creatingStage, setCreatingStage] = useState(false);
  const [stageMessage, setStageMessage] = useState("");

  const [confirmingExtraRound, setConfirmingExtraRound] = useState(false);
  const [grantingRound, setGrantingRound] = useState(false);
  const [roundsMessage, setRoundsMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const meRes = await apiFetch("/api/v1/auth/me");
        if (meRes.ok) setMe(await meRes.json());
      } catch {}

      const [projectRes, stagesRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/stages`),
      ]);

      if (projectRes.ok) {
        setProject(await projectRes.json());
      } else {
        const data: unknown = await projectRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }

      let stages: Stage[] = [];
      if (stagesRes.ok) {
        stages = await stagesRes.json();
      } else {
        const data: unknown = await stagesRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las etapas"));
      }

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

      setRows(
        stages.map((stage, index) => ({
          stage,
          deliverables: deliverableLists[index],
        }))
      );
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createStage(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = stageName.trim();
    if (!trimmedName) {
      setStageMessage("El nombre de la etapa no puede estar vacío");
      return;
    }
    const parsedOrder = Number.parseInt(stageOrder, 10);
    if (Number.isNaN(parsedOrder) || parsedOrder < 0) {
      setStageMessage("El orden debe ser un número entero mayor o igual a 0");
      return;
    }

    setCreatingStage(true);
    setStageMessage("");
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/stages`, {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, order_index: parsedOrder }),
      });
      if (res.ok) {
        setStageMessage("Etapa creada");
        setStageName("");
        setStageOrder("0");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setStageMessage(extractDetail(data, "Error al crear la etapa"));
      }
    } catch {
      setStageMessage("Error de conexión con el servidor");
    } finally {
      setCreatingStage(false);
    }
  }

  async function grantExtraRound() {
    if (!confirmingExtraRound) {
      setConfirmingExtraRound(true);
      return;
    }

    setGrantingRound(true);
    setRoundsMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/projects/${projectId}/extra-round`,
        { method: "POST" }
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
    } catch {
      setRoundsMessage("Error de conexión con el servidor");
      setConfirmingExtraRound(false);
    } finally {
      setGrantingRound(false);
    }
  }

  const sortedStages = [...rows]
    .sort((a, b) => a.stage.order_index - b.stage.order_index)
    .map((row) => ({
      id: row.stage.id,
      name: row.stage.name,
      order_index: row.stage.order_index,
    }));

  return (
    <section>
      <h1 className="type-title text-xl">Etapas</h1>
      {project && (
        <p className="label-mono mt-1">
          {project.title} · {project.status}
        </p>
      )}
      {project && (
        <p className="label-mono mt-1">
          RONDAS DE CAMBIOS · {project.remaining_rounds}/
          {project.included_rounds}
        </p>
      )}

      {message && (
        <p className="type-ui mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 border border-border bg-surface p-4">
        <p className="label-mono">RONDAS EXTRA</p>
        <p className="type-editorial text-sm">
          Cada solicitud de cambios del cliente consume una ronda incluida.
          Habilita una ronda extra cuando el cliente contrate más
          revisiones.
        </p>
        <button
          type="button"
          onClick={grantExtraRound}
          disabled={grantingRound}
          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
        >
          {grantingRound
            ? "Habilitando…"
            : confirmingExtraRound
              ? "Confirmar ronda extra"
              : "Habilitar ronda extra"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        {roundsMessage && (
          <p className="type-ui border border-border bg-background p-3 text-sm">
            {roundsMessage}
          </p>
        )}
      </div>

      <h2 className="type-subtitle-caps mt-6 text-lg">Nueva etapa</h2>
      <form
        onSubmit={createStage}
        className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Nombre</span>
          <input
            type="text"
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            maxLength={255}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Orden</span>
          <input
            type="number"
            step={1}
            min={0}
            value={stageOrder}
            onChange={(event) => setStageOrder(event.target.value)}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>
        <p className="type-editorial text-sm">
          La primera etapa nace en curso; las siguientes nacen bloqueadas
          hasta que el cliente aprueba las anteriores.
        </p>
        {stageMessage && <p className="type-ui text-sm">{stageMessage}</p>}
        <button
          type="submit"
          disabled={creatingStage}
          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
        >
          {creatingStage ? "Creando…" : "Crear etapa"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </form>

      <h2 className="type-subtitle-caps mt-6 text-lg">Etapas del proyecto</h2>
      {loading && rows.length === 0 && !message ? (
        <p className="type-ui mt-3 text-sm">Cargando…</p>
      ) : rows.length === 0 && !message ? (
        <p className="type-ui mt-3 text-sm">Todavía no hay etapas en este proyecto.</p>
      ) : (
        <div className="grid-brutal mt-3">
          {rows.map(({ stage, deliverables }, index) => (
            <StageCard
              key={stage.id}
              projectId={projectId}
              number={index + 1}
              stage={stage}
              deliverables={deliverables}
              me={me}
              onChanged={load}
            />
          ))}
        </div>
      )}

      <h2 className="type-subtitle-caps mt-6 text-lg">Agendar reunión</h2>
      <div className="mt-3">
        <MeetingScheduler projectId={projectId} stages={sortedStages} />
      </div>
    </section>
  );
}
