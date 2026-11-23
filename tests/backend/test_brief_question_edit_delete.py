"""Tests for editing and deleting brief questions (studio team only)."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    BriefCategory,
    BriefItem,
    BriefItemImage,
    BriefItemType,
    Project,
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_question(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    prompt: str = "¿Estilo preferido?",
    category: str = "interior",
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/brief/questions",
        json={"prompt": prompt, "category": category},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _media_files(storage: LocalStorage) -> list[Path]:
    return sorted(path for path in storage.root.rglob("*") if path.is_file())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "token_fixture,user_fixture",
    [
        ("super_admin_token", "super_admin_user"),
        ("lead_designer_token", "lead_designer_user"),
        ("collaborator_token", "collaborator_user"),
    ],
)
async def test_team_can_edit_question_prompt_and_category(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    super_admin_token: str,
    lead_designer_token: str,
    super_admin_user: User,
    lead_designer_user: User,
    collaborator_user: User,
    token_fixture: str,
    user_fixture: str,
):
    """SUPER_ADMIN, the lead designer and collaborator members can edit a question."""
    if token_fixture == "lead_designer_token":
        active_project.lead_designer_id = lead_designer_user.id
        await db_session.commit()

    tokens = {
        "super_admin_token": super_admin_token,
        "lead_designer_token": lead_designer_token,
        "collaborator_token": collaborator_token,
    }
    users = {
        "super_admin_user": super_admin_user,
        "lead_designer_user": lead_designer_user,
        "collaborator_user": collaborator_user,
    }
    token = tokens[token_fixture]
    actor = users[user_fixture]
    question = _create_question(client, active_project.id, collaborator_token)
    url = (
        f"/api/v1/projects/{active_project.id}/brief/questions/{question['id']}"
    )

    response = client.patch(
        url,
        json={"prompt": "¿Nueva pregunta?", "category": "branding"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["prompt"] == "¿Nueva pregunta?"
    assert data["category"] == "branding"

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(question["id"]))
    )
    stored = result.scalar_one()
    assert stored.prompt == "¿Nueva pregunta?"
    assert stored.category == BriefCategory.BRANDING

    log_result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.question_update",
            AuditLog.entity_id == stored.id,
        )
    )
    log = log_result.scalar_one()
    assert log.entity_type == "brief_item"
    assert log.actor_user_id == actor.id
    assert log.metadata_json["project_id"] == str(active_project.id)

    # Partial update: only the category changes, the prompt is preserved.
    partial = client.patch(url, json={"category": "general"}, headers=_auth(token))
    assert partial.status_code == 200, partial.text
    assert partial.json()["prompt"] == "¿Nueva pregunta?"
    assert partial.json()["category"] == "general"


@pytest.mark.asyncio
async def test_edit_question_requires_at_least_one_field_422(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    """Both fields null, an empty body, an empty prompt or extra keys are rejected."""
    question = _create_question(client, active_project.id, collaborator_token)
    url = (
        f"/api/v1/projects/{active_project.id}/brief/questions/{question['id']}"
    )

    for body in (
        {"prompt": None, "category": None},
        {},
        {"prompt": ""},
        {"prompt": "¿Válida?", "unexpected": "field"},
    ):
        response = client.patch(url, json=body, headers=_auth(collaborator_token))
        assert response.status_code == 422, body


@pytest.mark.asyncio
async def test_client_member_cannot_edit_question_403(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    question = _create_question(client, active_project.id, collaborator_token)
    url = (
        f"/api/v1/projects/{active_project.id}/brief/questions/{question['id']}"
    )

    response = client.patch(
        url,
        json={"prompt": "¿Pregunta del cliente?", "category": "general"},
        headers=_auth(client_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_non_member_team_cannot_edit_question_403(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    collaborator_two_token: str,
):
    question = _create_question(client, active_project.id, collaborator_token)
    url = (
        f"/api/v1/projects/{active_project.id}/brief/questions/{question['id']}"
    )

    response = client.patch(
        url,
        json={"prompt": "¿Pregunta sin asignación?", "category": "general"},
        headers=_auth(collaborator_two_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_edit_unknown_and_cross_project_item_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    collaborator_token: str,
):
    foreign = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="¿Pregunta ajena?",
        created_by=other_client_user.id,
    )
    db_session.add(foreign)
    await db_session.commit()

    base = f"/api/v1/projects/{active_project.id}/brief/questions"

    for item_id in (uuid.uuid4(), foreign.id):
        response = client.patch(
            f"{base}/{item_id}",
            json={"prompt": "¿Intrusa?", "category": "general"},
            headers=_auth(collaborator_token),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Brief item not found"

    await db_session.refresh(foreign)
    assert foreign.prompt == "¿Pregunta ajena?"


@pytest.mark.asyncio
async def test_delete_unanswered_question_204_and_audit(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    question = _create_question(client, active_project.id, collaborator_token)
    url = (
        f"/api/v1/projects/{active_project.id}/brief/questions/{question['id']}"
    )

    response = client.delete(url, headers=_auth(collaborator_token))
    assert response.status_code == 204
    assert response.content == b""

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(question["id"]))
    )
    assert result.scalar_one_or_none() is None

    log_result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.question_delete",
            AuditLog.entity_id == uuid.UUID(question["id"]),
        )
    )
    log = log_result.scalar_one()
    assert log.entity_type == "brief_item"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_delete_answered_question_requires_force_and_removes_files(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """An answered question is protected until `force=true`, then media is purged."""
    question = _create_question(client, active_project.id, collaborator_token)
    item_id = question["id"]

    image_upload = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("ref.png", b"png-bytes", "image/png")},
        headers=_auth(client_token),
    )
    assert image_upload.status_code == 200, image_upload.text
    audio_upload = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("note.mp3", b"voice-note-bytes", "audio/mpeg")},
        data={"transcription": "Nota de voz."},
        headers=_auth(client_token),
    )
    assert audio_upload.status_code == 200, audio_upload.text
    assert len(_media_files(media_storage)) == 2

    url = f"/api/v1/projects/{active_project.id}/brief/questions/{item_id}"

    blocked = client.delete(url, headers=_auth(collaborator_token))
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Question has responses; use force=true to delete"

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(item_id))
    )
    assert result.scalar_one_or_none() is not None
    images_result = await db_session.execute(
        select(BriefItemImage).where(BriefItemImage.item_id == uuid.UUID(item_id))
    )
    assert len(images_result.scalars().all()) == 1
    assert len(_media_files(media_storage)) == 2

    forced = client.delete(f"{url}?force=true", headers=_auth(collaborator_token))
    assert forced.status_code == 204

    item_result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(item_id))
    )
    assert item_result.scalar_one_or_none() is None
    images_result = await db_session.execute(
        select(BriefItemImage).where(BriefItemImage.item_id == uuid.UUID(item_id))
    )
    assert images_result.scalars().all() == []
    assert _media_files(media_storage) == []

    log_result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.question_delete",
            AuditLog.entity_id == uuid.UUID(item_id),
        )
    )
    log = log_result.scalar_one()
    assert log.metadata_json["forced"] is True


@pytest.mark.asyncio
async def test_edit_and_delete_question_on_inactive_project_409(
    client: TestClient,
    db_session: AsyncSession,
    test_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    """Team mutations on a non-active project are rejected (the project is a draft)."""
    item = BriefItem(
        id=uuid.uuid4(),
        project_id=test_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="¿Pregunta en borrador?",
        created_by=collaborator_user.id,
    )
    db_session.add(item)
    await db_session.commit()

    url = f"/api/v1/projects/{test_project.id}/brief/questions/{item.id}"

    edited = client.patch(
        url,
        json={"prompt": "¿Editada?", "category": "general"},
        headers=_auth(collaborator_token),
    )
    assert edited.status_code == 409
    assert edited.json()["detail"] == "Project is not active"

    deleted = client.delete(url, headers=_auth(collaborator_token))
    assert deleted.status_code == 409
    assert deleted.json()["detail"] == "Project is not active"

    await db_session.refresh(item)
    assert item.prompt == "¿Pregunta en borrador?"
