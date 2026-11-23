"""Tests for project brief endpoints: questions, answers and references."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.api.v1.endpoints import brief as brief_module
from backend.app.core.config import settings as app_settings
from backend.app.core.security import create_access_token
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    BriefCategory,
    BriefItem,
    BriefItemImage,
    BriefItemType,
    BriefStatus,
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


def _media_files(storage: LocalStorage, suffix: str | None = None) -> list[Path]:
    """Return the files stored under the media root, optionally by extension."""
    files = sorted(path for path in storage.root.rglob("*") if path.is_file())
    if suffix is not None:
        files = [path for path in files if path.suffix == suffix]
    return files


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


@pytest.mark.asyncio
async def test_brief_multimodal_answer_patch_200(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Client can answer with multimodal responses (image, audio with transcription) and custom status."""
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Qué referencias visuales y de audio tienes?", "category": "general"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    patch_res = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
        json={
            "answer": "Queremos un estilo nórdico minimalista.",
            "response_type": "multimodal",
            "image_url": "https://cdn.example.com/mood1.png",
            "audio_url": "https://cdn.example.com/audio1.mp3",
            "audio_transcription": "Nota de voz describiendo el concepto de calidez con iluminación indirecta.",
            "status": "completed",
        },
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["answer"] == "Queremos un estilo nórdico minimalista."
    assert data["image_url"] == "https://cdn.example.com/mood1.png"
    assert data["audio_url"] == "https://cdn.example.com/audio1.mp3"
    assert data["audio_transcription"] == "Nota de voz describiendo el concepto de calidez con iluminación indirecta."
    assert data["transcription"] == data["audio_transcription"]
    assert data["status"] == "completed"
    assert data["progress"] == 100.0

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.id == uuid.UUID(item_id))
    )
    item = result.scalar_one()
    assert item.status == BriefStatus.COMPLETED
    assert item.image_url == "https://cdn.example.com/mood1.png"
    assert item.audio_url == "https://cdn.example.com/audio1.mp3"
    assert item.audio_transcription is not None


@pytest.mark.asyncio
async def test_brief_autosave_calculates_progress(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Autosave endpoint calculates real-time progress and overall brief status."""
    # Create 3 questions
    q_ids = []
    for prompt, cat in [
        ("¿Nombre del proyecto?", "branding"),
        ("¿Metros cuadrados aproximados?", "interior"),
        ("¿Presupuesto de referencia?", "general"),
    ]:
        res = client.post(
            f"/api/v1/projects/{active_project.id}/brief/questions",
            json={"prompt": prompt, "category": cat},
            headers={"Authorization": f"Bearer {collaborator_token}"},
        )
        assert res.status_code == 201
        q_ids.append(res.json()["id"])

    # 1. Autosave question 1 (1 of 3 -> 33.33% progress, in_progress status)
    auto_res1 = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={"item_id": q_ids[0], "answer": "Pomme Cafe", "status": "in_progress"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert auto_res1.status_code == 200
    d1 = auto_res1.json()
    assert d1["total_questions"] == 3
    assert d1["answered_questions"] == 1
    assert d1["pending_questions"] == 2
    assert d1["progress"] == 33.33
    assert d1["status"] == "in_progress"

    # Verify audit log was created for autosave
    audit_res = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.autosave",
            AuditLog.entity_id == uuid.UUID(q_ids[0]),
        )
    )
    assert audit_res.scalar_one() is not None

    # 2. Autosave question 2 with image (2 of 3 -> 66.67% progress)
    auto_res2 = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={
            "item_id": q_ids[1],
            "image_url": "https://cdn.example.com/plan.png",
            "status": "completed",
        },
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert auto_res2.status_code == 200
    d2 = auto_res2.json()
    assert d2["answered_questions"] == 2
    assert d2["progress"] == 66.67
    assert d2["status"] == "in_progress"

    # 3. Autosave question 3 with audio & transcription (3 of 3 -> 100.0% progress, completed status)
    auto_res3 = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={
            "item_id": q_ids[2],
            "audio_url": "https://cdn.example.com/presupuesto.mp3",
            "audio_transcription": "Aproximadamente 20,000 USD para la fase de diseño.",
            "status": "completed",
        },
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert auto_res3.status_code == 200
    d3 = auto_res3.json()
    assert d3["answered_questions"] == 3
    assert d3["pending_questions"] == 0
    assert d3["progress"] == 100.0
    assert d3["status"] == "completed"


@pytest.mark.asyncio
async def test_brief_autosave_item_id_route(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Autosave route via /items/{item_id}/autosave works and calculates progress."""
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Estilo deseado?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    res = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/autosave",
        json={"answer": "Madera y microcemento."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["project_id"] == str(active_project.id)
    assert body["progress"] == 100.0
    assert body["status"] == "completed"
    assert body["answered_questions"] == 1


@pytest.mark.asyncio
async def test_client_pending_brief_indicator_endpoint(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Client can query pending brief status globally and per project for the indicator."""
    # Initially without questions, has_pending_brief is False
    res_init = client.get(
        "/api/v1/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_init.status_code == 200
    assert res_init.json()["has_pending_brief"] is False

    # Add 2 questions
    q1 = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta 1?", "category": "branding"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    ).json()
    q2 = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta 2?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    ).json()

    # Client now has a pending brief with 0% progress
    res_pending = client.get(
        "/api/v1/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_pending.status_code == 200
    data = res_pending.json()
    assert data["has_pending_brief"] is True
    assert data["project_id"] == str(active_project.id)
    assert data["progress"] == 0.0
    assert data["status"] == "pending"
    assert data["total_questions"] == 2
    assert data["pending_questions"] == 2

    # Also verify the /projects/brief/pending route
    res_alias = client.get(
        "/api/v1/projects/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_alias.status_code == 200
    assert res_alias.json()["has_pending_brief"] is True

    # Answer 1 question -> in_progress, 50%
    client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{q1['id']}",
        json={"answer": "Respuesta 1"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    res_half = client.get(
        "/api/v1/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_half.json()["has_pending_brief"] is True
    assert res_half.json()["progress"] == 50.0
    assert res_half.json()["status"] == "in_progress"
    assert res_half.json()["pending_questions"] == 1

    # Project-specific pending endpoint
    proj_pending = client.get(
        f"/api/v1/projects/{active_project.id}/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert proj_pending.status_code == 200
    assert proj_pending.json()["has_pending_brief"] is True
    assert proj_pending.json()["progress"] == 50.0

    # Answer remaining question -> 100%, no longer pending
    client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{q2['id']}",
        json={"answer": "Respuesta 2"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    res_done = client.get(
        "/api/v1/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_done.json()["has_pending_brief"] is False
    assert res_done.json()["progress"] == 100.0


@pytest.mark.asyncio
async def test_brief_multimodal_upload_response_media_and_download(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Client can upload audio response with transcription and download the media."""
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "Describe tu concepto en audio", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    audio_bytes = b"ID3fake-mp3-audio-data"
    upload_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("recording.mp3", audio_bytes, "audio/mpeg")},
        data={"transcription": "Espacio abierto con acabados cálidos."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert upload_res.status_code == 200
    data = upload_res.json()
    assert data["response_type"] == "audio"
    assert data["audio_url"] is not None
    assert data["transcription"] == "Espacio abierto con acabados cálidos."
    assert data["status"] == "completed"

    # Download uploaded media
    dl_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/media",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert dl_res.status_code == 200
    assert dl_res.content == audio_bytes


@pytest.mark.asyncio
async def test_brief_autosave_permissions_and_checks(
    client: TestClient,
    active_project: Project,
    other_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Autosave rejects non-clients, unauthorized projects and non-active projects."""
    # 1. Non-client (collaborator) forbidden (403)
    res_collab = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={"answer": "intruso"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res_collab.status_code == 403

    # 2. Client on other project forbidden (403)
    res_other = client.patch(
        f"/api/v1/projects/{other_project.id}/brief/autosave",
        json={"answer": "intruso"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res_other.status_code == 403


@pytest.mark.asyncio
async def test_upload_two_images_ok(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Referencias visuales?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    # First image upload
    img1_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img1.png", b"png-bytes-1", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert img1_res.status_code == 200

    # Second image upload
    img2_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img2.png", b"png-bytes-2", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert img2_res.status_code == 200

    brief_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert brief_res.status_code == 200
    items = brief_res.json()
    item = next(i for i in items if i["id"] == item_id)
    assert "images" in item
    assert len(item["images"]) == 2
    assert item["images"][0]["position"] == 1
    assert item["images"][1]["position"] == 2

    # Autosave and pending payloads expose the same image list.
    autosave_res = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={"item_id": item_id, "answer": "Referencias listas"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert autosave_res.status_code == 200
    autosaved = next(i for i in autosave_res.json()["items"] if i["id"] == item_id)
    assert len(autosaved["images"]) == 2

    pending_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief/pending",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert pending_res.status_code == 200
    pending_item = next(i for i in pending_res.json()["items"] if i["id"] == item_id)
    assert len(pending_item["images"]) == 2


@pytest.mark.asyncio
async def test_third_image_rejected_409(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Referencias de iluminación?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img1.png", b"png-bytes-1", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img2.png", b"png-bytes-2", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    img3_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img3.png", b"png-bytes-3", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert img3_res.status_code == 409
    assert img3_res.json()["detail"] == "Maximum of 2 images per question"

    brief_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    items = brief_res.json()
    item = next(i for i in items if i["id"] == item_id)
    assert len(item["images"]) == 2


@pytest.mark.asyncio
async def test_delete_image_resyncs_legacy(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Materiales preferidos?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img1.png", b"png-bytes-1", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img2.png", b"png-bytes-2", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    brief_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    item = next(i for i in brief_res.json() if i["id"] == item_id)
    img1_id = item["images"][0]["id"]
    img2_id = item["images"][1]["id"]

    # Delete first image
    del1_res = client.delete(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/images/{img1_id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert del1_res.status_code in (200, 204)

    brief_res2 = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    item2 = next(i for i in brief_res2.json() if i["id"] == item_id)
    assert len(item2["images"]) == 1
    assert item2["images"][0]["id"] == img2_id
    assert item2["images"][0]["position"] == 1
    assert item2["image_url"] is not None
    assert img2_id in item2["image_url"]

    # Delete remaining image
    del2_res = client.delete(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/images/{img2_id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert del2_res.status_code in (200, 204)

    brief_res3 = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    item3 = next(i for i in brief_res3.json() if i["id"] == item_id)
    assert len(item3["images"]) == 0
    assert item3["image_url"] is None
    assert item3["status"] == "pending"


@pytest.mark.asyncio
async def test_image_media_download_content_type(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Textura deseada?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    upload_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("sample.webp", b"webp-bytes-content", "image/webp")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert upload_res.status_code == 200

    brief_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    item = next(i for i in brief_res.json() if i["id"] == item_id)
    img_id = item["images"][0]["id"]

    dl_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/images/{img_id}/media",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert dl_res.status_code == 200
    assert "image/webp" in dl_res.headers["content-type"]
    assert dl_res.content == b"webp-bytes-content"


@pytest.mark.asyncio
async def test_image_upload_cross_project_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    client_user: User,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    # Give client_user CLIENT role in other_project too
    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=other_project.id,
        user_id=client_user.id,
        assigned_role=ProjectRole.CLIENT,
    )
    db_session.add(member)
    await db_session.commit()

    # Question belongs to active_project
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Paleta de color?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    # Try uploading file using other_project path
    upload_res = client.post(
        f"/api/v1/projects/{other_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img.png", b"png-bytes", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert upload_res.status_code == 404


@pytest.mark.asyncio
async def test_collaborator_cannot_upload_response_403(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Estilo de mobiliario?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img.png", b"png-bytes", "image/png")},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_delete_image_cross_project_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
    media_storage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Atmósfera?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    item_id = q_res.json()["id"]

    # An image attached to a question of a different project.
    other_item = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.INTERIOR,
        prompt="¿Otra atmósfera?",
        status=BriefStatus.PENDING,
        created_by=collaborator_user.id,
    )
    other_image = BriefItemImage(
        id=uuid.uuid4(),
        item_id=other_item.id,
        storage_key=f"{other_project.id}/other.png",
        content_type="image/png",
        position=1,
    )
    db_session.add_all([other_item, other_image])
    await db_session.commit()

    res = client.delete(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/images/{other_image.id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res.status_code == 404




class _FakeTranscriptionResponse:
    """Minimal httpx response stand-in for transcription service tests."""

    def __init__(
        self,
        status_code: int = 200,
        payload: object = None,
        json_error: bool = False,
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self._json_error = json_error

    def json(self) -> object:
        if self._json_error:
            raise ValueError("invalid JSON")
        return self._payload


class _FakeTranscriptionClient:
    """Async-context-manager httpx stand-in that records the outgoing request."""

    def __init__(self, response: _FakeTranscriptionResponse, captured: dict) -> None:
        self._response = response
        self._captured = captured

    def __call__(self, *, timeout=None, **_kwargs) -> "_FakeTranscriptionClient":
        self._captured["timeout"] = timeout
        return self

    async def __aenter__(self) -> "_FakeTranscriptionClient":
        return self

    async def __aexit__(self, *_exc_info) -> bool:
        return False

    async def post(self, url: str, **kwargs) -> _FakeTranscriptionResponse:
        self._captured["url"] = url
        self._captured["post"] = kwargs
        return self._response


@pytest.mark.asyncio
async def test_transcribe_audio_posts_multipart_and_returns_text(monkeypatch):
    from backend.app.services import transcription as transcription_module

    monkeypatch.setattr(app_settings, "TRANSCRIPTION_API_KEY", "test-key")
    captured: dict = {}
    response = _FakeTranscriptionResponse(payload={"text": "  Hola desde el audio.  "})
    monkeypatch.setattr(
        transcription_module.httpx,
        "AsyncClient",
        _FakeTranscriptionClient(response, captured),
    )

    result = await transcription_module.transcribe_audio(b"audio-bytes", "audio/webm")

    assert result == "Hola desde el audio."
    assert captured["url"] == app_settings.TRANSCRIPTION_API_URL
    assert captured["timeout"] == 30.0
    assert captured["post"]["headers"] == {"Authorization": "Bearer test-key"}
    assert captured["post"]["data"] == {"model": app_settings.TRANSCRIPTION_MODEL}
    filename, payload, content_type = captured["post"]["files"]["file"]
    assert filename == "audio.webm"
    assert payload == b"audio-bytes"
    assert content_type == "audio/webm"


@pytest.mark.asyncio
async def test_transcribe_audio_without_key_returns_none_without_network(monkeypatch):
    from backend.app.services import transcription as transcription_module

    monkeypatch.setattr(app_settings, "TRANSCRIPTION_API_KEY", "")

    class _ExplodingClient:
        def __init__(self, *_args, **_kwargs) -> None:
            raise AssertionError(
                "transcription must not touch the network without an API key"
            )

    monkeypatch.setattr(transcription_module.httpx, "AsyncClient", _ExplodingClient)

    assert (
        await transcription_module.transcribe_audio(b"audio-bytes", "audio/mpeg") is None
    )


@pytest.mark.parametrize(
    "response",
    [
        _FakeTranscriptionResponse(status_code=500),
        _FakeTranscriptionResponse(json_error=True),
        _FakeTranscriptionResponse(payload={"text": 42}),
        _FakeTranscriptionResponse(payload={"unexpected": "shape"}),
    ],
    ids=["http-error", "invalid-json", "non-string-text", "missing-text"],
)
@pytest.mark.asyncio
async def test_transcribe_audio_returns_none_on_bad_response(monkeypatch, response):
    from backend.app.services import transcription as transcription_module

    monkeypatch.setattr(app_settings, "TRANSCRIPTION_API_KEY", "test-key")
    monkeypatch.setattr(
        transcription_module.httpx,
        "AsyncClient",
        _FakeTranscriptionClient(response, {}),
    )

    assert (
        await transcription_module.transcribe_audio(b"audio-bytes", "audio/mpeg") is None
    )


@pytest.mark.asyncio
async def test_transcribe_audio_returns_none_on_transport_error(monkeypatch):
    import httpx

    from backend.app.services import transcription as transcription_module

    monkeypatch.setattr(app_settings, "TRANSCRIPTION_API_KEY", "test-key")

    class _FailingClient(_FakeTranscriptionClient):
        async def post(self, url: str, **kwargs):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(
        transcription_module.httpx,
        "AsyncClient",
        _FailingClient(_FakeTranscriptionResponse(), {}),
    )

    assert (
        await transcription_module.transcribe_audio(b"audio-bytes", "audio/mpeg") is None
    )


@pytest.mark.asyncio
async def test_audio_upload_transcribes_via_service(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
    monkeypatch,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "Describe el concepto en voz alta", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    calls: list[tuple[bytes, str]] = []

    async def fake_transcribe(data: bytes, content_type: str) -> str:
        calls.append((data, content_type))
        return "Transcripción automática del audio."

    monkeypatch.setattr(brief_module, "transcribe_audio", fake_transcribe)

    audio_bytes = b"ID3fake-mp3-audio-data"
    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("recording.mp3", audio_bytes, "audio/mpeg")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["response_type"] == "audio"
    assert data["audio_url"] is not None
    assert data["audio_transcription"] == "Transcripción automática del audio."
    assert data["transcription"] == "Transcripción automática del audio."
    assert calls == [(audio_bytes, "audio/mpeg")]
    assert [path.read_bytes() for path in _media_files(media_storage)] == [audio_bytes]


@pytest.mark.asyncio
async def test_audio_upload_without_key_fallback_none(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
    monkeypatch,
):
    monkeypatch.setattr(app_settings, "TRANSCRIPTION_API_KEY", "")

    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "Cuéntanos tu rutina en audio", "category": "general"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    audio_bytes = b"ID3fake-mp3-no-key"
    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("recording.mp3", audio_bytes, "audio/mpeg")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["audio_url"] is not None
    assert data["audio_transcription"] is None
    assert data["transcription"] is None
    assert [path.read_bytes() for path in _media_files(media_storage)] == [audio_bytes]


@pytest.mark.asyncio
async def test_audio_upload_service_error_still_saves_audio(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
    monkeypatch,
):
    async def failing_transcribe(_data: bytes, _content_type: str) -> None:
        return None

    monkeypatch.setattr(brief_module, "transcribe_audio", failing_transcribe)

    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Qué te inspira del espacio?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    audio_bytes = b"ID3fake-mp3-service-error"
    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("recording.mp3", audio_bytes, "audio/mpeg")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["audio_url"] is not None
    assert data["audio_transcription"] is None
    assert data["transcription"] is None
    assert [path.read_bytes() for path in _media_files(media_storage)] == [audio_bytes]


@pytest.mark.asyncio
async def test_form_transcription_wins_over_service(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
    monkeypatch,
):
    calls = {"count": 0}

    async def fake_transcribe(_data: bytes, _content_type: str) -> str:
        calls["count"] += 1
        return "Transcripción del servicio."

    monkeypatch.setattr(brief_module, "transcribe_audio", fake_transcribe)

    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Cómo describirías el ambiente?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("recording.mp3", b"ID3fake-mp3-form", "audio/mpeg")},
        data={"transcription": "hola"},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["audio_transcription"] == "hola"
    assert data["transcription"] == "hola"
    assert calls["count"] == 0


@pytest.mark.asyncio
async def test_audio_reupload_replaces_old_file(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "Describe los materiales deseados", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    answer_res = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}",
        json={"answer": "Respuesta escrita previa."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert answer_res.status_code == 200

    image_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("ref.png", b"png-bytes-image", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert image_res.status_code == 200

    first_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("first.mp3", b"first-audio", "audio/mpeg")},
        data={"transcription": "Primera toma."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert first_res.status_code == 200
    first_files = _media_files(media_storage, ".mp3")
    assert len(first_files) == 1
    first_path = first_files[0]
    assert first_path.read_bytes() == b"first-audio"

    second_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("second.mp3", b"second-audio", "audio/mpeg")},
        data={"transcription": "Segunda toma."},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert second_res.status_code == 200

    second_files = _media_files(media_storage, ".mp3")
    assert len(second_files) == 1
    assert second_files[0] != first_path
    assert not first_path.exists()
    assert second_files[0].read_bytes() == b"second-audio"

    brief_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert brief_res.status_code == 200
    item = next(i for i in brief_res.json() if i["id"] == item_id)
    assert item["answer"] == "Respuesta escrita previa."
    assert item["audio_transcription"] == "Segunda toma."
    assert item["transcription"] == "Segunda toma."
    assert len(item["images"]) == 1


@pytest.mark.asyncio
async def test_concurrent_image_insert_conflict_returns_409(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
    monkeypatch,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Referencias de textura?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    real_get_item_images = brief_module._get_item_images
    state = {"counted": False}

    async def racing_get_item_images(db, question_id):
        if not state["counted"]:
            state["counted"] = True
            # A concurrent upload commits position=1 right after our count.
            db.add(
                BriefItemImage(
                    id=uuid.uuid4(),
                    item_id=question_id,
                    storage_key=f"{active_project.id}/raced.png",
                    content_type="image/png",
                    size_bytes=9,
                    position=1,
                )
            )
            await db.commit()
            return []
        return await real_get_item_images(db, question_id)

    monkeypatch.setattr(brief_module, "_get_item_images", racing_get_item_images)

    res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("img.png", b"png-bytes-race", "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )

    assert res.status_code == 409
    assert res.json()["detail"] == "Maximum of 2 images per question"

    result = await db_session.execute(
        select(BriefItemImage).where(BriefItemImage.item_id == uuid.UUID(item_id))
    )
    images = result.scalars().all()
    assert len(images) == 1
    assert images[0].position == 1
    # The rejected upload's file is not left orphaned in storage.
    assert _media_files(media_storage) == []


@pytest.mark.asyncio
async def test_media_legacy_image_branch(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
    media_storage: LocalStorage,
):
    q_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Paleta preferida para el comedor?", "category": "interior"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert q_res.status_code == 201
    item_id = q_res.json()["id"]

    image_bytes = b"png-bytes-legacy-media"
    upload_res = client.post(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/response-file",
        files={"file": ("ref.png", image_bytes, "image/png")},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert upload_res.status_code == 200

    dl_res = client.get(
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/media",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert dl_res.status_code == 200
    assert dl_res.headers["content-type"].split(";")[0] == "image/png"
    assert dl_res.content == image_bytes
