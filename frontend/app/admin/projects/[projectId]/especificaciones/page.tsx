"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
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

export default function AdminEspecificacionesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Specification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [creating, setCreating] = useState(false);

  // Form fields state for create
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

  // Edit and delete state per item id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<Category>("furniture");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editManufacturer, setEditManufacturer] = useState("");
  const [editFinish, setEditFinish] = useState("");
  const [editDimensions, setEditDimensions] = useState("");
  const [editSupplier, setEditSupplier] = useState("");
  const [editReferenceUrl, setEditReferenceUrl] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState("");

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

  async function createSpecification(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormMessage("El nombre es obligatorio");
      return;
    }

    setCreating(true);
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

      const res = await apiFetch(`/api/v1/projects/${projectId}/specifications`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setName("");
        setCode("");
        setManufacturer("");
        setFinish("");
        setDimensions("");
        setSupplier("");
        setReferenceUrl("");
        setLocation("");
        setNotes("");
        setCategory("furniture");
        setFormMessage("Especificación creada");
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setFormMessage(extractDetail(data, "Error al crear especificación"));
      }
    } catch {
      setFormMessage("Error de conexión con el servidor");
    } finally {
      setCreating(false);
    }
  }

  function startEditing(item: Specification) {
    setEditingId(item.id);
    setEditCategory(item.category);
    setEditName(item.name);
    setEditCode(item.code || "");
    setEditManufacturer(item.manufacturer || "");
    setEditFinish(item.finish || "");
    setEditDimensions(item.dimensions || "");
    setEditSupplier(item.supplier || "");
    setEditReferenceUrl(item.reference_url || "");
    setEditLocation(item.location || "");
    setEditNotes(item.notes || "");
    setEditMessage("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditMessage("");
  }

  async function saveEdition(itemId: string, e: FormEvent) {
    e.preventDefault();
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditMessage("El nombre es obligatorio");
      return;
    }

    setUpdating(true);
    setEditMessage("");
    try {
      const body: Record<string, unknown> = {
        category: editCategory,
        name: trimmedName,
        code: editCode.trim() || null,
        manufacturer: editManufacturer.trim() || null,
        finish: editFinish.trim() || null,
        dimensions: editDimensions.trim() || null,
        supplier: editSupplier.trim() || null,
        reference_url: editReferenceUrl.trim() || null,
        location: editLocation.trim() || null,
        notes: editNotes.trim() || null,
      };

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/specifications/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        }
      );

      if (res.ok) {
        setEditingId(null);
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setEditMessage(extractDetail(data, "Error al actualizar especificación"));
      }
    } catch {
      setEditMessage("Error de conexión con el servidor");
    } finally {
      setUpdating(false);
    }
  }

  async function removeSpecification(itemId: string) {
    if (confirmingDeleteId !== itemId) {
      setConfirmingDeleteId(itemId);
      setDeleteMessage("");
      return;
    }

    setDeletingId(itemId);
    setDeleteMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/specifications/${itemId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setConfirmingDeleteId(null);
        await load();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setDeleteMessage(extractDetail(data, "Error al eliminar especificación"));
        setConfirmingDeleteId(null);
      }
    } catch {
      setDeleteMessage("Error de conexión con el servidor");
      setConfirmingDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl tracking-tightest">Catálogo FF&E</h1>
          {project && <p className="label-mono mt-1">{project.title}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/projects"
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Volver a proyectos
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </Link>
          <Link
            href={`/admin/projects/${projectId}/etapas`}
            className="btn-brutal min-h-[44px] px-3 text-xs"
          >
            Volver a etapas
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
      )}

      {deleteMessage && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{deleteMessage}</p>
      )}

      {/* Create form */}
      <h2 className="mt-8 text-lg tracking-tightest">Nueva especificación</h2>
      <form
        onSubmit={createSpecification}
        className="mt-3 flex flex-col gap-4 border border-border bg-surface p-4 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="label-mono">Nombre *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Silla Eames"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Categoría *</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Código / Modelo</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ej. CH-01"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Fabricante</span>
            <input
              type="text"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="Ej. Herman Miller"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Acabado / Material</span>
            <input
              type="text"
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
              placeholder="Ej. Nogal natural"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Dimensiones</span>
            <input
              type="text"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              placeholder="Ej. 60 x 60 x 80 cm"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Proveedor</span>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Ej. Interior Design Co."
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">URL de referencia</span>
            <input
              type="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder="https://..."
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">Ubicación en proyecto</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ej. Sala principal"
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label-mono">Notas</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observaciones o instrucciones especiales..."
            className="min-h-[80px] border border-border bg-background p-3 text-sm"
          />
        </label>

        {formMessage && <p className="text-sm">{formMessage}</p>}

        <div>
          <button
            type="submit"
            disabled={creating}
            className="btn-brutal min-h-[44px] px-4 text-xs"
          >
            {creating ? "Creando..." : "Crear especificación"}
            <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </form>

      {/* List */}
      <h2 className="mt-8 text-lg tracking-tightest">Especificaciones registradas</h2>
      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm">Todavía no hay especificaciones.</p>
      ) : (
        <div className="grid-brutal mt-4">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <div key={item.id} className="flex flex-col gap-3 p-4">
                {isEditing ? (
                  <form onSubmit={(e) => saveEdition(item.id, e)} className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Nombre *</span>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Categoría *</span>
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as Category)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        >
                          {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Código</span>
                        <input
                          type="text"
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Fabricante</span>
                        <input
                          type="text"
                          value={editManufacturer}
                          onChange={(e) => setEditManufacturer(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Acabado</span>
                        <input
                          type="text"
                          value={editFinish}
                          onChange={(e) => setEditFinish(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Dimensiones</span>
                        <input
                          type="text"
                          value={editDimensions}
                          onChange={(e) => setEditDimensions(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Proveedor</span>
                        <input
                          type="text"
                          value={editSupplier}
                          onChange={(e) => setEditSupplier(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">URL de referencia</span>
                        <input
                          type="url"
                          value={editReferenceUrl}
                          onChange={(e) => setEditReferenceUrl(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label-mono">Ubicación</span>
                        <input
                          type="text"
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                          className="min-h-[44px] border border-border bg-background px-3 text-sm"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="label-mono">Notas</span>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className="min-h-[60px] border border-border bg-background p-3 text-sm"
                      />
                    </label>

                    {editMessage && <p className="text-sm">{editMessage}</p>}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={updating}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        {updating ? "Guardando..." : "Guardar"}
                        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
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

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        Editar
                        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSpecification(item.id)}
                        disabled={deletingId === item.id}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        {deletingId === item.id
                          ? "Eliminando..."
                          : confirmingDeleteId === item.id
                          ? "Confirmar eliminación"
                          : "Eliminar"}
                        <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
