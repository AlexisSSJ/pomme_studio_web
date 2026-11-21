"""Tests for deliverable endpoints: versions, pins and client approval."""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
async def review(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
) -> SimpleNamespace:
    """Three-round ACTIVE project with an ACTIVE stage and a v1 deliverable."""
    active_project.included_rounds = 3
    active_project.remaining_rounds = 3
    await db_session.commit()

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


def approve_stage(
    client: TestClient,
    project_id: uuid.UUID,
    stage_id: str,
    token: str,
):
    """Approve a stage with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/stages/{stage_id}/approve",
        headers=auth(token),
    )


def upload_deliverable(
    client: TestClient,
    project_id: uuid.UUID,
    stage_id: str,
    token: str,
    *,
    title: str = "Plano propuesta",
    file_name: str = "plano.png",
    payload: bytes = PNG_BYTES,
    content_type: str = "image/png",
):
    """Upload a deliverable version to a stage with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/stages/{stage_id}/deliverables",
        files={"file": (file_name, payload, content_type)},
        data={"title": title},
        headers=auth(token),
    )


def pin_comment(
    client: TestClient,
    project_id: uuid.UUID,
    deliverable_id: str,
    token: str,
    *,
    x_pct: float = 12.5,
    y_pct: float = 80,
    body: str = "Revisar altura",
):
    """Pin a comment on a deliverable with the given bearer token."""
    return client.post(
        f"/api/v1/projects/{project_id}/deliverables/{deliverable_id}/comments",
        json={"x_pct": x_pct, "y_pct": y_pct, "body": body},
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
async def test_upload_versions_increment(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert stage.status_code == 201
    stage_id = stage.json()["id"]

    first = upload_deliverable(client, active_project.id, stage_id, collaborator_token)
    assert first.status_code == 201
    data = first.json()
    assert data["version"] == 1
    assert data["status"] == "in_review"
    assert data["title"] == "Plano propuesta"
    assert data["file_name"] == "plano.png"
    assert data["content_type"] == "image/png"
    assert data["size_bytes"] == len(PNG_BYTES)
    assert data["project_id"] == str(active_project.id)
    assert data["stage_id"] == stage_id
    assert data["created_by"] == str(collaborator_user.id)
    assert "storage_key" not in data

    second = upload_deliverable(
        client, active_project.id, stage_id, collaborator_token, title="Plano revisado"
    )
    assert second.status_code == 201
    assert second.json()["version"] == 2

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages/{stage_id}/deliverables",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    assert [item["version"] for item in listing.json()] == [1, 2]

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.create",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["stage_id"] == stage_id
    assert log.metadata_json["version"] == 1


@pytest.mark.asyncio
async def test_upload_locked_stage_conflict(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    second = create_stage(
        client, active_project.id, collaborator_token, name="Ejecutivo", order_index=1
    )
    assert second.json()["status"] == "locked"

    locked = upload_deliverable(
        client, active_project.id, second.json()["id"], collaborator_token
    )
    assert locked.status_code == 409
    assert locked.json()["detail"] == "Stage is locked"

    assert (
        approve_stage(client, active_project.id, first.json()["id"], client_token).status_code
        == 200
    )

    approved = upload_deliverable(
        client, active_project.id, first.json()["id"], collaborator_token
    )
    assert approved.status_code == 409
    assert approved.json()["detail"] == "Stage is already approved"


@pytest.mark.asyncio
async def test_upload_requires_team_and_active_project(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )

    forbidden = upload_deliverable(
        client, active_project.id, stage.json()["id"], client_token
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "Insufficient permissions"

    # `active_project` mutates the shared project to ACTIVE; use a fresh DRAFT.
    draft = Project(id=uuid.uuid4(), title="Draft Project", client_id=client_user.id)
    draft_stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=draft.id,
        name="Concepto",
        order_index=0,
        status=StageStatus.ACTIVE,
    )
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
            draft_stage,
        ]
    )
    await db_session.commit()

    response = upload_deliverable(
        client, draft.id, str(draft_stage.id), collaborator_token
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"


@pytest.mark.asyncio
async def test_upload_rejects_type_and_size(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
):
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    stage_id = stage.json()["id"]

    bad_type = upload_deliverable(
        client,
        active_project.id,
        stage_id,
        collaborator_token,
        file_name="notas.txt",
        payload=b"plain text",
        content_type="text/plain",
    )
    assert bad_type.status_code == 422
    assert bad_type.json()["detail"] == "Unsupported file type"

    oversize = upload_deliverable(
        client,
        active_project.id,
        stage_id,
        collaborator_token,
        payload=b"x" * (10 * 1024 * 1024 + 1),
    )
    assert oversize.status_code == 413
    assert oversize.json()["detail"] == "File exceeds the 10 MiB limit"


@pytest.mark.asyncio
async def test_upload_version_conflict_returns_409_and_cleans_file(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    collaborator_token: str,
    monkeypatch: pytest.MonkeyPatch,
):
    """A version race trips the uniqueness backstop: 409, no row, no orphan file."""
    stage = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    stage_id = stage.json()["id"]

    original_commit = db_session.commit
    saved_paths: list[Path] = []

    async def conflicting_commit():
        # One-shot: snapshot the stored file, raise like the
        # uq_deliverable_stage_version backstop losing a concurrent race,
        # then delegate to the real commit from now on.
        monkeypatch.setattr(db_session, "commit", original_commit)
        saved_paths.extend(
            path for path in media_storage.root.rglob("*") if path.is_file()
        )
        raise IntegrityError(
            "INSERT deliverables", {}, Exception("uq_deliverable_stage_version")
        )

    monkeypatch.setattr(db_session, "commit", conflicting_commit)
    response = upload_deliverable(client, active_project.id, stage_id, collaborator_token)

    assert response.status_code == 409
    assert response.json()["detail"] == "Deliverable version conflict"

    result = await db_session.execute(
        select(Deliverable).where(Deliverable.stage_id == uuid.UUID(stage_id))
    )
    assert result.scalar_one_or_none() is None

    assert saved_paths, "the conflicted upload must have stored a file first"
    assert not any(path.is_file() for path in media_storage.root.rglob("*"))


@pytest.mark.asyncio
async def test_download_file_authenticated_and_scoped(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    review: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    deliverable_id = review.deliverable["id"]
    file_url = (
        f"/api/v1/projects/{active_project.id}/deliverables/{deliverable_id}/file"
    )

    download = client.get(file_url, headers=auth(client_token))
    assert download.status_code == 200
    assert download.content == PNG_BYTES
    assert download.headers["content-type"].split(";")[0] == "image/png"

    anonymous = client.get(file_url)
    assert anonymous.status_code == 401

    foreign = await seed_foreign_deliverable(db_session, other_project, other_client_user)
    scoped = client.get(
        f"/api/v1/projects/{active_project.id}/deliverables/{foreign.id}/file",
        headers=auth(collaborator_token),
    )
    assert scoped.status_code == 404
    assert scoped.json()["detail"] == "Deliverable not found"


@pytest.mark.asyncio
async def test_pin_creation_defaults_and_round_number(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    client_user: User,
    client_token: str,
):
    response = pin_comment(
        client, active_project.id, review.deliverable["id"], client_token
    )
    assert response.status_code == 201
    data = response.json()
    assert data["x_pct"] == 12.5
    assert data["y_pct"] == 80
    assert data["body"] == "Revisar altura"
    assert data["page_or_frame"] == 1
    assert data["round_number"] == 1
    assert data["consumes_round"] is False
    assert data["created_by"] == str(client_user.id)
    assert data["deliverable_id"] == review.deliverable["id"]

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.comment",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable_comment"
    assert log.actor_user_id == client_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["deliverable_id"] == review.deliverable["id"]
    assert log.metadata_json["round_number"] == 1


@pytest.mark.asyncio
async def test_pin_validation(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    client_token: str,
):
    out_of_range = pin_comment(
        client,
        active_project.id,
        review.deliverable["id"],
        client_token,
        x_pct=101,
        y_pct=50,
        body="Fuera del plano",
    )
    assert out_of_range.status_code == 422

    empty_body = pin_comment(
        client,
        active_project.id,
        review.deliverable["id"],
        client_token,
        x_pct=10,
        y_pct=10,
        body="",
    )
    assert empty_body.status_code == 422


@pytest.mark.asyncio
async def test_pin_whitespace_body_rejected(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    client_token: str,
):
    blank = pin_comment(
        client,
        active_project.id,
        review.deliverable["id"],
        client_token,
        x_pct=10,
        y_pct=10,
        body="   ",
    )
    assert blank.status_code == 422


@pytest.mark.asyncio
async def test_pin_requires_client_and_in_review(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    deliverable_id = review.deliverable["id"]

    forbidden = pin_comment(client, active_project.id, deliverable_id, collaborator_token)
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "Insufficient permissions"

    result = await db_session.execute(
        select(Deliverable).where(Deliverable.id == uuid.UUID(deliverable_id))
    )
    deliverable = result.scalar_one()

    deliverable.status = DeliverableStatus.CHANGES_REQUESTED
    await db_session.commit()
    not_in_review = pin_comment(client, active_project.id, deliverable_id, client_token)
    assert not_in_review.status_code == 409
    assert not_in_review.json()["detail"] == "Deliverable is not in review"

    deliverable.status = DeliverableStatus.IN_REVIEW
    result = await db_session.execute(
        select(ProjectStage).where(ProjectStage.id == uuid.UUID(review.stage_id))
    )
    stage = result.scalar_one()
    stage.status = StageStatus.LOCKED
    await db_session.commit()
    locked = pin_comment(client, active_project.id, deliverable_id, client_token)
    assert locked.status_code == 409
    assert locked.json()["detail"] == "Stage is locked"


@pytest.mark.asyncio
async def test_list_comments_any_member_order(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    collaborator_token: str,
    client_token: str,
):
    comments_url = (
        f"/api/v1/projects/{active_project.id}/deliverables/{review.deliverable['id']}"
        "/comments"
    )

    first = pin_comment(
        client,
        active_project.id,
        review.deliverable["id"],
        client_token,
        x_pct=10,
        y_pct=20,
        body="Primera",
    )
    assert first.status_code == 201
    second = pin_comment(
        client,
        active_project.id,
        review.deliverable["id"],
        client_token,
        x_pct=30,
        y_pct=40,
        body="Segunda",
    )
    assert second.status_code == 201

    listing = client.get(comments_url, headers=auth(collaborator_token))
    assert listing.status_code == 200
    comments = listing.json()
    assert [comment["body"] for comment in comments] == ["Primera", "Segunda"]
    assert comments[0]["round_number"] == 1


@pytest.mark.asyncio
async def test_deliverable_approve_and_audit(
    client: TestClient,
    db_session: AsyncSession,
    media_storage: LocalStorage,
    active_project: Project,
    review: SimpleNamespace,
    client_user: User,
    collaborator_token: str,
    client_token: str,
):
    approve_url = (
        f"/api/v1/projects/{active_project.id}/deliverables/{review.deliverable['id']}"
        "/approve"
    )

    approved = client.post(approve_url, headers=auth(client_token))
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "deliverable.approve",
            AuditLog.entity_id == uuid.UUID(review.deliverable["id"]),
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "deliverable"
    assert log.actor_user_id == client_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)

    repeat = client.post(approve_url, headers=auth(client_token))
    assert repeat.status_code == 409
    assert repeat.json()["detail"] == "Deliverable is already approved"

    second = upload_deliverable(
        client, active_project.id, review.stage_id, collaborator_token, title="Plano revisado"
    )
    assert second.status_code == 201
    team_attempt = client.post(
        f"/api/v1/projects/{active_project.id}/deliverables/{second.json()['id']}/approve",
        headers=auth(collaborator_token),
    )
    assert team_attempt.status_code == 403
    assert team_attempt.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_cross_project_deliverable_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    client_token: str,
):
    foreign = await seed_foreign_deliverable(db_session, other_project, other_client_user)
    base = f"/api/v1/projects/{active_project.id}/deliverables/{foreign.id}"

    responses = [
        client.get(base, headers=auth(client_token)),
        client.get(f"{base}/file", headers=auth(client_token)),
        client.get(f"{base}/comments", headers=auth(client_token)),
        client.post(
            f"{base}/comments",
            json={"x_pct": 10, "y_pct": 20, "body": "Hola"},
            headers=auth(client_token),
        ),
        client.post(f"{base}/approve", headers=auth(client_token)),
    ]
    for response in responses:
        assert response.status_code == 404
        assert response.json()["detail"] == "Deliverable not found"
