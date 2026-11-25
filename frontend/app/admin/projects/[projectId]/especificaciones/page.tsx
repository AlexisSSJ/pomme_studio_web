"use client";

import { useCallback, useEffect, useMemo, useState, FormEvent } from "react";
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

export default function AdminEspecificacionesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Specification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Filters
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state (handles both Create & Edit cleanly)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("furniture");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [finish, setFinish] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [supplier, setSupplier] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  // Delete state
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
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

  function openCreateModal() {
    setEditingId(null);
    setCategory("furniture");
    setName("");
    setCode("");
    setManufacturer("");
    setFinish("");
    setDimensions("");
    setSupplier("");
    setReferenceUrl("");
    setLocation("");
    setNotes("");
    setFormMessage("");
    setModalOpen(true);
  }

  function openEditModal(item: Specification) {
    setEditingId(item.id);
    setCategory(item.category);
    setName(item.name);
    setCode(item.code || "");
    setManufacturer(item.manufacturer || "");
    setFinish(item.finish || "");
    setDimensions(item.dimensions || "");
    setSupplier(item.supplier || "");
    setReferenceUrl(item.reference_url || "");
    setLocation(item.location || "");
    setNotes(item.notes || "");
    setFormMessage("");
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormMessage("El nombre es obligatorio.");
      return;
    }

    setSaving(true);
    setFormMessage("");
    try {
      const body: Record<string, unknown> = {
        category,
        name: trimmedName,
        code: code.trim() || null,
        manufacturer: manufacturer.trim() || null,
        finish: finish.trim() || null,
        dimensions: dimensions.trim() || null,
        supplier: supplier.trim() || null,
        reference_url: referenceUrl.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      };

      const url = editingId
        ? `/api/v1/projects/${projectId}/specifications/${editingId}`
        : `/api/v1/projects/${projectId}/specifications`;
      const method = editingId ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setModalOpen(false);
        setMessage(
          editingId
            ? "Especificación actualizada correctamente."
            : "Especificación agregada al catálogo."
        );
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFormMessage(
          extractDetail(
            data,
            editingId
              ? "Error al actualizar especificación"
              : "Error al crear especificación"
          )
        );
      }
    } catch {
      setFormMessage("Error de conexión con el servidor");
    } finally {
      setSaving(false);
    }
  }

  async function removeSpecification(itemId: string) {
    if (confirmingDeleteId !== itemId) {
      setConfirmingDeleteId(itemId);
      return;
    }

    setDeletingId(itemId);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/specifications/${itemId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setConfirmingDeleteId(null);
        setMessage("Especificación eliminada.");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al eliminar especificación"));
        setConfirmingDeleteId(null);
      }
    } catch {
      setMessage("Error de conexión con el servidor");
      setConfirmingDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

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
      {/* Header */}
      <div className="flex flex-col gap-5 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
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

        <button
          type="button"
          onClick={openCreateModal}
          className="type-ui min-h-[44px] shrink-0 whitespace-nowrap self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 sm:self-auto"
        >
          + Nueva especificación
        </button>
      </div>

      {message && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3">
          <p className="type-ui text-sm text-stone-800">{message}</p>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Cerrar mensaje"
            className="type-tech text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      {items.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="tablist"
            aria-label="Filtrar por categoría FF&E"
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
            {CATEGORY_OPTIONS.map((opt) => (
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
                {opt.label} ({categoryCounts[opt.value] ?? 0})
              </button>
            ))}
          </div>

          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, código, fabricante o ubicación…"
            aria-label="Buscar especificaciones"
            className="type-ui min-h-[44px] w-full rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 lg:w-72"
          />
        </div>
      )}

      {/* Catalog Sheet */}
      {loading && items.length === 0 ? (
        <p className="type-ui text-sm text-stone-600">Cargando catálogo…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-stone-900/10 bg-surface/65 p-8 sm:flex-row sm:items-center">
          <div>
            <p className="type-title text-lg text-stone-900">
              Catálogo FF&E vacío
            </p>
            <p className="type-editorial mt-1 text-sm text-stone-600">
              Registra mobiliario, luminarias, recubrimientos y equipamiento
              especificado para este proyecto.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800"
          >
            + Agregar primera ficha
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-stone-900/10 bg-surface/65 p-8">
          <p className="type-editorial text-base italic text-stone-600">
            No hay especificaciones que coincidan con los filtros actuales.
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

                  <div className="flex flex-wrap items-center gap-2">
                    {item.reference_url && (
                      <a
                        href={item.reference_url}
                        target="_blank"
                        rel="noreferrer"
                        className="type-ui inline-flex min-h-[40px] shrink-0 whitespace-nowrap items-center rounded-lg border border-stone-900/20 bg-background px-3.5 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                      >
                        Referencia ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-3.5 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSpecification(item.id)}
                      disabled={deletingId === item.id}
                      className={`type-ui min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs transition-colors disabled:opacity-50 ${
                        confirmingDeleteId === item.id
                          ? "bg-stone-900 text-background hover:bg-stone-800"
                          : "border border-stone-900/15 bg-background text-stone-500 hover:border-stone-900/40 hover:text-stone-900"
                      }`}
                    >
                      {deletingId === item.id
                        ? "Eliminando…"
                        : confirmingDeleteId === item.id
                          ? "Confirmar eliminación"
                          : "Eliminar"}
                    </button>
                  </div>
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

      {/* Create / Edit Specification Modal */}
      {modalOpen && (
        <div
          className="animate-backdrop-enter brief-editorial fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="spec-modal-title"
        >
          <div className="animate-modal-enter max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-stone-900/10 pb-4">
              <div>
                <p className="type-tech text-stone-500">
                  {editingId ? "Edición de ficha FF&E" : "Alta de ficha FF&E"}
                </p>
                <h2
                  id="spec-modal-title"
                  className="type-title mt-1 text-xl text-stone-900"
                >
                  {editingId ? "Editar especificación" : "Nueva especificación"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar ventana"
                className="type-ui flex h-10 w-10 items-center justify-center rounded-full border border-stone-900/15 text-stone-600 transition-colors hover:bg-stone-900 hover:text-background"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Nombre *
                  </span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Silla Eames"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Categoría *
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 focus:border-stone-900/45"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Código / Modelo
                  </span>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Ej. CH-01"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Fabricante
                  </span>
                  <input
                    type="text"
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    placeholder="Ej. Herman Miller"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Acabado / Material
                  </span>
                  <input
                    type="text"
                    value={finish}
                    onChange={(e) => setFinish(e.target.value)}
                    placeholder="Ej. Nogal natural"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Dimensiones
                  </span>
                  <input
                    type="text"
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    placeholder="Ej. 60 x 60 x 80 cm"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Proveedor
                  </span>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Ej. Interior Design Co."
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="type-ui text-xs text-stone-600">
                    Ubicación en proyecto
                  </span>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Ej. Sala principal"
                    className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">
                  URL de referencia
                </span>
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  placeholder="https://..."
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="type-ui text-xs text-stone-600">Notas</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Observaciones o instrucciones especiales…"
                  className="type-ui w-full rounded-lg border border-stone-900/15 bg-background p-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                />
              </label>

              {formMessage && (
                <p className="type-ui rounded-lg border border-stone-900/15 bg-surface/75 px-3.5 py-2.5 text-xs text-stone-800">
                  {formMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 border-t border-stone-900/10 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="type-ui min-h-[44px] rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors hover:bg-stone-900 hover:text-background"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                >
                  {saving
                    ? "Guardando…"
                    : editingId
                      ? "Guardar cambios ↗"
                      : "Crear especificación ↗"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
