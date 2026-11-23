"""Tests for team notifications emitted when a client completes the brief."""

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
    Notification,
    Project,
    ProjectMember,
    ProjectRole,
    User,
)
from backend.app.services.storage import LocalStorage

NOTIFICATIONS_URL = "/api/v1/notifications"


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_questions(
    client: TestClient, project_id: uuid.UUID, token: str, count: int
) -> list[str]:
    """Create `count` brief questions as a studio team member."""
    ids: list[str] = []
    for index in range(count):
        response = client.post(
            f"/api/v1/projects/{project_id}/brief/questions",
            json={"prompt": f"Pregunta {index + 1}", "category": "interior"},
            headers=_auth(token),
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    return ids


def _complete_all(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    question_ids: list[str],
) -> TestClient:
    """Answer every question in one autosave batch (the completion path)."""
    return client.patch(
        f"/api/v1/projects/{project_id}/brief/autosave",
        json={
            "items": [
                {"item_id": item_id, "answer": f"Respuesta {i + 1}", "status": "completed"}
                for i, item_id in enumerate(question_ids)
            ]
        },
        headers=_auth(token),
    )


async def _notifications_for(
    db_session: AsyncSession, project_id: uuid.UUID
) -> list[Notification]:
    result = await db_session.execute(
        select(Notification).where(Notification.project_id == project_id)
    )
    return list(result.scalars().all())


async def _seed_team(
    db_session: AsyncSession, project: Project, lead_designer_user: User
) -> None:
    """Attach the lead designer both by project field and by membership row."""
    project.lead_designer_id = lead_designer_user.id
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=project.id,
            user_id=lead_designer_user.id,
            assigned_role=ProjectRole.LEAD_DESIGNER,
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_completion_notifies_lead_and_collaborators(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """Completing the brief notifies the lead and collaborator, deduplicated."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )

    response = _complete_all(client, active_project.id, client_token, question_ids)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"

    notifications = await _notifications_for(db_session, active_project.id)
    assert len(notifications) == 2
    assert {n.user_id for n in notifications} == {
        lead_designer_user.id,
        collaborator_user.id,
    }
    assert all(n.event_type == "brief.completed" for n in notifications)
    assert all(n.payload["project_id"] == str(active_project.id) for n in notifications)
    assert all(n.payload["project_title"] == active_project.title for n in notifications)
    assert all(n.read_at is None for n in notifications)


@pytest.mark.asyncio
async def test_client_not_notified(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """The client who completes is excluded even when listed as lead designer."""
    active_project.lead_designer_id = client_user.id
    await db_session.commit()
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )

    response = _complete_all(client, active_project.id, client_token, question_ids)
    assert response.status_code == 200, response.text

    notifications = await _notifications_for(db_session, active_project.id)
    assert {n.user_id for n in notifications} == {collaborator_user.id}
    assert all(n.user_id != client_user.id for n in notifications)


@pytest.mark.asyncio
async def test_no_duplicate_notification_on_resave(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_token: str,
    client_token: str,
):
    """Saving an already-completed brief again does not re-notify or re-audit."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )

    first = _complete_all(client, active_project.id, client_token, question_ids)
    assert first.status_code == 200, first.text
    second = _complete_all(client, active_project.id, client_token, question_ids)
    assert second.status_code == 200, second.text

    assert len(await _notifications_for(db_session, active_project.id)) == 2
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "brief.completed")
    )
    assert len(result.scalars().all()) == 1


@pytest.mark.asyncio
async def test_inactive_member_skipped(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """Deactivated team members are not notified (kill switch)."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )
    collaborator_user.is_active = False
    await db_session.commit()

    response = _complete_all(client, active_project.id, client_token, question_ids)
    assert response.status_code == 200, response.text

    notifications = await _notifications_for(db_session, active_project.id)
    assert {n.user_id for n in notifications} == {lead_designer_user.id}


@pytest.mark.asyncio
async def test_notifications_isolated_per_user(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    other_client_user: User,
    other_client_token: str,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """A user only sees and marks their own notifications; others read as 404."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )
    assert _complete_all(
        client, active_project.id, client_token, question_ids
    ).status_code == 200

    other_list = client.get(NOTIFICATIONS_URL, headers=_auth(other_client_token))
    assert other_list.status_code == 200
    assert other_list.json() == []

    own_list = client.get(NOTIFICATIONS_URL, headers=_auth(collaborator_token))
    assert own_list.status_code == 200
    assert len(own_list.json()) == 1

    notifications = await _notifications_for(db_session, active_project.id)
    lead_notification = next(
        n for n in notifications if n.user_id == lead_designer_user.id
    )
    forbidden = client.post(
        f"{NOTIFICATIONS_URL}/{lead_notification.id}/read",
        headers=_auth(other_client_token),
    )
    assert forbidden.status_code == 404

    missing = client.post(
        f"{NOTIFICATIONS_URL}/{uuid.uuid4()}/read",
        headers=_auth(collaborator_token),
    )
    assert missing.status_code == 404

    assert other_client_user.is_active is True
    assert collaborator_user.is_active is True


@pytest.mark.asyncio
async def test_mark_read_and_read_all(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_token: str,
    collaborator_user: User,
    lead_designer_token: str,
    client_token: str,
):
    """Per-notification read and read-all only affect the caller's rows."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )
    assert _complete_all(
        client, active_project.id, client_token, question_ids
    ).status_code == 200

    unread = client.get(
        f"{NOTIFICATIONS_URL}?unread_only=true", headers=_auth(collaborator_token)
    )
    assert unread.status_code == 200
    assert len(unread.json()) == 1
    notification_id = unread.json()[0]["id"]

    read = client.post(
        f"{NOTIFICATIONS_URL}/{notification_id}/read",
        headers=_auth(collaborator_token),
    )
    assert read.status_code == 200
    assert read.json()["read_at"] is not None

    unread = client.get(
        f"{NOTIFICATIONS_URL}?unread_only=true", headers=_auth(collaborator_token)
    )
    assert unread.json() == []

    read_all = client.post(f"{NOTIFICATIONS_URL}/read-all", headers=_auth(lead_designer_token))
    assert read_all.status_code == 200
    assert read_all.json()["marked_read"] == 1
    assert (
        client.get(
            f"{NOTIFICATIONS_URL}?unread_only=true", headers=_auth(lead_designer_token)
        ).json()
        == []
    )

    result = await db_session.execute(
        select(Notification).where(Notification.user_id == collaborator_user.id)
    )
    assert result.scalars().one().read_at is not None


@pytest.mark.asyncio
async def test_completion_audit_logged(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    client_user: User,
    collaborator_token: str,
    client_token: str,
):
    """The completion transition is recorded in the audit log."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 2
    )
    assert _complete_all(
        client, active_project.id, client_token, question_ids
    ).status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "brief.completed")
    )
    log = result.scalar_one()
    assert log.entity_type == "project"
    assert log.entity_id == active_project.id
    assert log.actor_user_id == client_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["project_title"] == active_project.title


@pytest.mark.asyncio
async def test_answer_question_completion_notifies_once(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """The single-question PATCH path notifies only on the completion transition."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 1
    )

    answer_url = f"/api/v1/projects/{active_project.id}/brief/items/{question_ids[0]}"
    answered = client.patch(
        answer_url,
        json={"answer": "Paleta cálida y natural."},
        headers=_auth(client_token),
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["status"] == "completed"

    reanswered = client.patch(
        answer_url,
        json={"answer": "Paleta cálida con madera."},
        headers=_auth(client_token),
    )
    assert reanswered.status_code == 200, reanswered.text

    notifications = await _notifications_for(db_session, active_project.id)
    assert len(notifications) == 2
    assert {n.user_id for n in notifications} == {
        lead_designer_user.id,
        collaborator_user.id,
    }


@pytest.mark.asyncio
async def test_upload_response_completion_notifies(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
):
    """The multimodal upload path notifies the team when it completes the brief."""
    await _seed_team(db_session, active_project, lead_designer_user)
    question_ids = await _create_questions(
        client, active_project.id, collaborator_token, 1
    )

    uploaded = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{question_ids[0]}/response-file",
        files={"file": ("referencia.png", b"png-bytes", "image/png")},
        headers=_auth(client_token),
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["status"] == "completed"

    notifications = await _notifications_for(db_session, active_project.id)
    assert len(notifications) == 2
    assert {n.user_id for n in notifications} == {
        lead_designer_user.id,
        collaborator_user.id,
    }


@pytest.mark.asyncio
async def test_notifications_require_active_user(
    client: TestClient,
    inactive_user: User,
):
    """Notification endpoints reject anonymous and deactivated callers."""
    anonymous = client.get(NOTIFICATIONS_URL)
    assert anonymous.status_code == 401

    token = create_access_token({"sub": str(inactive_user.id)})
    inactive = client.get(NOTIFICATIONS_URL, headers=_auth(token))
    assert inactive.status_code == 403
