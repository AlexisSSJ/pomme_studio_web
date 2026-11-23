"""Tests for the ready-to-answer gate (`projects.brief_sent_at`)."""

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
    BriefItem,
    BriefItemImage,
    Notification,
    Project,
    User,
)
from backend.app.services.storage import (
    BRIEF_RESPONSE_CONTENT_TYPES,
    LocalStorage,
)

GATE_DETAIL = "Brief is not ready to be answered"


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _unsend(db_session: AsyncSession, project: Project) -> None:
    """Return the project to the pre-send state (the conftest project is sent)."""
    project.brief_sent_at = None
    await db_session.commit()
    await db_session.refresh(project)


def _create_question(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    prompt: str = "¿Estilo preferido?",
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/brief/questions",
        json={"prompt": prompt, "category": "interior"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload_reference(
    client: TestClient, project_id: uuid.UUID, token: str
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/brief/references",
        files={"file": ("ref.png", b"png-reference-bytes", "image/png")},
        data={"category": "interior"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _media_files(storage: LocalStorage) -> list[Path]:
    return sorted(path for path in storage.root.rglob("*") if path.is_file())


@pytest.mark.asyncio
async def test_client_sees_only_references_before_send(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Before send a CLIENT reads references only and a zeroed pending status."""
    await _unsend(db_session, active_project)
    question = _create_question(client, active_project.id, collaborator_token)
    reference = _upload_reference(client, active_project.id, collaborator_token)

    brief = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers=_auth(client_token),
    )
    assert brief.status_code == 200
    ids = {item["id"] for item in brief.json()}
    assert ids == {reference["id"]}
    assert all(item["item_type"] == "reference" for item in brief.json())

    # Team roles still see the questions.
    team_brief = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers=_auth(collaborator_token),
    )
    assert team_brief.status_code == 200
    assert {item["id"] for item in team_brief.json()} == {
        question["id"],
        reference["id"],
    }

    pending = client.get(
        f"/api/v1/projects/{active_project.id}/brief/pending",
        headers=_auth(client_token),
    )
    assert pending.status_code == 200
    data = pending.json()
    assert data["brief_sent"] is False
    assert data["has_pending_brief"] is False
    assert data["total_questions"] == 0
    assert data["answered_questions"] == 0
    assert data["pending_questions"] == 0
    assert data["items"] == []
    assert data["pending_briefs"] == []

    # Team roles still see the real counts.
    team_pending = client.get(
        f"/api/v1/projects/{active_project.id}/brief/pending",
        headers=_auth(collaborator_token),
    )
    assert team_pending.status_code == 200
    team_data = team_pending.json()
    assert team_data["brief_sent"] is False
    assert team_data["has_pending_brief"] is True
    assert team_data["total_questions"] == 1
    assert [item["id"] for item in team_data["items"]] == [question["id"]]

    # The global pending indicator skips the unsent project.
    global_pending = client.get("/api/v1/brief/pending", headers=_auth(client_token))
    assert global_pending.status_code == 200
    global_data = global_pending.json()
    assert global_data["brief_sent"] is False
    assert global_data["has_pending_brief"] is False
    assert global_data["items"] == []
    assert global_data["pending_briefs"] == []


@pytest.mark.asyncio
async def test_client_mutations_blocked_before_send(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Every client answer mutation is a 409 and leaves the question untouched."""
    await _unsend(db_session, active_project)
    question = _create_question(client, active_project.id, collaborator_token)
    item_id = question["id"]
    base = f"/api/v1/projects/{active_project.id}/brief"

    attempts = [
        client.patch(
            f"{base}/items/{item_id}",
            json={"answer": "Respuesta bloqueada."},
            headers=_auth(client_token),
        ),
        client.patch(
            f"{base}/autosave",
            json={"item_id": item_id, "answer": "Respuesta bloqueada."},
            headers=_auth(client_token),
        ),
        client.patch(
            f"{base}/autosave",
            json={"items": [{"item_id": item_id, "answer": "Respuesta bloqueada."}]},
            headers=_auth(client_token),
        ),
        client.patch(
            f"{base}/items/{item_id}/autosave",
            json={"answer": "Respuesta bloqueada."},
            headers=_auth(client_token),
        ),
        client.post(
            f"{base}/items/{item_id}/response-file",
            files={"file": ("ref.png", b"png-bytes", "image/png")},
            headers=_auth(client_token),
        ),
        client.delete(
            f"{base}/items/{item_id}/images/{uuid.uuid4()}",
            headers=_auth(client_token),
        ),
        client.delete(
            f"{base}/items/{item_id}/audio",
            headers=_auth(client_token),
        ),
        client.post(
            f"{base}/items/{item_id}/confirm",
            json={"confirmed": True},
            headers=_auth(client_token),
        ),
    ]

    for response in attempts:
        assert response.status_code == 409, response.text
        assert response.json()["detail"] == GATE_DETAIL

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(item_id))
    )
    item = result.scalar_one()
    assert item.answer is None
    assert item.status.value == "pending"
    assert item.image_storage_key is None
    assert item.audio_storage_key is None

    images_result = await db_session.execute(
        select(BriefItemImage).where(BriefItemImage.item_id == uuid.UUID(item_id))
    )
    assert images_result.scalars().all() == []
    assert _media_files(media_storage) == []


@pytest.mark.asyncio
async def test_question_media_hidden_from_client_before_send(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Question media reads are 404 for a CLIENT until the brief is sent."""
    await _unsend(db_session, active_project)
    question = _create_question(client, active_project.id, collaborator_token)
    item_id = uuid.UUID(question["id"])

    key = await media_storage.save(
        active_project.id, b"png-media-bytes", "image/png", BRIEF_RESPONSE_CONTENT_TYPES
    )
    image = BriefItemImage(
        id=uuid.uuid4(),
        item_id=item_id,
        storage_key=key,
        content_type="image/png",
        size_bytes=len(b"png-media-bytes"),
        position=1,
    )
    db_session.add(image)
    item = await db_session.get(BriefItem, item_id)
    item.image_storage_key = key
    await db_session.commit()

    base = f"/api/v1/projects/{active_project.id}/brief/items/{item_id}"

    image_media = client.get(
        f"{base}/images/{image.id}/media", headers=_auth(client_token)
    )
    assert image_media.status_code == 404
    assert image_media.json()["detail"] == "Brief item not found"

    legacy_media = client.get(f"{base}/media", headers=_auth(client_token))
    assert legacy_media.status_code == 404
    assert legacy_media.json()["detail"] == "Brief item not found"

    # Team roles can still inspect the media.
    team_media = client.get(
        f"{base}/images/{image.id}/media", headers=_auth(collaborator_token)
    )
    assert team_media.status_code == 200
    assert team_media.content == b"png-media-bytes"


@pytest.mark.asyncio
async def test_send_brief_notifies_client_and_unlocks_answers(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
    other_client_token: str,
):
    """Sending the brief notifies the client, audits, and opens the questionnaire."""
    await _unsend(db_session, active_project)
    question = _create_question(client, active_project.id, collaborator_token)
    item_id = question["id"]

    send = client.post(
        f"/api/v1/projects/{active_project.id}/brief/send",
        headers=_auth(collaborator_token),
    )
    assert send.status_code == 200, send.text
    data = send.json()
    assert data["project_id"] == str(active_project.id)
    assert data["brief_sent_at"] is not None

    await db_session.refresh(active_project)
    assert active_project.brief_sent_at is not None

    notifications_result = await db_session.execute(
        select(Notification).where(Notification.project_id == active_project.id)
    )
    notifications = notifications_result.scalars().all()
    assert len(notifications) == 1
    assert notifications[0].user_id == client_user.id
    assert notifications[0].event_type == "brief.ready"
    assert notifications[0].payload["project_id"] == str(active_project.id)

    audit_result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "brief.sent")
    )
    log = audit_result.scalar_one()
    assert log.entity_type == "project"
    assert log.entity_id == active_project.id
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)

    resent = client.post(
        f"/api/v1/projects/{active_project.id}/brief/send",
        headers=_auth(collaborator_token),
    )
    assert resent.status_code == 409
    assert resent.json()["detail"] == "Brief already sent"

    # The lost race must not notify the client a second time.
    ready_result = await db_session.execute(
        select(Notification).where(
            Notification.project_id == active_project.id,
            Notification.event_type == "brief.ready",
        )
    )
    ready_notifications = ready_result.scalars().all()
    assert len(ready_notifications) == 1
    assert ready_notifications[0].user_id == client_user.id

    forbidden = client.post(
        f"/api/v1/projects/{active_project.id}/brief/send",
        headers=_auth(other_client_token),
    )
    assert forbidden.status_code == 403

    # After the send, the client sees the question and can answer it.
    brief = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers=_auth(client_token),
    )
    assert brief.status_code == 200
    assert item_id in {item["id"] for item in brief.json()}

    answered = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
        json={"answer": "Minimalismo cálido."},
        headers=_auth(client_token),
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["answer"] == "Minimalismo cálido."

    pending = client.get(
        f"/api/v1/projects/{active_project.id}/brief/pending",
        headers=_auth(client_token),
    )
    assert pending.status_code == 200
    assert pending.json()["brief_sent"] is True
    assert pending.json()["total_questions"] == 1
    assert pending.json()["answered_questions"] == 1
    assert pending.json()["has_pending_brief"] is False


@pytest.mark.asyncio
async def test_client_pending_progress_ignores_unsent_draft(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """A draft-only CLIENT reads 0% and no pending brief, never the 100% fallback."""
    await _unsend(db_session, active_project)
    _create_question(client, active_project.id, collaborator_token)

    global_pending = client.get("/api/v1/brief/pending", headers=_auth(client_token))
    assert global_pending.status_code == 200
    data = global_pending.json()
    assert data["has_pending_brief"] is False
    assert data["progress"] == 0.0
    assert data["brief_sent"] is False
    assert data["project_id"] is None
    assert data["pending_briefs"] == []
