"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const opt of CATEGORY_OPTIONS) counts[opt.value] = 0;
    for (const item of items) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== "all" && item.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return [
        item.name,
        item.code,
        item.manufacturer,
        item.finish,
        item.supplier,
        item.location,
        item.notes,
      ].some((field) => field?.toLowerCase().includes(q));
    });
  }, [items, activeCategory, searchQuery]);

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">
          03 · Especificaciones de interiores
        </p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Catálogo FF&E
        </h1>
        {project && (
          <p className="type-editorial mt-1.5 text-sm italic text-stone-600">
            {project.title}
          </p>
        )}
      </div>

      {message && (
        <p className="type-ui rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-700">
          {message}
        </p>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="tablist"
            aria-label="Filtrar catálogo por categoría"
            className="flex flex-wrap items-center gap-1 rounded-xl bg-surface/80 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
              className={`type-ui min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs transition-colors ${
                activeCategory === "all"
                  ? "bg-background font-medium text-stone-900 shadow-editorial"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Todas ({categoryCounts.all})
            </button>
            {CATEGORY_OPTIONS.filter(
              (opt) => (categoryCounts[opt.value] ?? 0) > 0
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={activeCategory === opt.value}
                onClick={() => setActiveCategory(opt.value)}
                className={`type-ui min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs transition-colors ${
                  activeCategory === opt.value
                    ? "bg-background font-medium text-stone-900 shadow-editorial"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {opt.label} ({categoryCounts[opt.value]})
              </button>
            ))}
          </div>

          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar pieza, fabricante o ubicación…"
            aria-label="Buscar especificaciones"
            className="type-ui min-h-[44px] w-full rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 lg:w-72"
          />
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="type-ui text-sm text-stone-600">Cargando catálogo…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-[15px] italic text-stone-600">
            Todavía no hay especificaciones publicadas para este proyecto.
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-[15px] italic text-stone-600">
            No se encontraron fichas con ese criterio de búsqueda.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-900/10 rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
          {filteredItems.map((item, idx) => {
            const attrs: Array<{ label: string; value: string }> = [
              item.manufacturer
                ? { label: "Fabricante", value: item.manufacturer }
                : null,
              item.finish ? { label: "Acabado", value: item.finish } : null,
              item.dimensions
                ? { label: "Dimensiones", value: item.dimensions }
                : null,
              item.supplier
                ? { label: "Proveedor", value: item.supplier }
                : null,
              item.location
                ? { label: "Ubicación", value: item.location }
                : null,
            ].filter((x): x is { label: string; value: string } => x !== null);

            return (
              <article key={item.id} className="space-y-4 p-6 md:px-8 md:py-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="type-tech text-stone-400">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span aria-hidden="true" className="text-stone-300">
                        ·
                      </span>
                      <span className="type-tech text-stone-600">
                        {categoryLabel(item.category)}
                      </span>
                      {item.code && (
                        <>
                          <span aria-hidden="true" className="text-stone-300">
                            ·
                          </span>
                          <span className="type-tech text-stone-900">
                            {item.code}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="type-editorial text-xl text-stone-900">
                      {item.name}
                    </h2>
                  </div>

                  {item.reference_url && (
                    <a
                      href={item.reference_url}
                      target="_blank"
                      rel="noreferrer"
                      className="type-ui inline-flex min-h-[40px] shrink-0 whitespace-nowrap items-center self-start rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                    >
                      Ver referencia ↗
                    </a>
                  )}
                </div>

                {attrs.length > 0 && (
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {attrs.map((attr) => (
                      <div key={attr.label} className="space-y-0.5">
                        <dt className="type-tech text-[10px] text-stone-400">
                          {attr.label}
                        </dt>
                        <dd className="type-ui text-sm text-stone-900">
                          {attr.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {item.notes && (
                  <p className="type-editorial max-w-3xl border-t border-stone-900/10 pt-3 text-[15px] leading-relaxed text-stone-600">
                    {item.notes}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
