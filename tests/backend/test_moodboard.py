"""Tests for moodboard endpoints: team uploads and board management."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.core.security import create_access_token
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    MoodboardComment,
    MoodboardItem,
    Project,
    ProjectMember,
    ProjectRole,
    User,
)
from backend.app.services.storage import LocalStorage


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_board(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    *,
    title: str = "Moodboard 01",
    curatorial_note: str | None = None,
    layout_variant: str | None = None,
):
    """Create a moodboard board with the given bearer token."""
    body: dict = {"title": title}
    if curatorial_note is not None:
        body["curatorial_note"] = curatorial_note
    if layout_variant is not None:
        body["layout_variant"] = layout_variant
    return client.post(
        f"/api/v1/projects/{project_id}/moodboard/boards",
        json=body,
        headers=auth(token),
    )


def upload_piece(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    *,
    board_id: uuid.UUID | None = None,
    title: str | None = "Paleta cálida",
    description: str | None = "Referencia de tonos tierra",
    sort_order: int = 0,
    file_name: str = "pin.png",
    payload: bytes = b"\x89PNG-fake-bytes",
    content_type: str = "image/png",
):
    """Upload a moodboard piece, creating a board first when none is given.

    ``title=None`` omits the form field so the API auto-fills it from the
    filename stem (or "Imagen N" when that is blank).
    """
    if board_id is None:
        board = create_board(client, project_id, token)
        if board.status_code != 201:
            # Surfaces the board-create guard (403/409/401) to the caller.
            return board
        board_id = uuid.UUID(board.json()["id"])

    data = {"sort_order": str(sort_order)}
    if title is not None:
        data["title"] = title
    if description is not None:
        data["description"] = description
    response = client.post(
        f"/api/v1/projects/{project_id}/moodboard/boards/{board_id}/items",
        files={"file": (file_name, payload, content_type)},
        data=data,
        headers=auth(token),
    )
    response.moodboard_id = board_id  # held so callers can target the board
    return response


@pytest.mark.asyncio
async def test_team_uploads_piece_201(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    payload = b"\x89PNG-fake-bytes"
    response = upload_piece(
        client, active_project.id, collaborator_token, payload=payload
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Paleta cálida"
    assert data["description"] == "Referencia de tonos tierra"
    assert data["file_name"] == "pin.png"
    assert data["content_type"] == "image/png"
    assert data["size_bytes"] == len(payload)
    assert data["sort_order"] == 0
    assert data["project_id"] == str(active_project.id)
    assert data["created_by"] == str(collaborator_user.id)
    assert data["comment_count"] == 0
    assert "like_count" not in data
    assert "dislike_count" not in data
    assert "my_reaction" not in data
    assert "my_comment" not in data
    assert "storage_key" not in data

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.item_create",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard_item"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)

    # The uploaded file is served back to any member of the project.
    download = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{data['id']}/file",
        headers=auth(collaborator_token),
    )
    assert download.status_code == 200
    assert download.content == payload
    assert download.headers["content-type"].split(";")[0] == "image/png"


@pytest.mark.asyncio
async def test_upload_without_title_autofills_filename_stem(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    """A title-less upload takes the file stem as its title."""
    response = upload_piece(
        client, active_project.id, collaborator_token, title=None
    )
    assert response.status_code == 201
    assert response.json()["title"] == "pin"


@pytest.mark.asyncio
async def test_upload_without_title_empty_stem_autofills_imagen_n(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    """A blank stem falls back to `Imagen {item_count + 1}`."""
    first = upload_piece(client, active_project.id, collaborator_token)
    assert first.status_code == 201

    response = upload_piece(
        client,
        active_project.id,
        collaborator_token,
        board_id=first.moodboard_id,
        title=None,
        file_name="   ",
        sort_order=1,
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Imagen 2"


@pytest.mark.asyncio
async def test_unassigned_collaborator_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_two_token: str,
):
    response = upload_piece(client, active_project.id, collaborator_two_token)
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_client_cannot_upload_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    client_token: str,
):
    response = upload_piece(client, active_project.id, client_token)
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_lead_designer_assigned_201(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    lead_designer_user: User,
    lead_designer_token: str,
):
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=lead_designer_user.id,
            assigned_role=ProjectRole.LEAD_DESIGNER,
        )
    )
    await db_session.commit()

    response = upload_piece(client, active_project.id, lead_designer_token)
    assert response.status_code == 201
    assert response.json()["title"] == "Paleta cálida"


@pytest.mark.asyncio
async def test_delete_item_removes_comments_and_file_204(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    assert piece.status_code == 201
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}"

    assert (
        client.post(
            f"{base}/comments",
            json={"comment": "Bonito."},
            headers=auth(client_token),
        ).status_code
        == 201
    )

    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.id == uuid.UUID(item_id))
    )
    item = result.scalar_one()
    stored_path = media_storage.resolve(item.storage_key)
    assert stored_path.is_file()

    response = client.delete(base, headers=auth(collaborator_token))
    assert response.status_code == 204

    # The file is gone from storage and the comments from the database.
    assert not stored_path.exists()
    result = await db_session.execute(
        select(MoodboardComment).where(
            MoodboardComment.moodboard_item_id == uuid.UUID(item_id)
        )
    )
    assert result.scalars().first() is None
    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.id == uuid.UUID(item_id))
    )
    assert result.scalar_one_or_none() is None

    # Every item-scoped route now reports the piece as missing.
    response = client.get(f"{base}/file", headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.get(f"{base}/comments", headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.item_delete",
            AuditLog.entity_id == uuid.UUID(item_id),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard_item"
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_download_missing_file_404(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    orphan = MoodboardItem(
        id=uuid.uuid4(),
        project_id=active_project.id,
        title="Pin fantasma",
        file_name="gone.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{active_project.id}/gone.png",
        created_by=collaborator_user.id,
    )
    db_session.add(orphan)
    await db_session.commit()

    response = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{orphan.id}/file",
        headers=auth(collaborator_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


@pytest.mark.asyncio
async def test_upload_pdf_to_moodboard_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    response = upload_piece(
        client,
        active_project.id,
        collaborator_token,
        file_name="plan.pdf",
        payload=b"%PDF-1.4 fake",
        content_type="application/pdf",
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unsupported file type"


@pytest.mark.asyncio
async def test_upload_oversize_413(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    response = upload_piece(
        client,
        active_project.id,
        collaborator_token,
        payload=b"x" * (10 * 1024 * 1024 + 1),
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "File exceeds the 10 MiB limit"


@pytest.mark.asyncio
async def test_write_on_draft_409(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
):
    # `active_project` mutates the shared project to ACTIVE; use a fresh DRAFT.
    draft = Project(id=uuid.uuid4(), title="Draft Project", client_id=client_user.id)
    db_session.add(draft)
    db_session.add_all(
        [
            ProjectMember(
                id=uuid.uuid4(),
                project_id=draft.id,
                user_id=client_user.id,
                assigned_role=ProjectRole.CLIENT,
            ),
            ProjectMember(
                id=uuid.uuid4(),
                project_id=draft.id,
                user_id=collaborator_user.id,
                assigned_role=ProjectRole.COLLABORATOR,
            ),
        ]
    )
    await db_session.commit()

    base = f"/api/v1/projects/{draft.id}/moodboard"

    # A board cannot be auto-created on a DRAFT project (create itself 409s),
    # so target a random board id: the team/active guards run before the lookup.
    response = upload_piece(
        client, draft.id, collaborator_token, board_id=uuid.uuid4()
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.delete(f"{base}/items/{uuid.uuid4()}", headers=auth(collaborator_token))
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    # Reads stay open to members on DRAFT projects.
    response = client.get(base, headers=auth(collaborator_token))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_inactive_user_403(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    inactive_user: User,
):
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=inactive_user.id,
            assigned_role=ProjectRole.CLIENT,
        )
    )
    await db_session.commit()
    token = create_access_token({"sub": str(inactive_user.id)})

    response = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard", headers=auth(token)
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    response = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    response = upload_piece(client, active_project.id, token)
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_unauthenticated_401(
    client: TestClient,
    active_project: Project,
):
    base = f"/api/v1/projects/{active_project.id}/moodboard"
    item_id = uuid.uuid4()

    assert client.get(base).status_code == 401

    assert client.get(f"{base}/boards").status_code == 401
    assert client.post(f"{base}/boards", json={"title": "Board"}).status_code == 401
    response = client.post(
        f"{base}/boards/{uuid.uuid4()}/items",
        files={"file": ("pin.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"title": "Pin"},
    )
    assert response.status_code == 401

    assert client.delete(f"{base}/items/{item_id}").status_code == 401
    assert client.get(f"{base}/items/{item_id}/file").status_code == 401


def _stored_files(storage: LocalStorage) -> list[Path]:
    return [path for path in storage.root.rglob("*") if path.is_file()]


@pytest.mark.asyncio
async def test_create_board_201(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    response = create_board(client, active_project.id, collaborator_token)
    assert response.status_code == 201
    data = response.json()
    assert data["project_id"] == str(active_project.id)
    assert data["title"] == "Moodboard 01"
    assert data["curatorial_note"] is None
    assert data["layout_variant"] == "editorial_collage"
    assert data["position"] == 0
    assert data["item_count"] == 0
    assert data["created_by"] == str(collaborator_user.id)
    assert uuid.UUID(data["id"])

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.board_create",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json == {
        "project_id": str(active_project.id),
        "title": "Moodboard 01",
        "layout_variant": "editorial_collage",
    }


@pytest.mark.asyncio
async def test_second_board_position_and_list_order(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    first = create_board(client, active_project.id, collaborator_token)
    second = create_board(
        client, active_project.id, collaborator_token, title="Moodboard 02"
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["position"] == 0
    assert second.json()["position"] == 1

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(collaborator_token),
    )
    assert listing.status_code == 200
    boards = listing.json()
    assert [board["title"] for board in boards] == ["Moodboard 01", "Moodboard 02"]
    assert [board["position"] for board in boards] == [0, 1]


@pytest.mark.asyncio
async def test_client_cannot_create_board_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    client_token: str,
):
    response = create_board(client, active_project.id, client_token)
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_unassigned_collaborator_create_board_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_two_token: str,
):
    response = create_board(client, active_project.id, collaborator_two_token)
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_patch_board_fields_and_layout(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = uuid.UUID(board.json()["id"])
    base = f"/api/v1/projects/{active_project.id}/moodboard/boards/{board_id}"

    response = client.patch(
        base,
        json={
            "title": "Moodboard Renombrado",
            "curatorial_note": "Una nota curatorial.",
            "layout_variant": "atelier_grid",
        },
        headers=auth(collaborator_token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Moodboard Renombrado"
    assert data["curatorial_note"] == "Una nota curatorial."
    assert data["layout_variant"] == "atelier_grid"

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(collaborator_token),
    )
    board_payload = next(b for b in listing.json() if b["id"] == str(board_id))
    assert board_payload["title"] == "Moodboard Renombrado"
    assert board_payload["curatorial_note"] == "Una nota curatorial."
    assert board_payload["layout_variant"] == "atelier_grid"

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.board_update",
            AuditLog.entity_id == board_id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard"
    assert log.metadata_json == {
        "project_id": str(active_project.id),
        "fields": ["curatorial_note", "layout_variant", "title"],
    }

    # Explicit null clears the note; an empty body is a no-op.
    response = client.patch(
        base, json={"curatorial_note": None}, headers=auth(collaborator_token)
    )
    assert response.status_code == 200
    assert response.json()["curatorial_note"] is None

    response = client.patch(base, json={}, headers=auth(collaborator_token))
    assert response.status_code == 200
    assert response.json()["title"] == "Moodboard Renombrado"
    assert response.json()["layout_variant"] == "atelier_grid"

    response = client.patch(
        base, json={"layout_variant": "bogus"}, headers=auth(collaborator_token)
    )
    assert response.status_code == 422

    response = client.patch(
        f"/api/v1/projects/{active_project.id}/moodboard/boards/{uuid.uuid4()}",
        json={"title": "Fantasma"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard not found"


@pytest.mark.asyncio
async def test_patch_board_rejects_explicit_null_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    board = create_board(
        client,
        active_project.id,
        collaborator_token,
        curatorial_note="Nota original",
    )
    board_id = board.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/boards/{board_id}"

    # NOT NULL columns reject an explicit null with a visible 422.
    for field in ("title", "position", "layout_variant"):
        response = client.patch(
            base, json={field: None}, headers=auth(collaborator_token)
        )
        assert response.status_code == 422
        assert response.json()["detail"] == f"Fields cannot be null: {field}"

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(collaborator_token),
    )
    payload = next(b for b in listing.json() if b["id"] == board_id)
    assert payload["title"] == "Moodboard 01"
    assert payload["position"] == 0
    assert payload["layout_variant"] == "editorial_collage"
    assert payload["curatorial_note"] == "Nota original"

    # The nullable note keeps its briefed explicit-null behaviour.
    response = client.patch(
        base, json={"curatorial_note": None}, headers=auth(collaborator_token)
    )
    assert response.status_code == 200
    assert response.json()["curatorial_note"] is None


@pytest.mark.asyncio
async def test_client_cannot_patch_or_delete_board_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    base = (
        f"/api/v1/projects/{active_project.id}/moodboard/boards/"
        f"{board.json()['id']}"
    )

    response = client.patch(
        base, json={"title": "No permitido"}, headers=auth(client_token)
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"

    response = client.delete(base, headers=auth(client_token))
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_upload_cap_10_then_409(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = uuid.UUID(board.json()["id"])

    for index in range(10):
        response = upload_piece(
            client,
            active_project.id,
            collaborator_token,
            board_id=board_id,
            title=f"Pieza {index}",
            sort_order=index,
        )
        assert response.status_code == 201

    files_before = len(_stored_files(media_storage))
    response = upload_piece(
        client,
        active_project.id,
        collaborator_token,
        board_id=board_id,
        title="Pieza 11",
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Moodboard already has 10 images"
    assert len(_stored_files(media_storage)) == files_before


@pytest.mark.asyncio
async def test_upload_under_6_allowed(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    # The first upload auto-creates a board; its id is held for the rest.
    first = upload_piece(
        client, active_project.id, collaborator_token, title="Pieza 0"
    )
    assert first.status_code == 201
    board_id = first.moodboard_id

    for index in range(1, 3):
        response = upload_piece(
            client,
            active_project.id,
            collaborator_token,
            board_id=board_id,
            title=f"Pieza {index}",
            sort_order=index,
        )
        assert response.status_code == 201

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(collaborator_token),
    )
    board_payload = next(b for b in listing.json() if b["id"] == str(board_id))
    assert board_payload["item_count"] == 3


@pytest.mark.asyncio
async def test_board_items_isolated(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    board_a = uuid.UUID(
        create_board(
            client, active_project.id, collaborator_token, title="Board A"
        ).json()["id"]
    )
    board_b = uuid.UUID(
        create_board(
            client, active_project.id, collaborator_token, title="Board B"
        ).json()["id"]
    )
    piece_a = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_a
    )
    piece_b = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_b
    )
    assert piece_a.status_code == 201
    assert piece_b.status_code == 201

    base = f"/api/v1/projects/{active_project.id}/moodboard"
    items_a = client.get(
        f"{base}/boards/{board_a}/items", headers=auth(collaborator_token)
    ).json()
    items_b = client.get(
        f"{base}/boards/{board_b}/items", headers=auth(collaborator_token)
    ).json()
    assert [item["id"] for item in items_a] == [piece_a.json()["id"]]
    assert [item["id"] for item in items_b] == [piece_b.json()["id"]]
    assert items_a[0]["moodboard_id"] == str(board_a)
    assert items_b[0]["moodboard_id"] == str(board_b)

    flat = client.get(base, headers=auth(collaborator_token)).json()
    assert {item["id"] for item in flat} == {
        piece_a.json()["id"],
        piece_b.json()["id"],
    }
    assert {item["moodboard_id"] for item in flat} == {str(board_a), str(board_b)}


@pytest.mark.asyncio
async def test_delete_board_cascades(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board_a = uuid.UUID(
        create_board(
            client, active_project.id, collaborator_token, title="Board A"
        ).json()["id"]
    )
    board_b = uuid.UUID(
        create_board(
            client, active_project.id, collaborator_token, title="Board B"
        ).json()["id"]
    )
    piece_a = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_a
    )
    piece_b = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_b
    )
    item_a_id = uuid.UUID(piece_a.json()["id"])

    comment = client.post(
        f"/api/v1/projects/{active_project.id}/moodboard/items/"
        f"{item_a_id}/comments",
        json={"comment": "Bonito."},
        headers=auth(client_token),
    )
    assert comment.status_code == 201

    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.id == item_a_id)
    )
    item_a = result.scalar_one()
    stored_a = media_storage.resolve(item_a.storage_key)
    result = await db_session.execute(
        select(MoodboardItem).where(
            MoodboardItem.id == uuid.UUID(piece_b.json()["id"])
        )
    )
    item_b = result.scalar_one()
    stored_b = media_storage.resolve(item_b.storage_key)
    assert stored_a.is_file()
    assert stored_b.is_file()

    response = client.delete(
        f"/api/v1/projects/{active_project.id}/moodboard/boards/{board_a}",
        headers=auth(collaborator_token),
    )
    assert response.status_code == 204

    assert not stored_a.exists()
    assert stored_b.is_file()

    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.moodboard_id == board_a)
    )
    assert result.scalars().all() == []
    result = await db_session.execute(
        select(func.count())
        .select_from(MoodboardComment)
        .where(MoodboardComment.moodboard_item_id == item_a_id)
    )
    assert result.scalar_one() == 0
    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.moodboard_id == board_b)
    )
    assert len(result.scalars().all()) == 1

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        headers=auth(collaborator_token),
    )
    assert [board["id"] for board in listing.json()] == [str(board_b)]

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.board_delete",
            AuditLog.entity_id == board_a,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard"
    assert log.metadata_json == {
        "project_id": str(active_project.id),
        "item_count": 1,
    }


@pytest.mark.asyncio
async def test_board_routes_on_draft_409(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
):
    draft = Project(id=uuid.uuid4(), title="Draft Board Project", client_id=client_user.id)
    db_session.add(draft)
    db_session.add_all(
        [
            ProjectMember(
                id=uuid.uuid4(),
                project_id=draft.id,
                user_id=client_user.id,
                assigned_role=ProjectRole.CLIENT,
            ),
            ProjectMember(
                id=uuid.uuid4(),
                project_id=draft.id,
                user_id=collaborator_user.id,
                assigned_role=ProjectRole.COLLABORATOR,
            ),
        ]
    )
    await db_session.commit()

    base = f"/api/v1/projects/{draft.id}/moodboard"
    board_id = uuid.uuid4()

    response = create_board(client, draft.id, collaborator_token)
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.patch(
        f"{base}/boards/{board_id}",
        json={"title": "No activo"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.delete(f"{base}/boards/{board_id}", headers=auth(collaborator_token))
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = upload_piece(
        client, draft.id, collaborator_token, board_id=board_id
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    # Reads stay open to members on DRAFT projects.
    response = client.get(f"{base}/boards", headers=auth(collaborator_token))
    assert response.status_code == 200
    assert response.json() == []
