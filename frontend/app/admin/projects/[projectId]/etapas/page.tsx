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
  created_by: string;
  created_at: string;
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
  onChanged,
}: {
  projectId: string;
  number: number;
  stage: Stage;
  deliverables: Deliverable[];
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
      <p className="text-sm font-semibold">{stage.name}</p>

      {stage.status === "locked" && (
        <p className="text-sm">Se desbloquea al aprobar la etapa anterior.</p>
      )}

      {deliverables.length > 0 && (
        <div className="flex flex-col gap-2">
          {deliverables.map((deliverable) => {
            const viewerOpen = viewerDeliverableId === deliverable.id;
            return (
              <div key={deliverable.id} className="flex flex-col gap-2">
                <p className="text-sm font-semibold">{deliverable.title}</p>
                <p className="label-mono">
                  V{deliverable.version} ·{" "}
                  {deliverableStatusLabel(deliverable.status)}
                </p>
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
        </div>
      )}

      {stage.status === "active" && (
        <form
          onSubmit={uploadDeliverable}
          className="flex flex-col gap-3 border border-border bg-background p-3"
        >
          <p className="label-mono">NUEVA VERSIÓN</p>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Título</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={255}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 border border-border bg-background px-3">
            <span className="label-mono truncate">
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
          {uploadMessage && <p className="text-sm">{uploadMessage}</p>}
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
      <h1 className="text-xl tracking-tightest">Etapas</h1>
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
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 border border-border bg-surface p-4">
        <p className="label-mono">RONDAS EXTRA</p>
        <p className="text-sm">
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
          <p className="border border-border bg-background p-3 text-sm">
            {roundsMessage}
          </p>
        )}
      </div>

      <h2 className="mt-6 text-lg tracking-tightest">Nueva etapa</h2>
      <form
        onSubmit={createStage}
        className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="label-mono">Nombre</span>
          <input
            type="text"
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            maxLength={255}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-mono">Orden</span>
          <input
            type="number"
            step={1}
            min={0}
            value={stageOrder}
            onChange={(event) => setStageOrder(event.target.value)}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>
        <p className="text-sm">
          La primera etapa nace en curso; las siguientes nacen bloqueadas
          hasta que el cliente aprueba las anteriores.
        </p>
        {stageMessage && <p className="text-sm">{stageMessage}</p>}
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

      <h2 className="mt-6 text-lg tracking-tightest">Etapas del proyecto</h2>
      {loading && rows.length === 0 && !message ? (
        <p className="mt-3 text-sm">Cargando…</p>
      ) : rows.length === 0 && !message ? (
        <p className="mt-3 text-sm">Todavía no hay etapas en este proyecto.</p>
      ) : (
        <div className="grid-brutal mt-3">
          {rows.map(({ stage, deliverables }, index) => (
            <StageCard
              key={stage.id}
              projectId={projectId}
              number={index + 1}
              stage={stage}
              deliverables={deliverables}
              onChanged={load}
            />
          ))}
        </div>
      )}

      <h2 className="mt-6 text-lg tracking-tightest">Agendar reunión</h2>
      <div className="mt-3">
        <MeetingScheduler projectId={projectId} stages={sortedStages} />
      </div>
    </section>
  );
}
