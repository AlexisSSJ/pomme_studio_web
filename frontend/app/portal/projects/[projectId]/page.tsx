"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";

interface Project {
  id: string;
  title: string;
  scope_type: string | null;
  status: string;
  included_rounds: number;
  remaining_rounds: number;
  balance_paid: boolean;
  created_at: string;
}

interface BriefPending {
  has_pending_brief: boolean;
  progress: number;
  total_questions: number;
  answered_questions: number;
}

export default function PortalProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<BriefPending | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resProject = await apiFetch(`/api/v1/projects/${projectId}`);
      if (resProject.ok) {
        setProject(await resProject.json());
      } else {
        const data: unknown = await resProject.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }
      const resBrief = await apiFetch(
        `/api/v1/projects/${projectId}/brief/pending`
      ).catch(() => null);
      if (resBrief && resBrief.ok) {
        setBrief(await resBrief.json());
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const sections = [
    {
      num: "01",
      title: "Brief creativo",
      desc: "Responde el cuestionario, adjunta referencias y revisa el enfoque del proyecto.",
      href: `/portal/projects/${projectId}/brief`,
    },
    {
      num: "02",
      title: "Etapas y entregables",
      desc: "Revisa avances por fase, aprueba entregas o solicita rondas de ajustes.",
      href: `/portal/projects/${projectId}/etapas`,
    },
    {
      num: "03",
      title: "Catálogo FF&E",
      desc: "Consulta mobiliario, luminarias, acabados y especificaciones técnicas.",
      href: `/portal/projects/${projectId}/especificaciones`,
    },
    {
      num: "04",
      title: "Librería de Assets",
      desc: "Descarga archivos, planos, presentaciones e historial de versiones.",
      href: `/portal/projects/${projectId}/assets`,
    },
    {
      num: "05",
      title: "Reuniones",
      desc: "Consulta tus próximas sesiones y agenda revisiones con el estudio.",
      href: `/portal/projects/${projectId}/reuniones`,
    },
  ];

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">Resumen del proyecto</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          {project?.title ?? "Proyecto"}
        </h1>
      </div>

      {message && (
        <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-700">
          {message}
        </p>
      )}

      {brief && brief.has_pending_brief && (
        <div className="rounded-2xl border border-stone-900/20 bg-background p-6 shadow-editorial">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="type-tech text-stone-500">Acción pendiente</p>
              <p className="type-editorial text-lg text-stone-900">
                Brief al {brief.progress}% · {brief.answered_questions} de{" "}
                {brief.total_questions} preguntas respondidas.
              </p>
            </div>
            <Link
              href={`/portal/projects/${projectId}/brief`}
              className="type-ui inline-flex min-h-[44px] shrink-0 whitespace-nowrap items-center justify-center rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
            >
              Continuar brief ↗
            </Link>
          </div>
          <div className="mt-4 h-[2px] w-full bg-stone-900/10">
            <div
              className="h-full bg-stone-900 transition-all duration-500"
              style={{
                width: `${Math.min(100, Math.max(0, brief.progress))}%`,
              }}
            />
          </div>
        </div>
      )}

      {loading && !project ? (
        <p className="type-ui text-sm text-stone-600">Cargando proyecto…</p>
      ) : project ? (
        <>
          <div className="grid grid-cols-2 divide-y divide-stone-900/10 rounded-2xl border border-stone-900/15 bg-background shadow-editorial sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <div className="p-5 md:p-6">
              <p className="type-tech text-stone-500">Estado</p>
              <p className="type-editorial mt-1.5 text-xl capitalize text-stone-900">
                {project.status}
              </p>
            </div>
            <div className="p-5 md:p-6">
              <p className="type-tech text-stone-500">Alcance</p>
              <p className="type-editorial mt-1.5 text-xl capitalize text-stone-900">
                {project.scope_type || "Sin scope"}
              </p>
            </div>
            <div className="p-5 md:p-6">
              <p className="type-tech text-stone-500">Rondas disponibles</p>
              <p className="type-title mt-1.5 text-2xl tabular-nums text-stone-900">
                {project.remaining_rounds}/{project.included_rounds}
              </p>
            </div>
            <div className="p-5 md:p-6">
              <p className="type-tech text-stone-500">Pago final</p>
              <p
                className={`type-editorial mt-1.5 text-xl ${
                  project.balance_paid ? "text-[#44544A]" : "text-stone-900"
                }`}
              >
                {project.balance_paid ? "Pagado" : "Pendiente"}
              </p>
            </div>
          </div>

          {/* Editorial Quick-Access Directory */}
          <div className="rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
            <div className="border-b border-stone-900/10 px-6 py-4 md:px-7">
              <p className="type-tech text-stone-500">
                Espacios del proyecto
              </p>
            </div>
            <div className="divide-y divide-stone-900/10">
              {sections.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-surface/45 md:px-7"
                >
                  <div className="flex min-w-0 items-baseline gap-4">
                    <span className="type-tech w-6 shrink-0 text-stone-400">
                      {item.num}
                    </span>
                    <div className="min-w-0">
                      <p className="type-editorial text-lg text-stone-900">
                        {item.title}
                      </p>
                      <p className="type-ui mt-0.5 text-xs text-stone-500">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    className="type-ui shrink-0 text-sm text-stone-400 transition-colors group-hover:text-stone-900"
                  >
                    ↗
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
