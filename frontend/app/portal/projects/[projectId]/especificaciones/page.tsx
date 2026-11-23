"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, extractDetail } from "@/lib/api";

interface Specification {
  id: string;
  project_id: string;
  category: "furniture" | "lighting" | "finishes" | "equipment" | "other";
  name: string;
  code: string | null;
  manufacturer: string | null;
  finish: string | null;
  dimensions: string | null;
  supplier: string | null;
  reference_url: string | null;
  location: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

type Category = Specification["category"];

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "furniture", label: "Mobiliario" },
  { value: "lighting", label: "Luminarias" },
  { value: "finishes", label: "Recubrimientos" },
  { value: "equipment", label: "Equipamiento" },
  { value: "other", label: "Otro" },
];

function categoryLabel(cat: Category): string {
  return CATEGORY_OPTIONS.find((o) => o.value === cat)?.label ?? cat;
}

interface Project {
  id: string;
  title: string;
}

export default function PortalEspecificacionesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Specification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setMessage("");
    try {
      const [projectRes, specsRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}`),
        apiFetch(`/api/v1/projects/${projectId}/specifications`),
      ]);

      if (projectRes.ok) {
        setProject(await projectRes.json());
      } else {
        const data: unknown = await projectRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar el proyecto"));
      }

      if (specsRes.ok) {
        setItems(await specsRes.json());
      } else {
        const data: unknown = await specsRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar especificaciones"));
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

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="type-title text-xl">Catálogo FF&E</h1>
          {project && <p className="label-mono mt-1">{project.title}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/portal/projects/${projectId}/etapas`}
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Volver a etapas
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </Link>
          <Link
            href="/portal"
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Volver a portal
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
      )}

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm">Todavía no hay especificaciones.</p>
      ) : (
        <div className="grid-brutal mt-4">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <p className="label-mono">{categoryLabel(item.category)}</p>
                <p className="text-base font-semibold">{item.name}</p>
              </div>

              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {item.code && (
                  <p>
                    <span className="font-semibold">Código:</span> {item.code}
                  </p>
                )}
                {item.manufacturer && (
                  <p>
                    <span className="font-semibold">Fabricante:</span> {item.manufacturer}
                  </p>
                )}
                {item.finish && (
                  <p>
                    <span className="font-semibold">Acabado:</span> {item.finish}
                  </p>
                )}
                {item.dimensions && (
                  <p>
                    <span className="font-semibold">Dimensiones:</span> {item.dimensions}
                  </p>
                )}
                {item.supplier && (
                  <p>
                    <span className="font-semibold">Proveedor:</span> {item.supplier}
                  </p>
                )}
                {item.location && (
                  <p>
                    <span className="font-semibold">Ubicación:</span> {item.location}
                  </p>
                )}
              </div>

              {item.notes && (
                <p className="text-sm text-foreground/80">
                  <span className="font-semibold">Notas:</span> {item.notes}
                </p>
              )}

              {item.reference_url && (
                <a
                  href={item.reference_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                >
                  Ver referencia <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
