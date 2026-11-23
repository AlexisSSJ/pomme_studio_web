"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import {
  MoodboardComposition,
  type MoodboardItemData,
  type MoodboardLayout,
} from "@/components/MoodboardComposition";

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
  like_count: number;
  dislike_count: number;
  comment_count: number;
  my_reaction: "like" | "dislike" | "comment" | null;
  my_comment: string | null;
}

interface MoodboardReaction {
  id: string;
  moodboard_item_id: string;
  user_id: string;
  reaction: "like" | "dislike" | "comment";
  comment: string | null;
  created_at: string;
}

const MAX_BOARD_IMAGES = 10;
const RECOMMENDED_IMAGES = 6;
const MAX_REACHED_MESSAGE =
  "Este moodboard ya tiene el máximo de 10 imágenes";

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
 * Pie de pieza del back-office: eliminar en dos pasos y comentarios
 * (misma lógica que la pieza plana anterior), sin intervenir en la
 * composición visual de la lámina.
 */
function MoodboardPieceFooter({
  projectId,
  item,
  onChanged,
}: {
  projectId: string;
  item: MoodboardItemData;
  onChanged: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactions, setReactions] = useState<MoodboardReaction[] | null>(null);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionsMessage, setReactionsMessage] = useState("");

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

  async function toggleComments() {
    if (commentsOpen) {
      setCommentsOpen(false);
      return;
    }

    setCommentsOpen(true);
    setLoadingReactions(true);
    setReactionsMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/items/${item.id}/reactions`
      );
      if (res.ok) {
        setReactions(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setReactionsMessage(
          extractDetail(data, "Error al cargar los comentarios")
        );
      }
    } catch {
      setReactionsMessage("Error de conexión con el servidor");
    } finally {
      setLoadingReactions(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="label-mono">
        {item.like_count} ME GUSTA · {item.dislike_count} NO ·{" "}
        {item.comment_count} COMENTARIOS
      </p>

      <div className="flex flex-wrap gap-2">
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
              : "Eliminar"}
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        <button
          type="button"
          onClick={toggleComments}
          aria-expanded={commentsOpen}
          className="btn-brutal min-h-[44px] px-3 text-xs"
        >
          Comentarios
          <span className="btn-brutal__arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </div>

      {feedback && (
        <p className="type-ui border border-border bg-surface p-3 text-sm">
          {feedback}
        </p>
      )}

      {commentsOpen && (
        <div className="flex flex-col gap-2">
          {loadingReactions ? (
            <p className="type-ui text-sm">Cargando…</p>
          ) : reactionsMessage ? (
            <p className="type-ui border border-border bg-surface p-3 text-sm">
              {reactionsMessage}
            </p>
          ) : reactions !== null && reactions.length === 0 ? (
            <p className="type-ui text-sm">Todavía no hay reacciones.</p>
          ) : (
            reactions?.map((reaction) => (
              <div
                key={reaction.id}
                className="flex flex-col gap-1 border border-border bg-background p-3"
              >
                <p className="label-mono">
                  {reaction.reaction} ·{" "}
                  {new Date(reaction.created_at).toLocaleString("es")}
                </p>
                {reaction.comment && (
                  <p className="type-editorial text-sm">{reaction.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
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
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

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

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Descarta respuestas de una lámina ya abandonada al cambiar de pestaña.
  const itemsRequestRef = useRef(0);

  const activeBoard =
    boards.find((board) => board.id === activeBoardId) ?? null;
  const atCap = items.length >= MAX_BOARD_IMAGES;

  const loadBoards = useCallback(async () => {
    if (!projectId) return;
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
      setLoadingItems(false);
      return;
    }
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
      }
    } catch {
      if (requestId === itemsRequestRef.current) {
        setMessage("Error de conexión con el servidor");
      }
    } finally {
      if (requestId === itemsRequestRef.current) {
        setLoadingItems(false);
      }
    }
  }, [projectId, activeBoardId]);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Al cambiar de lámina se descarta cualquier edición o confirmación
  // pendiente de la anterior.
  useEffect(() => {
    setEditing(false);
    setEditTitle("");
    setEditNote("");
    setBoardMessage("");
    setConfirmingDelete(false);
    setUploadMessage("");
    setItems([]);
  }, [activeBoardId]);

  async function refreshActiveBoard() {
    await Promise.all([loadItems(), loadBoards()]);
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

  async function uploadPiece(event: FormEvent) {
    event.preventDefault();
    if (!activeBoard) return;
    if (atCap) {
      setUploadMessage(MAX_REACHED_MESSAGE);
      return;
    }

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
    setUploadMessage("Subiendo…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", trimmedTitle);
      if (description.trim()) {
        form.append("description", description.trim());
      }
      const parsedOrder = Number.parseInt(sortOrder, 10);
      form.append(
        "sort_order",
        Number.isNaN(parsedOrder) ? "0" : String(parsedOrder)
      );

      const res = await apiFetch(
        `/api/v1/projects/${projectId}/moodboard/boards/${activeBoard.id}/items`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        setUploadMessage("Pieza subida");
        setTitle("");
        setDescription("");
        setSortOrder("0");
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        await refreshActiveBoard();
      } else if (res.status === 409) {
        setUploadMessage(MAX_REACHED_MESSAGE);
        await refreshActiveBoard();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setUploadMessage(extractDetail(data, "Error al subir la pieza"));
      }
    } catch {
      setUploadMessage("Error de conexión con el servidor");
    } finally {
      setUploading(false);
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

        {createMessage && (
          <p className="type-ui text-sm">{createMessage}</p>
        )}

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
                  <div>
                    <p className="label-mono">LÁMINA ACTIVA</p>
                    <p className="label-mono mt-2">
                      {items.length} / {MAX_BOARD_IMAGES} IMÁGENES
                    </p>
                    {items.length < RECOMMENDED_IMAGES && (
                      <p className="type-ui mt-1 text-sm">
                        Faltan {RECOMMENDED_IMAGES - items.length} imágenes para
                        completar la lámina (mínimo recomendado:{" "}
                        {RECOMMENDED_IMAGES})
                      </p>
                    )}
                  </div>

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

              <div className="mt-8">
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
                    renderFooter={(item) => (
                      <MoodboardPieceFooter
                        projectId={projectId}
                        item={item}
                        onChanged={refreshActiveBoard}
                      />
                    )}
                  />
                )}

                {!loadingItems && items.length === 0 && (
                  <p className="type-ui mt-6 text-sm">
                    Todavía no hay piezas en este moodboard.
                  </p>
                )}
              </div>

              <h2 className="type-subtitle-caps mt-8 text-lg">Nueva pieza</h2>
              <form
                onSubmit={uploadPiece}
                className="mt-3 flex flex-col gap-3 border border-border bg-surface p-4 sm:p-6"
              >
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

                <label className="flex flex-col gap-1">
                  <span className="type-ui text-sm">Descripción (opcional)</span>
                  <input
                    type="text"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={1000}
                    className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="type-ui text-sm">Orden</span>
                  <input
                    type="number"
                    step={1}
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value)}
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
                    accept=".jpg,.jpeg,.png,.webp,.gif"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                    className="sr-only"
                  />
                </label>

                {atCap && (
                  <p className="type-ui text-sm">{MAX_REACHED_MESSAGE}</p>
                )}

                {uploadMessage && (
                  <p className="type-ui text-sm">{uploadMessage}</p>
                )}

                <button
                  type="submit"
                  disabled={uploading || atCap}
                  className="btn-brutal min-h-[44px] self-start px-3 text-xs"
                >
                  {uploading ? "Subiendo…" : "Subir pieza"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}
