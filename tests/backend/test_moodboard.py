"""Tests for moodboard endpoints: team uploads and client reactions."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.core.security import create_access_token
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    MoodboardItem,
    MoodboardReaction,
    Project,
    ProjectMember,
    ProjectRole,
    ReactionType,
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


def upload_piece(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    *,
    title: str = "Paleta cálida",
    description: str | None = "Referencia de tonos tierra",
    sort_order: int = 0,
    file_name: str = "pin.png",
    payload: bytes = b"\x89PNG-fake-bytes",
    content_type: str = "image/png",
):
    """Upload a moodboard piece with the given bearer token."""
    data = {"title": title, "sort_order": str(sort_order)}
    if description is not None:
        data["description"] = description
    return client.post(
        f"/api/v1/projects/{project_id}/moodboard",
        files={"file": (file_name, payload, content_type)},
        data=data,
        headers=auth(token),
    )


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
    assert data["like_count"] == 0
    assert data["dislike_count"] == 0
    assert data["comment_count"] == 0
    assert data["my_reaction"] is None
    assert data["my_comment"] is None
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
async def test_client_like_201_then_dislike_200_replaces(
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
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    like = client.post(base, json={"reaction": "like"}, headers=auth(client_token))
    assert like.status_code == 201
    assert like.json()["reaction"] == "like"

    dislike = client.post(base, json={"reaction": "dislike"}, headers=auth(client_token))
    assert dislike.status_code == 200
    assert dislike.json()["reaction"] == "dislike"

    # One row per (item, user): the dislike replaced the like.
    result = await db_session.execute(
        select(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id == uuid.UUID(item_id)
        )
    )
    reactions = result.scalars().all()
    assert len(reactions) == 1
    assert reactions[0].reaction == ReactionType.DISLIKE

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    board = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard",
        headers=auth(client_token),
    )
    assert board.status_code == 200
    items = board.json()
    assert len(items) == 1
    assert items[0]["like_count"] == 0
    assert items[0]["dislike_count"] == 1
    assert items[0]["my_reaction"] == "dislike"


@pytest.mark.asyncio
async def test_comment_requires_text_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    response = client.post(base, json={"reaction": "comment"}, headers=auth(client_token))
    assert response.status_code == 422
    assert "Comment text is required" in response.json()["detail"][0]["msg"]

    response = client.post(
        base, json={"reaction": "comment", "comment": "   "}, headers=auth(client_token)
    )
    assert response.status_code == 422
    assert "Comment text is required" in response.json()["detail"][0]["msg"]


@pytest.mark.asyncio
async def test_comment_with_text_201(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    response = client.post(
        base,
        json={"reaction": "comment", "comment": "  Me encanta esta paleta  "},
        headers=auth(client_token),
    )
    assert response.status_code == 201
    data = response.json()
    assert data["reaction"] == "comment"
    assert data["comment"] == "Me encanta esta paleta"

    board = client.get(
        f"/api/v1/projects/{active_project.id}/moodboard",
        headers=auth(client_token),
    )
    items = board.json()
    assert items[0]["comment_count"] == 1
    assert items[0]["my_reaction"] == "comment"
    assert items[0]["my_comment"] == "Me encanta esta paleta"


@pytest.mark.asyncio
async def test_like_with_comment_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    response = client.post(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions",
        json={"reaction": "like", "comment": "nice"},
        headers=auth(client_token),
    )
    assert response.status_code == 422
    assert "Comment only allowed with COMMENT reaction" in response.json()["detail"][0]["msg"]


@pytest.mark.asyncio
async def test_delete_own_reaction_204_then_404(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    react = client.post(base, json={"reaction": "like"}, headers=auth(client_token))
    assert react.status_code == 201

    response = client.delete(base, headers=auth(client_token))
    assert response.status_code == 204

    response = client.delete(base, headers=auth(client_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Reaction not found"


@pytest.mark.asyncio
async def test_team_cannot_react_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    lead_designer_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    for token in (collaborator_token, lead_designer_token):
        response = client.post(base, json={"reaction": "like"}, headers=auth(token))
        assert response.status_code == 403
        assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_nonmember_client_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    other_client_token: str,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    response = client.post(
        f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions",
        json={"reaction": "like"},
        headers=auth(other_client_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_list_counts_and_my_reaction(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    other_client_user: User,
    other_client_token: str,
):
    # A second CLIENT member reacts differently on the same piece.
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
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    first = client.post(base, json={"reaction": "like"}, headers=auth(client_token))
    assert first.status_code == 201
    second = client.post(base, json={"reaction": "dislike"}, headers=auth(other_client_token))
    assert second.status_code == 201

    for token, expected in ((client_token, "like"), (other_client_token, "dislike")):
        board = client.get(
            f"/api/v1/projects/{active_project.id}/moodboard",
            headers=auth(token),
        )
        assert board.status_code == 200
        items = board.json()
        assert len(items) == 1
        assert items[0]["like_count"] == 1
        assert items[0]["dislike_count"] == 1
        assert items[0]["comment_count"] == 0
        assert items[0]["my_reaction"] == expected


@pytest.mark.asyncio
async def test_team_sees_client_comments(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    client_user: User,
):
    piece = upload_piece(client, active_project.id, collaborator_token)
    item_id = piece.json()["id"]
    base = f"/api/v1/projects/{active_project.id}/moodboard/items/{item_id}/reactions"

    response = client.post(
        base,
        json={"reaction": "comment", "comment": "Prefiero tonos más fríos."},
        headers=auth(client_token),
    )
    assert response.status_code == 201

    listing = client.get(base, headers=auth(collaborator_token))
    assert listing.status_code == 200
    reactions = listing.json()
    assert len(reactions) == 1
    assert reactions[0]["reaction"] == "comment"
    assert reactions[0]["comment"] == "Prefiero tonos más fríos."
    assert reactions[0]["user_id"] == str(client_user.id)
    assert reactions[0]["moodboard_item_id"] == item_id


@pytest.mark.asyncio
async def test_delete_item_removes_reactions_and_file_204(
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
        client.post(f"{base}/reactions", json={"reaction": "like"}, headers=auth(client_token)).status_code
        == 201
    )
    assert (
        client.post(
            f"{base}/reactions",
            json={"reaction": "comment", "comment": "Bonito."},
            headers=auth(client_token),
        ).status_code
        == 200
    )

    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.id == uuid.UUID(item_id))
    )
    item = result.scalar_one()
    stored_path = media_storage.resolve(item.storage_key)
    assert stored_path.is_file()

    response = client.delete(base, headers=auth(collaborator_token))
    assert response.status_code == 204

    # The file is gone from storage and the reactions from the database.
    assert not stored_path.exists()
    result = await db_session.execute(
        select(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id == uuid.UUID(item_id)
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

    response = client.get(f"{base}/reactions", headers=auth(collaborator_token))
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
    client_token: str,
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

    response = upload_piece(client, draft.id, collaborator_token)
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.delete(f"{base}/items/{uuid.uuid4()}", headers=auth(collaborator_token))
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    item_id = uuid.uuid4()
    response = client.post(
        f"{base}/items/{item_id}/reactions",
        json={"reaction": "like"},
        headers=auth(client_token),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.delete(f"{base}/items/{item_id}/reactions", headers=auth(client_token))
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

    response = client.post(
        base,
        files={"file": ("pin.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"title": "Pin"},
    )
    assert response.status_code == 401

    assert client.delete(f"{base}/items/{item_id}").status_code == 401
    assert client.get(f"{base}/items/{item_id}/file").status_code == 401
    assert (
        client.post(f"{base}/items/{item_id}/reactions", json={"reaction": "like"}).status_code
        == 401
    )
    assert client.delete(f"{base}/items/{item_id}/reactions").status_code == 401
    assert client.get(f"{base}/items/{item_id}/reactions").status_code == 401
