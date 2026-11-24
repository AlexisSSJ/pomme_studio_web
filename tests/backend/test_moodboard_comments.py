"""Tests for Notion-style moodboard comments (any project member)."""

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.core.security import create_access_token, get_password_hash
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    MoodboardComment,
    MoodboardItem,
    Project,
    ProjectMember,
    ProjectRole,
    User,
    UserRole,
)
from backend.app.services.storage import LocalStorage
from tests.backend.test_moodboard import auth, create_board, upload_piece


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def comments_base(project_id: uuid.UUID, item_id: uuid.UUID | str) -> str:
    """URL of an item's comment thread."""
    return f"/api/v1/projects/{project_id}/moodboard/items/{item_id}/comments"


def add_comment(
    client: TestClient,
    project_id: uuid.UUID,
    item_id: uuid.UUID | str,
    token: str,
    text: str = "Me encanta esta paleta",
):
    """Post one comment on a piece with the given bearer token."""
    return client.post(
        comments_base(project_id, item_id),
        json={"comment": text},
        headers=auth(token),
    )


def _moodboard_base(project_id: uuid.UUID) -> str:
    """URL of a project's moodboard item lists."""
    return f"/api/v1/projects/{project_id}/moodboard"


def _items_by_id(client: TestClient, url: str, token: str) -> dict[str, dict]:
    """GET an item list and index its payload by item id."""
    response = client.get(url, headers=auth(token))
    assert response.status_code == 200
    return {item["id"]: item for item in response.json()}


async def _comment_rows(
    db_session: AsyncSession, item_id: uuid.UUID
) -> list[MoodboardComment]:
    result = await db_session.execute(
        select(MoodboardComment)
        .where(MoodboardComment.moodboard_item_id == item_id)
        .order_by(MoodboardComment.created_at.asc())
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
async def test_any_member_can_comment_201(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
    client_user: User,
    client_token: str,
    lead_designer_user: User,
    lead_designer_token: str,
    super_admin_user: User,
    super_admin_token: str,
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

    piece = upload_piece(client, active_project.id, collaborator_token)
    assert piece.status_code == 201
    item_id = piece.json()["id"]

    callers = (
        (collaborator_token, collaborator_user.id),
        (client_token, client_user.id),
        (lead_designer_token, lead_designer_user.id),
        (super_admin_token, super_admin_user.id),
    )
    created: list[tuple[uuid.UUID, uuid.UUID]] = []
    for token, user_id in callers:
        response = add_comment(
            client, active_project.id, item_id, token, f"Nota de {user_id}"
        )
        assert response.status_code == 201
        data = response.json()
        assert data["moodboard_item_id"] == item_id
        assert data["user_id"] == str(user_id)
        assert data["comment"] == f"Nota de {user_id}"
        created.append((uuid.UUID(data["id"]), user_id))

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "moodboard.comment_create")
    )
    logs = list(result.scalars().all())
    assert len(logs) == len(callers)
    by_entity = {log.entity_id: log for log in logs}
    for comment_id, user_id in created:
        log = by_entity[comment_id]
        assert log.entity_type == "moodboard_comment"
        assert log.actor_user_id == user_id
        assert log.metadata_json == {"project_id": str(active_project.id)}


@pytest.mark.asyncio
async def test_thread_multiple_comments_same_user_ordered(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_user: User,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]

    first = add_comment(client, active_project.id, item_id, client_token, "Primero")
    second = add_comment(client, active_project.id, item_id, client_token, "Segundo")
    assert first.status_code == 201
    assert second.status_code == 201

    # Force a clear time gap so the ASC ordering is deterministic.
    first_row = await db_session.get(MoodboardComment, uuid.UUID(first.json()["id"]))
    first_row.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await db_session.commit()

    listing = client.get(
        comments_base(active_project.id, item_id), headers=auth(client_token)
    )
    assert listing.status_code == 200
    assert [entry["id"] for entry in listing.json()] == [
        first.json()["id"],
        second.json()["id"],
    ]

    rows = await _comment_rows(db_session, uuid.UUID(item_id))
    assert len(rows) == 2
    assert {row.user_id for row in rows} == {client_user.id}


@pytest.mark.asyncio
async def test_blank_comment_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]

    response = client.post(
        comments_base(active_project.id, item_id),
        json={"comment": "   "},
        headers=auth(client_token),
    )
    assert response.status_code == 422
    assert "Comment text is required" in response.json()["detail"][0]["msg"]

    response = client.post(
        comments_base(active_project.id, item_id),
        json={"comment": ""},
        headers=auth(client_token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_comment_over_2000_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]

    response = client.post(
        comments_base(active_project.id, item_id),
        json={"comment": "x" * 2001},
        headers=auth(client_token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_nonmember_comment_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    collaborator_two_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    response = add_comment(
        client, active_project.id, piece.json()["id"], collaborator_two_token
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_unauthenticated_comment_401(
    client: TestClient,
    active_project: Project,
):
    base = comments_base(active_project.id, uuid.uuid4())
    assert client.post(base, json={"comment": "Hola"}).status_code == 401
    assert client.get(base).status_code == 401
    assert client.delete(f"{base}/{uuid.uuid4()}").status_code == 401


@pytest.mark.asyncio
async def test_inactive_user_comment_403(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
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

    piece = upload_piece(client, active_project.id, collaborator_token)
    response = add_comment(
        client, active_project.id, piece.json()["id"], token, "No permitido"
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_comment_on_draft_409(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    draft = Project(id=uuid.uuid4(), title="Draft Comments", client_id=client_user.id)
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
    item = MoodboardItem(
        id=uuid.uuid4(),
        project_id=draft.id,
        title="Pieza en borrador",
        file_name="pin.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{draft.id}/pin.png",
        created_by=collaborator_user.id,
    )
    db_session.add(item)
    await db_session.commit()

    response = add_comment(client, draft.id, item.id, client_token)
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    # Reads stay open to members on DRAFT projects.
    listing = client.get(
        comments_base(draft.id, item.id), headers=auth(collaborator_token)
    )
    assert listing.status_code == 200
    assert listing.json() == []


@pytest.mark.asyncio
async def test_comment_on_unknown_item_404(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    client_token: str,
):
    item_id = uuid.uuid4()

    response = add_comment(client, active_project.id, item_id, client_token)
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.get(
        comments_base(active_project.id, item_id), headers=auth(client_token)
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{uuid.uuid4()}",
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"


@pytest.mark.asyncio
async def test_delete_own_comment_204_then_404(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_user: User,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    created = add_comment(client, active_project.id, item_id, client_token)
    assert created.status_code == 201
    comment_id = uuid.UUID(created.json()["id"])

    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{comment_id}",
        headers=auth(client_token),
    )
    assert response.status_code == 204

    assert await db_session.get(MoodboardComment, comment_id) is None

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "moodboard.comment_delete",
            AuditLog.entity_id == comment_id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "moodboard_comment"
    assert log.actor_user_id == client_user.id
    assert log.metadata_json == {"project_id": str(active_project.id)}

    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{comment_id}",
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Comment not found"


@pytest.mark.asyncio
async def test_cannot_delete_others_comment_404(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_user: User,
    client_token: str,
    other_client_user: User,
    other_client_token: str,
):
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=other_client_user.id,
            assigned_role=ProjectRole.CLIENT,
        )
    )
    await db_session.commit()

    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    other_piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=piece.moodboard_id
    )
    created = add_comment(client, active_project.id, item_id, client_token)
    assert created.status_code == 201
    comment_id = uuid.UUID(created.json()["id"])

    # Another member cannot delete it on the same item...
    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{comment_id}",
        headers=auth(other_client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Comment not found"
    assert await db_session.get(MoodboardComment, comment_id) is not None

    # ...nor can the author reach it through a different item's path.
    response = client.delete(
        f"{comments_base(active_project.id, other_piece.json()['id'])}/{comment_id}",
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Comment not found"
    assert await db_session.get(MoodboardComment, comment_id) is not None


@pytest.mark.asyncio
async def test_super_admin_deletes_any_comment_204(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    super_admin_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    created = add_comment(client, active_project.id, item_id, client_token)
    assert created.status_code == 201
    comment_id = uuid.UUID(created.json()["id"])

    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{comment_id}",
        headers=auth(super_admin_token),
    )
    assert response.status_code == 204
    assert await db_session.get(MoodboardComment, comment_id) is None


@pytest.mark.asyncio
async def test_author_name_in_read(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_user: User,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    created = add_comment(
        client, active_project.id, item_id, client_token, "  Me encanta  "
    )
    assert created.status_code == 201

    listing = client.get(
        comments_base(active_project.id, item_id), headers=auth(collaborator_token)
    )
    assert listing.status_code == 200
    entries = listing.json()
    assert len(entries) == 1
    entry = entries[0]
    assert set(entry) == {
        "id",
        "moodboard_item_id",
        "user_id",
        "author_name",
        "comment",
        "created_at",
    }
    assert entry["author_name"] == client_user.full_name
    assert entry["comment"] == "Me encanta"
    assert entry["user_id"] == str(client_user.id)
    assert entry["moodboard_item_id"] == item_id


@pytest.mark.asyncio
async def test_nameless_user_comment_uses_email_as_author_name(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    nameless = User(
        id=uuid.uuid4(),
        email="nameless@example.com",
        hashed_password=get_password_hash("nameless123"),
        full_name=None,
        role=UserRole.CLIENT,
        is_active=True,
    )
    db_session.add(nameless)
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=nameless.id,
            assigned_role=ProjectRole.CLIENT,
        )
    )
    await db_session.commit()
    token = create_access_token({"sub": str(nameless.id)})

    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]

    response = add_comment(
        client, active_project.id, item_id, token, "Comentario sin nombre"
    )
    assert response.status_code == 201
    assert response.json()["author_name"] == nameless.email
    assert response.json()["comment"] == "Comentario sin nombre"

    # The successful 201 committed exactly one row (no duplicate on retry).
    result = await db_session.execute(
        select(MoodboardComment).where(
            MoodboardComment.moodboard_item_id == uuid.UUID(item_id),
            MoodboardComment.user_id == nameless.id,
        )
    )
    assert len(result.scalars().all()) == 1

    listing = client.get(
        comments_base(active_project.id, item_id), headers=auth(collaborator_token)
    )
    assert listing.status_code == 200
    entries = listing.json()
    assert len(entries) == 1
    assert entries[0]["author_name"] == nameless.email


@pytest.mark.asyncio
async def test_comment_count_in_item_lists(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = board.json()["id"]
    piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id
    )
    other_piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id, sort_order=1
    )
    item_id = piece.json()["id"]

    for text in ("Uno", "Dos"):
        created = add_comment(
            client, active_project.id, item_id, client_token, text
        )
        assert created.status_code == 201

    base = f"/api/v1/projects/{active_project.id}/moodboard"
    flat = client.get(base, headers=auth(client_token))
    assert flat.status_code == 200
    by_id = {item["id"]: item for item in flat.json()}
    assert by_id[item_id]["comment_count"] == 2
    assert by_id[other_piece.json()["id"]]["comment_count"] == 0

    board_items = client.get(f"{base}/boards/{board_id}/items", headers=auth(client_token))
    assert board_items.status_code == 200
    by_id = {item["id"]: item for item in board_items.json()}
    assert by_id[item_id]["comment_count"] == 2
    assert by_id[other_piece.json()["id"]]["comment_count"] == 0

    for item in by_id.values():
        for removed in ("like_count", "dislike_count", "my_reaction", "my_comment"):
            assert removed not in item


@pytest.mark.asyncio
async def test_delete_item_cascades_comments(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = uuid.UUID(piece.json()["id"])
    for text in ("Uno", "Dos"):
        created = add_comment(
            client, active_project.id, item_id, client_token, text
        )
        assert created.status_code == 201
    assert len(await _comment_rows(db_session, item_id)) == 2

    response = client.delete(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}",
        headers=auth(collaborator_token),
    )
    assert response.status_code == 204

    result = await db_session.execute(
        select(func.count())
        .select_from(MoodboardComment)
        .where(MoodboardComment.moodboard_item_id == item_id)
    )
    assert result.scalar_one() == 0


@pytest.mark.asyncio
async def test_delete_board_cascades_comments(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token, title="Board A")
    board_id = uuid.UUID(board.json()["id"])
    piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id
    )
    assert piece.status_code == 201
    item_id = uuid.UUID(piece.json()["id"])
    assert add_comment(client, active_project.id, item_id, client_token).status_code == 201

    response = client.delete(
        f"/api/v1/projects/{active_project.id}/moodboard/boards/{board_id}",
        headers=auth(collaborator_token),
    )
    assert response.status_code == 204

    result = await db_session.execute(
        select(func.count())
        .select_from(MoodboardComment)
        .where(MoodboardComment.moodboard_item_id == item_id)
    )
    assert result.scalar_one() == 0


@pytest.mark.asyncio
async def test_latest_comment_in_item_lists(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = board.json()["id"]
    piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id
    )
    other_piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id, sort_order=1
    )
    item_id = piece.json()["id"]

    older = add_comment(
        client, active_project.id, item_id, client_token, "Primera nota"
    )
    newer = add_comment(
        client, active_project.id, item_id, client_token, "Segunda nota"
    )
    assert older.status_code == 201
    assert newer.status_code == 201

    # Force a clear time gap so "most recent" is deterministic.
    older_row = await db_session.get(MoodboardComment, uuid.UUID(older.json()["id"]))
    older_row.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await db_session.commit()

    base = _moodboard_base(active_project.id)
    by_id = _items_by_id(client, base, client_token)
    assert by_id[item_id]["latest_comment"] == "Segunda nota"
    assert by_id[other_piece.json()["id"]]["latest_comment"] is None

    by_id = _items_by_id(client, f"{base}/boards/{board_id}/items", client_token)
    assert by_id[item_id]["latest_comment"] == "Segunda nota"
    assert by_id[other_piece.json()["id"]]["latest_comment"] is None


@pytest.mark.asyncio
async def test_latest_comment_none_without_comments(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = board.json()["id"]
    piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id
    )
    item_id = piece.json()["id"]

    base = _moodboard_base(active_project.id)
    flat = client.get(base, headers=auth(client_token))
    assert flat.status_code == 200
    assert {item["id"]: item for item in flat.json()}[item_id]["latest_comment"] is None

    board_items = client.get(
        f"{base}/boards/{board_id}/items", headers=auth(client_token)
    )
    assert board_items.status_code == 200
    assert (
        {item["id"]: item for item in board_items.json()}[item_id]["latest_comment"]
        is None
    )


@pytest.mark.asyncio
async def test_latest_comment_updates_after_delete_of_latest(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    board = create_board(client, active_project.id, collaborator_token)
    board_id = board.json()["id"]
    piece = upload_piece(
        client, active_project.id, collaborator_token, board_id=board_id
    )
    item_id = piece.json()["id"]

    older = add_comment(client, active_project.id, item_id, client_token, "Antigua")
    newer = add_comment(client, active_project.id, item_id, client_token, "Reciente")
    assert older.status_code == 201
    assert newer.status_code == 201

    older_row = await db_session.get(MoodboardComment, uuid.UUID(older.json()["id"]))
    older_row.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await db_session.commit()

    base = _moodboard_base(active_project.id)
    assert (
        _items_by_id(client, base, client_token)[item_id]["latest_comment"]
        == "Reciente"
    )

    response = client.delete(
        f"{comments_base(active_project.id, item_id)}/{newer.json()['id']}",
        headers=auth(client_token),
    )
    assert response.status_code == 204

    by_id = _items_by_id(client, base, client_token)
    assert by_id[item_id]["latest_comment"] == "Antigua"
    assert by_id[item_id]["comment_count"] == 1
