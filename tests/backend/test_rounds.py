"""Tests for change-round control: decrement, zero-block and extra rounds."""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    Deliverable,
    DeliverableComment,
    DeliverableStatus,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStage,
    StageStatus,
    User,
)
from backend.app.services.storage import LocalStorage

PNG_BYTES = b"\x89PNG-fake-bytes"


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_stage(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
    *,
    name: str,
    order_index: int,
):
    """Create a stage with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/stages",
        json={"name": name, "order_index": order_index},
        headers=auth(token),
    )


def upload_deliverable(
    client: TestClient,
    project_id: uuid.UUID,
    stage_id: str,
    token: str,
    *,
    title: str,
):
    """Upload the next deliverable version (starts IN_REVIEW)."""
    return client.post(
        f"/api/v1/projects/{project_id}/stages/{stage_id}/deliverables",
        files={"file": ("plano.png", PNG_BYTES, "image/png")},
        data={"title": title},
        headers=auth(token),
    )


def pin_comment(
    client: TestClient,
    project_id: uuid.UUID,
    deliverable_id: str,
    token: str,
    *,
    body: str,
):
    """Pin a comment on a deliverable with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/deliverables/{deliverable_id}/comments",
        json={"x_pct": 12.5, "y_pct": 80, "body": body},
        headers=auth(token),
    )


def request_changes(
    client: TestClient,
    project_id: uuid.UUID,
    deliverable_id: str,
    token: str,
):
    """Request changes on a deliverable with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/deliverables/{deliverable_id}/request-changes",
        headers=auth(token),
    )


def grant_extra_round(
    client: TestClient,
    project_id: uuid.UUID,
    token: str,
):
    """Grant one extra change round with the given bearer token."""
    return client.post(
        f"/api/v1/admin/projects/{project_id}/extra-round",
        headers=auth(token),
    )


async def project_rounds(db_session: AsyncSession, project_id: uuid.UUID) -> Project:
    """Re-read the project to assert its round counters."""
    result = await db_session.execute(
        select(Project).where(Project.id == project_id)
    )
    return result.scalar_one()


@pytest_asyncio.fixture
async def rounds(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
) -> SimpleNamespace:
    """Two-round ACTIVE project with an ACTIVE stage, a v1 deliverable and 2 pins."""
    active_project.included_rounds = 2
    active_project.remaining_rounds = 2
    await db_session.commit()

    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    upload = upload_deliverable(
        client, active_project.id, stage_id, collaborator_token, title="Plano propuesta"
    )
    assert upload.status_code == 201
    deliverable_id = upload.json()["id"]

    for body in ("Revisar altura", "Ajustar color"):
        pin = pin_comment(
            client, active_project.id, deliverable_id, client_token, body=body
        )
        assert pin.status_code == 201

    return SimpleNamespace(stage_id=stage_id, deliverable_id=deliverable_id)


async def exhaust_rounds(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    rounds: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
) -> None:
    """Spend both included rounds: request changes on v1, then on a fresh v2."""
    first = request_changes(
        client, active_project.id, rounds.deliverable_id, client_token
    )
    assert first.status_code == 200

    second = upload_deliverable(
        client, active_project.id, rounds.stage_id, collaborator_token, title="Plano v2"
    )
    assert second.status_code == 201

    second_request = request_changes(
        client, active_project.id, second.json()["id"], client_token
    )
    assert second_request.status_code == 200

    assert (await project_rounds(db_session, active_project.id)).remaining_rounds == 0


@pytest.mark.asyncio
async def test_request_changes_decrements_and_marks_pins(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    client_user: User,
    client_token: str,
):
    response = request_changes(
        client, active_project.id, rounds.deliverable_id, client_token
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == rounds.deliverable_id
    assert data["status"] == "changes_requested"

    project = await project_rounds(db_session, active_project.id)
    assert project.remaining_rounds == 1

    result = await db_session.execute(
        select(Deliverable).where(Deliverable.id == uuid.UUID(rounds.deliverable_id))
    )
    deliverable = result.scalar_one()
    assert deliverable.status == DeliverableStatus.CHANGES_REQUESTED

    result = await db_session.execute(
        select(DeliverableComment).where(
            DeliverableComment.deliverable_id == deliverable.id
        )
    )
    comments = result.scalars().all()
    assert len(comments) == 2
    assert all(comment.consumes_round for comment in comments)

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.changes_requested",
            AuditLog.entity_id == deliverable.id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.actor_user_id == client_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["deliverable_id"] == rounds.deliverable_id
    assert log.metadata_json["stage_id"] == rounds.stage_id
    assert log.metadata_json["remaining_rounds"] == 1
    assert log.metadata_json["consumed_round"] == 1


@pytest.mark.asyncio
async def test_rounds_exhaust_to_zero(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    await exhaust_rounds(
        client, db_session, active_project, rounds, collaborator_token, client_token
    )

    project = await project_rounds(db_session, active_project.id)
    assert project.included_rounds == 2
    assert project.remaining_rounds == 0


@pytest.mark.asyncio
async def test_zero_rounds_blocks(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    await exhaust_rounds(
        client, db_session, active_project, rounds, collaborator_token, client_token
    )

    third = upload_deliverable(
        client, active_project.id, rounds.stage_id, collaborator_token, title="Plano v3"
    )
    assert third.status_code == 201
    third_id = third.json()["id"]

    blocked = request_changes(client, active_project.id, third_id, client_token)
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "No remaining change rounds"

    project = await project_rounds(db_session, active_project.id)
    assert project.remaining_rounds == 0

    result = await db_session.execute(
        select(Deliverable).where(Deliverable.id == uuid.UUID(third_id))
    )
    assert result.scalar_one().status == DeliverableStatus.IN_REVIEW

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.changes_requested",
            AuditLog.entity_id == uuid.UUID(third_id),
        )
    )
    assert result.scalar_one_or_none() is None

    result = await db_session.execute(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "deliverable.changes_requested"
        )
    )
    assert result.scalar_one() == 2  # Only the v1 and v2 requests were audited.


@pytest.mark.asyncio
async def test_extra_round_by_lead_designer_unblocks(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    lead_designer_user: User,
    lead_designer_token: str,
    collaborator_token: str,
    client_token: str,
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

    await exhaust_rounds(
        client, db_session, active_project, rounds, collaborator_token, client_token
    )

    extra = grant_extra_round(client, active_project.id, lead_designer_token)
    assert extra.status_code == 200
    data = extra.json()
    assert data["id"] == str(active_project.id)
    assert data["included_rounds"] == 3
    assert data["remaining_rounds"] == 1

    project = await project_rounds(db_session, active_project.id)
    assert project.included_rounds == 3
    assert project.remaining_rounds == 1

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.extra_round_granted",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "project"
    assert log.actor_user_id == lead_designer_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["included_rounds"] == 3
    assert log.metadata_json["remaining_rounds"] == 1

    third = upload_deliverable(
        client, active_project.id, rounds.stage_id, collaborator_token, title="Plano v3"
    )
    assert third.status_code == 201

    unblocked = request_changes(
        client, active_project.id, third.json()["id"], client_token
    )
    assert unblocked.status_code == 200
    assert (await project_rounds(db_session, active_project.id)).remaining_rounds == 0


@pytest.mark.asyncio
async def test_extra_round_super_admin_ok(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    super_admin_token: str,
):
    active_project.included_rounds = 2
    active_project.remaining_rounds = 2
    await db_session.commit()

    response = grant_extra_round(client, active_project.id, super_admin_token)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(active_project.id)
    assert data["included_rounds"] == 3
    assert data["remaining_rounds"] == 3

    project = await project_rounds(db_session, active_project.id)
    assert project.included_rounds == 3
    assert project.remaining_rounds == 3


@pytest.mark.asyncio
async def test_extra_round_forbidden_roles(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    lead_designer_token: str,
):
    collaborator = grant_extra_round(client, active_project.id, collaborator_token)
    assert collaborator.status_code == 403
    assert collaborator.json()["detail"] == "Insufficient permissions"

    client_response = grant_extra_round(client, active_project.id, client_token)
    assert client_response.status_code == 403
    assert client_response.json()["detail"] == "Insufficient permissions"

    # No LEAD_DESIGNER membership and not the assigned lead designer.
    lead = grant_extra_round(client, active_project.id, lead_designer_token)
    assert lead.status_code == 403
    assert lead.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_request_changes_without_pins_allowed(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    unpinned = upload_deliverable(
        client, active_project.id, rounds.stage_id, collaborator_token, title="Plano v2"
    )
    assert unpinned.status_code == 201
    unpinned_id = unpinned.json()["id"]

    response = request_changes(client, active_project.id, unpinned_id, client_token)
    assert response.status_code == 200
    assert response.json()["status"] == "changes_requested"

    assert (await project_rounds(db_session, active_project.id)).remaining_rounds == 1

    # Pins on other versions stay unconsumed.
    result = await db_session.execute(
        select(DeliverableComment).where(
            DeliverableComment.deliverable_id == uuid.UUID(rounds.deliverable_id)
        )
    )
    comments = result.scalars().all()
    assert len(comments) == 2
    assert all(comment.consumes_round is False for comment in comments)


@pytest.mark.asyncio
async def test_request_changes_twice_conflict(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    client_token: str,
):
    first = request_changes(
        client, active_project.id, rounds.deliverable_id, client_token
    )
    assert first.status_code == 200

    repeat = request_changes(
        client, active_project.id, rounds.deliverable_id, client_token
    )
    assert repeat.status_code == 409
    assert repeat.json()["detail"] == "Deliverable is not in review"

    assert (await project_rounds(db_session, active_project.id)).remaining_rounds == 1


@pytest.mark.asyncio
async def test_request_changes_team_forbidden(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    collaborator_token: str,
    other_client_token: str,
):
    team = request_changes(
        client, active_project.id, rounds.deliverable_id, collaborator_token
    )
    assert team.status_code == 403
    assert team.json()["detail"] == "Insufficient permissions"

    foreign = request_changes(
        client, active_project.id, rounds.deliverable_id, other_client_token
    )
    assert foreign.status_code == 403
    assert foreign.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_request_changes_locked_stage(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    rounds: SimpleNamespace,
    client_token: str,
):
    result = await db_session.execute(
        select(ProjectStage).where(ProjectStage.id == uuid.UUID(rounds.stage_id))
    )
    stage = result.scalar_one()
    stage.status = StageStatus.LOCKED
    await db_session.commit()

    response = request_changes(
        client, active_project.id, rounds.deliverable_id, client_token
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Stage is locked"

    assert (await project_rounds(db_session, active_project.id)).remaining_rounds == 2
