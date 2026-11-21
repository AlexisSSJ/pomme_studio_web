"""Tests for project brief endpoints: questions, answers and references."""

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
    BriefCategory,
    BriefItem,
    BriefItemType,
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


@pytest.mark.asyncio
async def test_team_creates_question_201(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Qué marcas inspiran tu espacio?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["item_type"] == "question"
    assert data["prompt"] == "¿Qué marcas inspiran tu espacio?"
    assert data["category"] == "interior"
    assert data["project_id"] == str(active_project.id)
    assert data["created_by"] == str(collaborator_user.id)
    assert data["answer"] is None

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.question_create",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "brief_item"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_lead_designer_assigned_without_membership_creates_question_201(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    lead_designer_user: User,
    lead_designer_token: str,
):
    """A lead designer attached to the project needs no membership row."""
    active_project.lead_designer_id = lead_designer_user.id
    await db_session.commit()

    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Paleta preferida?", "category": "branding"},
        headers={"Authorization": f"Bearer {lead_designer_token}"},
    )
    assert response.status_code == 201
    assert response.json()["item_type"] == "question"


@pytest.mark.asyncio
async def test_client_answers_question_200(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    question = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Estilo preferido?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert question.status_code == 201
    item_id = question.json()["id"]

    response = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
        json={"answer": "Minimalismo cálido con madera clara."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 200
    assert response.json()["answer"] == "Minimalismo cálido con madera clara."

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(item_id))
    )
    item = result.scalar_one()
    assert item.answer == "Minimalismo cálido con madera clara."

    # A second answer overwrites the first one.
    response = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
        json={"answer": "Minimalismo cálido con madera clara y textiles naturales."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 200
    await db_session.refresh(item)
    assert item.answer == "Minimalismo cálido con madera clara y textiles naturales."

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.answer",
            AuditLog.entity_id == uuid.UUID(item_id),
        )
    )
    logs = result.scalars().all()
    assert len(logs) == 2
    assert all(log.entity_type == "brief_item" for log in logs)


@pytest.mark.asyncio
async def test_client_cannot_create_question_403(
    client: TestClient,
    active_project: Project,
    client_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta del cliente?", "category": "general"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_team_cannot_answer_403(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    lead_designer_token: str,
):
    item_id = uuid.uuid4()
    for token in (collaborator_token, lead_designer_token):
        response = client.patch(
            f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
            json={"answer": "Respuesta del equipo"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_unassigned_collaborator_cannot_create_question_403(
    client: TestClient,
    active_project: Project,
    collaborator_two_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta sin asignación?", "category": "general"},
        headers={"Authorization": f"Bearer {collaborator_two_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_client_without_membership_403(
    client: TestClient,
    active_project: Project,
    other_client_token: str,
):
    # Client-only action without a membership for the project.
    response = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{uuid.uuid4()}",
        json={"answer": "Respuesta ajena"},
        headers={"Authorization": f"Bearer {other_client_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"

    # Reads are equally closed to non-members.
    response = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {other_client_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_upload_reference_201_and_download_200(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    payload = b"\x89PNG-fake-bytes"
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/references",
        files={"file": ("ref.png", payload, "image/png")},
        data={"category": "interior", "note": "Referencia de paleta"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["item_type"] == "reference"
    assert data["file_name"] == "ref.png"
    assert data["content_type"] == "image/png"
    assert data["size_bytes"] == len(payload)
    assert data["category"] == "interior"
    assert data["note"] == "Referencia de paleta"
    assert data["created_by"] == str(collaborator_user.id)
    assert "storage_key" not in data

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.reference_upload",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "brief_item"
    assert log.metadata_json["project_id"] == str(active_project.id)

    download = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{data['id']}/file",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert download.status_code == 200
    assert download.content == payload
    assert download.headers["content-type"].split(";")[0] == "image/png"


@pytest.mark.asyncio
async def test_upload_oversize_413(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/references",
        files={"file": ("big.png", b"x" * (10 * 1024 * 1024 + 1), "image/png")},
        data={"category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "File exceeds the 10 MiB limit"


@pytest.mark.asyncio
async def test_upload_bad_type_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/references",
        files={"file": ("page.html", b"<html></html>", "text/html")},
        data={"category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unsupported file type"


@pytest.mark.asyncio
async def test_upload_note_too_long_422(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/references",
        files={"file": ("ref.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"category": "interior", "note": "n" * 1001},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Note exceeds the 1000 character limit"


@pytest.mark.asyncio
async def test_download_missing_file_404(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    orphan = BriefItem(
        id=uuid.uuid4(),
        project_id=active_project.id,
        item_type=BriefItemType.REFERENCE,
        category=BriefCategory.INTERIOR,
        file_name="gone.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{active_project.id}/gone.png",
        created_by=collaborator_user.id,
    )
    db_session.add(orphan)
    await db_session.commit()

    response = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{orphan.id}/file",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


@pytest.mark.asyncio
async def test_write_on_draft_project_409(
    client: TestClient,
    db_session: AsyncSession,
    test_project: Project,
    client_user: User,
    collaborator_token: str,
    client_token: str,
):
    # The client needs a CLIENT membership for the answer attempt.
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=test_project.id,
            user_id=client_user.id,
            assigned_role=ProjectRole.CLIENT,
        )
    )
    await db_session.commit()

    base = f"/api/v1/projects/{test_project.id}/brief"

    response = client.post(
        f"{base}/questions",
        json={"prompt": "¿Referencias?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.patch(
        f"{base}/items/{uuid.uuid4()}",
        json={"answer": "Respuesta"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"

    response = client.post(
        f"{base}/references",
        files={"file": ("ref.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"


@pytest.mark.asyncio
async def test_reads_allowed_on_draft_project_200(
    client: TestClient,
    db_session: AsyncSession,
    test_project: Project,
    collaborator_user: User,
    collaborator_token: str,
):
    item = BriefItem(
        id=uuid.uuid4(),
        project_id=test_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="¿Objetivos del proyecto?",
        created_by=collaborator_user.id,
    )
    db_session.add(item)
    await db_session.commit()

    response = client.get(
        f"/api/v1/projects/{test_project.id}/brief",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["prompt"] == "¿Objetivos del proyecto?"
    assert data[0]["item_type"] == "question"


@pytest.mark.asyncio
async def test_inactive_user_403(
    client: TestClient,
    db_session: AsyncSession,
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
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta?", "category": "general"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_unauthenticated_401(
    client: TestClient,
    active_project: Project,
):
    base = f"/api/v1/projects/{active_project.id}/brief"

    response = client.get(base)
    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"

    response = client.post(
        f"{base}/questions",
        json={"prompt": "¿Pregunta?", "category": "general"},
    )
    assert response.status_code == 401

    response = client.patch(
        f"{base}/items/{uuid.uuid4()}",
        json={"answer": "Respuesta"},
    )
    assert response.status_code == 401

    response = client.post(
        f"{base}/references",
        files={"file": ("ref.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"category": "interior"},
    )
    assert response.status_code == 401

    response = client.get(f"{base}/items/{uuid.uuid4()}/file")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_cross_project_item_id_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    client_token: str,
):
    foreign_question = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="¿Pregunta ajena?",
        created_by=other_client_user.id,
    )
    foreign_reference = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.REFERENCE,
        category=BriefCategory.INTERIOR,
        file_name="ref.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{other_project.id}/foreign.png",
        created_by=other_client_user.id,
    )
    db_session.add_all([foreign_question, foreign_reference])
    await db_session.commit()

    response = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{foreign_question.id}",
        json={"answer": "Respuesta invasora"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Brief item not found"

    response = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{foreign_reference.id}/file",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Brief item not found"

    # The foreign question was not modified through the other project's path.
    await db_session.refresh(foreign_question)
    assert foreign_question.answer is None
