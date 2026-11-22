"""Tests for the deliverable draft/publish flow and client read gates."""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    Deliverable,
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


@pytest_asyncio.fixture
async def draft(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
) -> SimpleNamespace:
    """ACTIVE stage with a collaborator-uploaded draft deliverable (v1)."""
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    upload = upload_deliverable(client, active_project.id, stage_id, collaborator_token)
    assert upload.status_code == 201

    return SimpleNamespace(stage_id=stage_id, deliverable=upload.json())


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
    title: str = "Plano propuesta",
    is_client_visible: bool | None = None,
    is_final_handover: bool | None = None,
):
    """Upload a deliverable version, optionally with visibility form flags."""
    data: dict[str, str] = {"title": title}
    if is_client_visible is not None:
        data["is_client_visible"] = "true" if is_client_visible else "false"
    if is_final_handover is not None:
        data["is_final_handover"] = "true" if is_final_handover else "false"
    return client.post(
        f"/api/v1/projects/{project_id}/stages/{stage_id}/deliverables",
        files={"file": ("plano.png", PNG_BYTES, "image/png")},
        data=data,
        headers=auth(token),
    )


def publish_deliverable(
    client: TestClient,
    project_id: uuid.UUID,
    deliverable_id: str,
    token: str,
):
    """Publish a deliverable version to the client portal."""
    return client.post(
        f"/api/v1/projects/{project_id}/deliverables/{deliverable_id}/publish",
        json={},
        headers=auth(token),
    )


async def seed_foreign_deliverable(
    db_session: AsyncSession, project: Project, created_by: User
) -> Deliverable:
    """Insert a stage and a v1 deliverable for `project` directly in the DB."""
    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=project.id,
        name="Etapa ajena",
        order_index=0,
        status=StageStatus.ACTIVE,
    )
    deliverable = Deliverable(
        id=uuid.uuid4(),
        project_id=project.id,
        stage_id=stage.id,
        title="Entrega ajena",
        version=1,
        file_name="ajena.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{project.id}/ajena.png",
        status=DeliverableStatus.IN_REVIEW,
        created_by=created_by.id,
    )
    db_session.add_all([stage, deliverable])
    await db_session.commit()
    return deliverable


@pytest.mark.asyncio
async def test_collaborator_upload_is_draft_and_invisible_to_client(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    client_token: str,
):
    deliverable_id = draft.deliverable["id"]
    assert draft.deliverable["is_client_visible"] is False
    assert draft.deliverable["is_final_handover"] is False
    assert draft.deliverable["published_at"] is None
    assert draft.deliverable["published_by"] is None

    base = f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}"

    detail = client.get(base, headers=auth(client_token))
    assert detail.status_code == 404
    assert detail.json()["detail"] == "Deliverable not found"

    file_response = client.get(f"{base}/file", headers=auth(client_token))
    assert file_response.status_code == 404
    assert file_response.json()["detail"] == "Deliverable not found"

    comments = client.get(f"{base}/comments", headers=auth(client_token))
    assert comments.status_code == 404
    assert comments.json()["detail"] == "Deliverable not found"

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages/{draft.stage_id}/deliverables",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    assert listing.json() == []


@pytest.mark.asyncio
async def test_collaborator_cannot_force_visible(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    collaborator_token: str,
):
    forced = upload_deliverable(
        client,
        active_project.id,
        draft.stage_id,
        collaborator_token,
        title="Plano forzado",
        is_client_visible=True,
        is_final_handover=True,
    )
    assert forced.status_code == 201
    data = forced.json()
    assert data["is_client_visible"] is False
    assert data["is_final_handover"] is False


@pytest.mark.asyncio
async def test_lead_publishes_and_client_sees(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    lead_designer_user: User,
    lead_designer_token: str,
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

    deliverable_id = draft.deliverable["id"]
    publish = publish_deliverable(
        client, active_project.id, deliverable_id, lead_designer_token
    )
    assert publish.status_code == 200
    data = publish.json()
    assert data["is_client_visible"] is True
    assert data["is_final_handover"] is False
    assert data["published_by"] == str(lead_designer_user.id)
    assert data["published_at"] is not None

    base = f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}"
    detail = client.get(base, headers=auth(client_token))
    assert detail.status_code == 200
    assert detail.json()["is_client_visible"] is True

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages/{draft.stage_id}/deliverables",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    assert deliverable_id in [item["id"] for item in listing.json()]

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.publish",
            AuditLog.entity_id == uuid.UUID(deliverable_id),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.actor_user_id == lead_designer_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["is_final_handover"] is False


@pytest.mark.asyncio
async def test_collaborator_cannot_publish(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    collaborator_token: str,
):
    publish = publish_deliverable(
        client, active_project.id, draft.deliverable["id"], collaborator_token
    )
    assert publish.status_code == 403
    assert publish.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_unpublish_hides_again(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    super_admin_token: str,
    client_token: str,
):
    deliverable_id = draft.deliverable["id"]
    publish = publish_deliverable(
        client, active_project.id, deliverable_id, super_admin_token
    )
    assert publish.status_code == 200
    assert publish.json()["is_client_visible"] is True

    base = f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}"
    visible = client.get(base, headers=auth(client_token))
    assert visible.status_code == 200

    unpublish = client.post(f"{base}/unpublish", json={}, headers=auth(super_admin_token))
    assert unpublish.status_code == 200
    assert unpublish.json()["is_client_visible"] is False

    hidden = client.get(base, headers=auth(client_token))
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == "Deliverable not found"

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages/{draft.stage_id}/deliverables",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    assert listing.json() == []

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.unpublish",
            AuditLog.entity_id == uuid.UUID(deliverable_id),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_team_sees_drafts(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    lead_designer_user: User,
    lead_designer_token: str,
    collaborator_token: str,
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

    base = (
        f"/api/v1/projects/{active_project.id}/deliverables/{draft.deliverable['id']}"
    )

    collaborator_view = client.get(base, headers=auth(collaborator_token))
    assert collaborator_view.status_code == 200
    assert collaborator_view.json()["is_client_visible"] is False

    lead_view = client.get(base, headers=auth(lead_designer_token))
    assert lead_view.status_code == 200

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages/{draft.stage_id}/deliverables",
        headers=auth(collaborator_token),
    )
    assert listing.status_code == 200
    assert draft.deliverable["id"] in [item["id"] for item in listing.json()]


@pytest.mark.asyncio
async def test_mark_final_handover_roles(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    draft: SimpleNamespace,
    super_admin_token: str,
    collaborator_token: str,
):
    deliverable_id = draft.deliverable["id"]
    base = f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}"

    denied = client.post(
        f"{base}/final-handover",
        json={"is_final_handover": True},
        headers=auth(collaborator_token),
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Insufficient permissions"

    marked = client.post(
        f"{base}/final-handover",
        json={"is_final_handover": True},
        headers=auth(super_admin_token),
    )
    assert marked.status_code == 200
    data = marked.json()
    assert data["is_final_handover"] is True
    # Marking the final handover does not publish the draft.
    assert data["is_client_visible"] is False

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.final_handover",
            AuditLog.entity_id == uuid.UUID(deliverable_id),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["is_final_handover"] is True


@pytest.mark.asyncio
async def test_cross_project_deliverable_visibility_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    client_token: str,
    super_admin_token: str,
):
    foreign = await seed_foreign_deliverable(db_session, other_project, other_client_user)
    base = f"/api/v1/projects/{active_project.id}/deliverables/{foreign.id}"

    responses = [
        client.get(base, headers=auth(client_token)),
        client.get(f"{base}/file", headers=auth(client_token)),
        publish_deliverable(
            client, active_project.id, str(foreign.id), super_admin_token
        ),
    ]
    for response in responses:
        assert response.status_code == 404
        assert response.json()["detail"] == "Deliverable not found"
