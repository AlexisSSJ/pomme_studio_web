"""Final-handover download gate on `balance_paid` and watermarked preview."""

import io
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.core.security import create_access_token
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectRole,
    User,
)
from backend.app.services.storage import LocalStorage


def _png_bytes() -> bytes:
    """A real 80x60 PNG so Pillow can actually decode it."""
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (240, 240, 240)).save(buffer, format="PNG")
    return buffer.getvalue()


PNG_BYTES = _png_bytes()


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


@pytest_asyncio.fixture
async def final_handover(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    super_admin_token: str,
) -> SimpleNamespace:
    """ACTIVE project with a published final-handover deliverable, unpaid.

    Creates an ACTIVE stage, uploads a real Pillow PNG as a collaborator
    draft, publishes it as super admin and marks it as the project's final
    handover. `active_project.balance_paid` stays False.
    """
    assert active_project.balance_paid is False

    stage = create_stage(
        client, active_project.id, collaborator_token, name="Entrega", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    upload = upload_deliverable(client, active_project.id, stage_id, collaborator_token)
    assert upload.status_code == 201
    deliverable_id = upload.json()["id"]

    published = publish_deliverable(
        client, active_project.id, deliverable_id, super_admin_token
    )
    assert published.status_code == 200

    marked = client.post(
        f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}"
        "/final-handover",
        json={"is_final_handover": True},
        headers=auth(super_admin_token),
    )
    assert marked.status_code == 200
    assert marked.json()["is_final_handover"] is True

    return SimpleNamespace(
        stage_id=stage_id,
        deliverable_id=deliverable_id,
        png_bytes=PNG_BYTES,
    )


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
    title: str = "Entrega final",
):
    """Upload a real PNG deliverable version with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/stages/{stage_id}/deliverables",
        files={"file": ("plano.png", PNG_BYTES, "image/png")},
        data={"title": title},
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


@pytest.mark.asyncio
async def test_client_final_download_blocked_before_payment(
    client: TestClient,
    active_project: Project,
    final_handover: SimpleNamespace,
    client_token: str,
):
    """Unpaid final handover: client gets 403 on /file but a preview."""
    base = (
        f"/api/v1/projects/{active_project.id}/deliverables/"
        f"{final_handover.deliverable_id}"
    )

    download = client.get(f"{base}/file", headers=auth(client_token))
    assert download.status_code == 403
    assert download.json()["detail"] == "Final balance pending"

    preview = client.get(f"{base}/preview", headers=auth(client_token))
    assert preview.status_code == 200
    assert preview.headers["content-type"].split(";")[0] == "image/jpeg"
    assert preview.content != final_handover.png_bytes


@pytest.mark.asyncio
async def test_client_final_download_enabled_after_payment(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    final_handover: SimpleNamespace,
    super_admin_token: str,
    client_token: str,
):
    """After validate-final-payment the client downloads the original file."""
    validate = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers=auth(super_admin_token),
    )
    assert validate.status_code == 200

    download = client.get(
        f"/api/v1/projects/{active_project.id}/deliverables/"
        f"{final_handover.deliverable_id}/file",
        headers=auth(client_token),
    )
    assert download.status_code == 200
    assert download.content == final_handover.png_bytes

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.final_payment_validated",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "project"
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_team_downloads_final_before_payment(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    final_handover: SimpleNamespace,
    collaborator_token: str,
    lead_designer_user: User,
    lead_designer_token: str,
    super_admin_token: str,
):
    """Team roles download the final file even while balance_paid=False."""
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=lead_designer_user.id,
            assigned_role=ProjectRole.LEAD_DESIGNER,
        )
    )
    await db_session.commit()

    assert active_project.balance_paid is False
    file_url = (
        f"/api/v1/projects/{active_project.id}/deliverables/"
        f"{final_handover.deliverable_id}/file"
    )

    for token in (
        collaborator_token,
        lead_designer_token,
        super_admin_token,
    ):
        download = client.get(file_url, headers=auth(token))
        assert download.status_code == 200
        assert download.content == final_handover.png_bytes


@pytest.mark.asyncio
async def test_non_final_deliverable_download_unaffected(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    super_admin_token: str,
    client_token: str,
):
    """Published non-final deliverables download regardless of balance."""
    assert active_project.balance_paid is False

    stage = create_stage(
        client, active_project.id, collaborator_token, name="Bocetos", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    upload = upload_deliverable(
        client, active_project.id, stage_id, collaborator_token, title="Boceto"
    )
    assert upload.status_code == 201
    deliverable_id = upload.json()["id"]

    published = publish_deliverable(
        client, active_project.id, deliverable_id, super_admin_token
    )
    assert published.status_code == 200
    assert published.json()["is_final_handover"] is False

    download = client.get(
        f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}/file",
        headers=auth(client_token),
    )
    assert download.status_code == 200
    assert download.content == PNG_BYTES


@pytest.mark.asyncio
async def test_preview_requires_visibility(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Unpublished drafts stay invisible to the client on /preview."""
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Borrador", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    upload = upload_deliverable(
        client, active_project.id, stage_id, collaborator_token, title="Borrador"
    )
    assert upload.status_code == 201
    assert upload.json()["is_client_visible"] is False

    preview = client.get(
        f"/api/v1/projects/{active_project.id}/deliverables/"
        f"{upload.json()['id']}/preview",
        headers=auth(client_token),
    )
    assert preview.status_code == 404
    assert preview.json()["detail"] == "Deliverable not found"


@pytest.mark.asyncio
async def test_final_download_inactive_user(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    final_handover: SimpleNamespace,
    inactive_user: User,
):
    """A deactivated member's valid token is rejected on both endpoints."""
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=active_project.id,
            user_id=inactive_user.id,
            assigned_role=ProjectRole.CLIENT,
        )
    )
    await db_session.commit()

    inactive_token = create_access_token({"sub": str(inactive_user.id)})
    base = (
        f"/api/v1/projects/{active_project.id}/deliverables/"
        f"{final_handover.deliverable_id}"
    )

    for url in (f"{base}/file", f"{base}/preview"):
        response = client.get(url, headers=auth(inactive_token))
        assert response.status_code == 403
        assert response.json()["detail"] == "Inactive user"
