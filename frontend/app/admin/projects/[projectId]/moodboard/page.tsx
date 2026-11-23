"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import {
  MoodboardComposition,
  type MoodboardItemData,
  type MoodboardLayout,
} from "@/components/MoodboardComposition";
import { MoodboardCommentPanel } from "@/components/MoodboardCommentPanel";

interface MoodboardBoard {
  id: string;
  project_id: string;
  title: string;
  curatorial_note: string | null;
  layout_variant: MoodboardLayout;
  position: number;
  item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface MoodboardItem {
  id: string;
  moodboard_id: string | null;
  project_id: string;
  title: string;
  description: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  created_by: string;
  created_at: string;
  comment_count: number;
}

const MAX_BOARD_IMAGES = 10;
const RECOMMENDED_IMAGES = 6;
const MAX_REACHED_MESSAGE =
  "Este moodboard ya tiene el máximo de 10 imágenes";
const NOT_IMAGE_MESSAGE =
  "Solo se pueden agregar imágenes (JPG, PNG, WEBP o GIF)";
const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const LAYOUT_OPTIONS: { value: MoodboardLayout; label: string }[] = [
  {
    value: "editorial_collage",
    label: "Lámina editorial · Collage asimétrico",
  },
  {
    value: "atelier_grid",
    label: "Retícula de estudio · Mosaico modular",
  },
  { value: "monograph_strip", label: "Banda focal + Secuencia" },
];

function boardNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Eliminación de la pieza seleccionada en dos pasos, dentro de la cabecera
 * del panel de comentarios (misma lógica que el pie anterior).
 */
function MoodboardPieceDelete({
  projectId,
  item,
  onDeleted,
}: {
  projectId: string;
  item: MoodboardItem;
  onDeleted: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function removePiece() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setFeedback("");
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
        onDeleted();
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      setFeedback(extractDetail(data, "Error al eliminar la pieza"));
      setConfirmingDelete(false);
    } catch {
      setFeedback("Error de conexión con el servidor");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={removePiece}
        disabled={deleting}
        className="btn-brutal min-h-[44px] px-3 text-xs"
      >
        {deleting
          ? "Eliminando…"
          : confirmingDelete
            ? "Confirmar eliminación"
            : "Eliminar pieza"}
        <span className="btn-brutal__arrow" aria-hidden="true">
          ↗
        </span>
      </button>
      {feedback && (
        <p className="type-ui border border-border bg-surface p-2 text-sm">
          {feedback}
        </p>
      )}
    </div>
  );
}

export default function AdminMoodboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [boards, setBoards] = useState<MoodboardBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [message, setMessage] = useState("");
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  // La lista puede fallar sin que la lámina esté vacía: no confundir ambos estados.
  const [itemsFailed, setItemsFailed] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newLayout, setNewLayout] =
    useState<MoodboardLayout>("editorial_collage");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [boardMessage, setBoardMessage] = useState("");

  const [layoutBusy, setLayoutBusy] = useState<MoodboardLayout | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingBoard, setDeletingBoard] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string | undefined>(
    undefined
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Descarta respuestas de una lámina ya abandonada al cambiar de pestaña.
  const itemsRequestRef = useRef(0);
  // Ref espejo de las piezas en memoria: distingue el fallo de la carga
  // inicial del fallo de una recarga que aún tiene datos válidos que mostrar.
  const itemsRef = useRef<MoodboardItem[]>([]);

  const activeBoard =
    boards.find((board) => board.id === activeBoardId) ?? null;
  const atCap = items.length >= MAX_BOARD_IMAGES;
  const selectedItem =
    items.find((item) => item.id === selectedItemId) ?? null;

  const loadBoards = useCallback(async () => {
    if (!projectId) {
      setLoadingBoards(false);
      return;
    }
    setLoadingBoards(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards`
      );
      if (res.ok) {
        const data = (await res.json()) as MoodboardBoard[];
        setBoards(data);
        setActiveBoardId((prev) =>
          prev && data.some((board) => board.id === prev)
            ? prev
            : data[0]?.id ?? null
        );
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar los moodboards"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoadingBoards(false);
    }
  }, [projectId]);

  const loadItems = useCallback(async () => {
    const requestId = ++itemsRequestRef.current;
    if (!projectId || !activeBoardId) {
      setItems([]);
      setItemsFailed(false);
      setLoadingItems(false);
      return;
    }
    // Limpia el aviso anterior: una recarga correcta no debe arrastrarlo.
    setMessage("");
    setItemsFailed(false);
    setLoadingItems(true);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoardId}/items`
      );
      if (requestId !== itemsRequestRef.current) return;
      if (res.ok) {
        setItems(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las piezas"));
        // Si ya hay piezas válidas en memoria, la recarga fallida no las
        // invalida: se mantiene la composición y solo se muestra el aviso.
        if (itemsRef.current.length === 0) setItemsFailed(true);
      }
    } catch {
      if (requestId === itemsRequestRef.current) {
        setMessage("Error de conexión con el servidor");
        if (itemsRef.current.length === 0) setItemsFailed(true);
      }
    } finally {
      if (requestId === itemsRequestRef.current) {
        setLoadingItems(false);
      }
    }
  }, [projectId, activeBoardId]);

  const refreshActiveBoard = useCallback(async () => {
    await Promise.all([loadItems(), loadBoards()]);
  }, [loadItems, loadBoards]);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Identidad del usuario actual: habilita borrar solo los comentarios propios.
  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as { id: string };
        if (active) setCurrentUserId(data.id);
      } catch {
        // Sin identidad el panel sigue operativo: solo se oculta el borrado.
      }
    }

    void loadMe();
    return () => {
      active = false;
    };
  }, []);

  // Espejo de `items` para que `loadItems` consulte el contenido actual sin
  // recrearse en cada cambio de lista.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Al cambiar de lámina se descarta cualquier edición, confirmación o
  // selección pendiente de la anterior.
  useEffect(() => {
    setEditing(false);
    setEditTitle("");
    setEditNote("");
    setBoardMessage("");
    setConfirmingDelete(false);
    setUploadMessage("");
    setSelectedItemId(null);
    itemsRef.current = [];
    setItems([]);
  }, [activeBoardId]);

  // Si la pieza seleccionada desaparece (borrado o recarga), cierra el panel.
  useEffect(() => {
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [items, selectedItemId]);

  const uploadFiles = useCallback(
    async (incoming: FileList | File[]) => {
      if (!activeBoard) return;
      if (uploadingRef.current) {
        setUploadMessage("Espera a que termine la carga en curso");
        return;
      }
      const files = Array.from(incoming);
      if (files.length === 0) return;
      if (items.length >= MAX_BOARD_IMAGES) {
        setUploadMessage(MAX_REACHED_MESSAGE);
        return;
      }

      const images = files.filter((file) =>
        SUPPORTED_IMAGE_TYPES.includes(file.type)
      );
      const rejectedCount = files.length - images.length;
      if (images.length === 0) {
        setUploadMessage(NOT_IMAGE_MESSAGE);
        return;
      }

      uploadingRef.current = true;
      setUploading(true);
      setUploadMessage("Subiendo imágenes…");

      let uploaded = 0;
      let capped = false;
      let failure = "";
      try {
        for (const image of images) {
          const form = new FormData();
          form.append("file", image);
          const res = await apiFetch(
            `/api/v1/projects/${projectId}/moodboard/boards/${activeBoard.id}/items`,
            { method: "POST", body: form }
          );
          if (res.status === 409) {
            capped = true;
            break;
          }
          if (!res.ok) {
            const data: unknown = await res.json().catch(() => ({}));
            failure = extractDetail(data, "Error al subir la imagen");
            break;
          }
          uploaded += 1;
        }
      } catch {
        failure = "Error de conexión con el servidor";
      } finally {
        uploadingRef.current = false;
        setUploading(false);
        // Un 409 también recarga: el servidor puede estar en 10 aunque el
        // contador local no lo refleje (estado obsoleto en la tanda).
        if (uploaded > 0 || capped) {
          await refreshActiveBoard();
        }
      }

      if (capped) {
        setUploadMessage(MAX_REACHED_MESSAGE);
        return;
      }
      if (failure) {
        setUploadMessage(failure);
        return;
      }
      setUploadMessage(rejectedCount > 0 ? NOT_IMAGE_MESSAGE : "");
    },
    [activeBoard, items.length, projectId, refreshActiveBoard]
  );

  // Pegar con Ctrl+V en cualquier punto de la página sube las imágenes del
  // portapapeles; el texto pegado en un campo no trae archivos y se ignora.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      void uploadFiles(files);
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [uploadFiles]);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      void uploadFiles(files);
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      void uploadFiles(files);
    }
    // Permite volver a elegir los mismos archivos.
    event.target.value = "";
  }

  async function createBoard(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      setCreateMessage("El título no puede estar vacío");
      return;
    }

    setCreating(true);
    setCreateMessage("");
    try {
      const body: Record<string, unknown> = {
        title: trimmedTitle,
        layout_variant: newLayout,
      };
      if (newNote.trim()) {
        body.curatorial_note = newNote.trim();
      }

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (res.ok) {
        const created = (await res.json()) as MoodboardBoard;
        setNewTitle("");
        setNewNote("");
        setNewLayout("editorial_collage");
        setCreateMessage("Moodboard creado");
        setActiveBoardId(created.id);
        await loadBoards();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setCreateMessage(extractDetail(data, "Error al crear el moodboard"));
      }
    } catch {
      setCreateMessage("Error de conexión con el servidor");
    } finally {
      setCreating(false);
    }
  }

  function startEditing() {
    if (!activeBoard) return;
    setEditing(true);
    setEditTitle(activeBoard.title);
    setEditNote(activeBoard.curatorial_note ?? "");
    setBoardMessage("");
  }

  async function saveBoardEdit(event: FormEvent) {
    event.preventDefault();
    if (!activeBoard) return;
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setBoardMessage("El título no puede estar vacío");
      return;
    }

    setUpdating(true);
    setBoardMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoard.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: trimmedTitle,
            curatorial_note: editNote.trim() || null,
          }),
        }
      );
      if (res.ok) {
        const updated = (await res.json()) as MoodboardBoard;
        setBoards((prev) =>
          prev.map((board) => (board.id === updated.id ? updated : board))
        );
        setEditing(false);
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setBoardMessage(extractDetail(data, "Error al actualizar el moodboard"));
      }
    } catch {
      setBoardMessage("Error de conexión con el servidor");
    } finally {
      setUpdating(false);
    }
  }

  async function changeLayout(layout: MoodboardLayout) {
    if (!activeBoard || layoutBusy) return;
    setLayoutBusy(layout);
    setBoardMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoard.id}`,
        { method: "PATCH", body: JSON.stringify({ layout_variant: layout }) }
      );
      if (res.ok) {
        const updated = (await res.json()) as MoodboardBoard;
        setBoards((prev) =>
          prev.map((board) => (board.id === updated.id ? updated : board))
        );
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setBoardMessage(extractDetail(data, "Error al cambiar el layout"));
      }
    } catch {
      setBoardMessage("Error de conexión con el servidor");
    } finally {
      setLayoutBusy(null);
    }
  }

  async function removeBoard() {
    if (!activeBoard) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setBoardMessage("");
      return;
    }

    setDeletingBoard(true);
    setBoardMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoard.id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setConfirmingDelete(false);
        await loadBoards();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setBoardMessage(extractDetail(data, "Error al eliminar el moodboard"));
        setConfirmingDelete(false);
      }
    } catch {
      setBoardMessage("Error de conexión con el servidor");
      setConfirmingDelete(false);
    } finally {
      setDeletingBoard(false);
    }
  }

  return (
    <section>
      <h1 className="type-title text-xl">Moodboard</h1>

      {message && (
        <p className="type-ui mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <h2 className="type-subtitle-caps mt-6 text-lg">Nuevo moodboard</h2>
      <form
        onSubmit={createBoard}
        className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4 sm:p-6"
      >
        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Título *</span>
          <input
            type="text"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            maxLength={255}
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Nota curatorial (opcional)</span>
          <textarea
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
            maxLength={2000}
            className="type-ui min-h-[80px] border border-border bg-background p-3 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-ui text-sm">Layout</span>
          <select
            value={newLayout}
            onChange={(event) =>
              setNewLayout(event.target.value as MoodboardLayout)
            }
            className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
          >
            {LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {createMessage && <p className="type-ui text-sm">{createMessage}</p>}

        <button
          type="submit"
          disabled={creating}
          className="btn-brutal min-h-[44px] self-start px-3 text-xs"
        >
          {creating ? "Creando…" : "Crear moodboard"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </form>

      <h2 className="type-subtitle-caps mt-8 text-lg">Moodboards</h2>

      {loadingBoards && boards.length === 0 ? (
        <p className="type-ui mt-3 text-sm">Cargando…</p>
      ) : boards.length === 0 ? (
        <p className="type-ui mt-3 text-sm">
          Todavía no hay moodboards. Crea el primero.
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {boards.map((board, index) => {
              const active = board.id === activeBoardId;
              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => setActiveBoardId(board.id)}
                  aria-pressed={active}
                  className={`btn-brutal min-h-[44px] shrink-0 px-3 text-xs ${
                    active ? "bg-foreground text-background" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="label-mono">{boardNumber(index)}</span>
                    {board.title}
                  </span>
                </button>
              );
            })}
          </div>

          {activeBoard && (
            <>
              <div className="mt-6 flex flex-col gap-4 border border-border bg-surface p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <p className="label-mono">LÁMINA ACTIVA</p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startEditing}
                      aria-pressed={editing}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      Editar lámina
                      <span className="btn-brutal__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={removeBoard}
                      disabled={deletingBoard}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      {deletingBoard
                        ? "Eliminando…"
                        : confirmingDelete
                          ? "Confirmar eliminación"
                          : "Eliminar lámina"}
                      <span className="btn-brutal__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <p className="label-mono mb-2">LAYOUT DE LA LÁMINA</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {LAYOUT_OPTIONS.map((option) => {
                      const active =
                        activeBoard.layout_variant === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => changeLayout(option.value)}
                          disabled={layoutBusy !== null}
                          aria-pressed={active}
                          className={`btn-brutal min-h-[44px] px-3 text-xs ${
                            active ? "bg-foreground text-background" : ""
                          }`}
                        >
                          {option.label}
                          <span className="btn-brutal__arrow" aria-hidden="true">
                            ↗
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {boardMessage && (
                  <p className="type-ui border border-border bg-background p-3 text-sm">
                    {boardMessage}
                  </p>
                )}

                {editing && (
                  <form
                    onSubmit={saveBoardEdit}
                    className="flex flex-col gap-3 border border-border bg-background p-3"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="type-ui text-sm">Título *</span>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        maxLength={255}
                        className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="type-ui text-sm">
                        Nota curatorial (opcional)
                      </span>
                      <textarea
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                        maxLength={2000}
                        className="type-ui min-h-[80px] border border-border bg-background p-3 text-sm"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={updating}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        {updating ? "Guardando…" : "Guardar cambios"}
                        <span className="btn-brutal__arrow" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setBoardMessage("");
                        }}
                        className="btn-brutal min-h-[44px] px-3 text-xs"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-6 ${
                  dragActive ? "outline outline-2 outline-foreground" : ""
                }`}
              >
                <div className="flex flex-col gap-3 border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="label-mono">
                    ARRASTRA IMÁGENES AQUÍ · O PEGA CON CTRL+V
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {!loadingItems && !itemsFailed && (
                      <p className="label-mono">
                        {items.length} / {MAX_BOARD_IMAGES} IMÁGENES
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || atCap}
                      className="btn-brutal min-h-[44px] px-3 text-xs"
                    >
                      Elegir imágenes
                      <span className="btn-brutal__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      onChange={handleFileSelection}
                      className="sr-only"
                    />
                  </div>
                </div>

                {!loadingItems &&
                  !itemsFailed &&
                  items.length < RECOMMENDED_IMAGES && (
                    <p className="type-ui mt-2 text-sm">
                      Faltan {RECOMMENDED_IMAGES - items.length} imágenes para
                      completar la lámina (mínimo recomendado:{" "}
                      {RECOMMENDED_IMAGES})
                    </p>
                  )}

                {uploadMessage && (
                  <p className="type-ui mt-2 border border-border bg-surface p-3 text-sm">
                    {uploadMessage}
                  </p>
                )}

                {/* Si la carga de piezas falló, el aviso de error de arriba es
                    el estado honesto: no simular una lámina vacía. */}
                {!itemsFailed && (
                  <div className="mt-6">
                    {loadingItems && items.length === 0 ? (
                      <p className="type-ui text-sm">Cargando piezas…</p>
                    ) : (
                      <MoodboardComposition
                        layout={activeBoard.layout_variant}
                        projectId={projectId}
                        board={{
                          title: activeBoard.title,
                          curatorial_note: activeBoard.curatorial_note,
                        }}
                        items={items}
                        selectedItemId={selectedItemId}
                        onSelect={(item: MoodboardItemData) =>
                          setSelectedItemId(item.id)
                        }
                      />
                    )}

                    {!loadingItems && items.length === 0 && (
                      <p className="type-ui mt-6 text-sm">
                        Todavía no hay piezas en este moodboard.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <MoodboardCommentPanel
                projectId={projectId}
                item={selectedItem}
                currentUserId={currentUserId}
                onClose={() => setSelectedItemId(null)}
                onChanged={refreshActiveBoard}
                headerExtra={
                  selectedItem ? (
                    <MoodboardPieceDelete
                      key={selectedItem.id}
                      projectId={projectId}
                      item={selectedItem}
                      onDeleted={() => {
                        setSelectedItemId(null);
                        void refreshActiveBoard();
                      }}
                    />
                  ) : null
                }
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
