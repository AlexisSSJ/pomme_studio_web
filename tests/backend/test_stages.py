"""Tests for stage endpoints: sequential lock and client approval."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token
from backend.app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStage,
    StageStatus,
    User,
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


@pytest.mark.asyncio
async def test_first_stage_active_rest_locked(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert first.status_code == 201
    data = first.json()
    assert data["name"] == "Concepto"
    assert data["order_index"] == 0
    assert data["status"] == "active"
    assert data["project_id"] == str(active_project.id)

    second = create_stage(
        client, active_project.id, collaborator_token, name="Ejecutivo", order_index=1
    )
    assert second.status_code == 201
    assert second.json()["status"] == "locked"

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages",
        headers=auth(collaborator_token),
    )
    assert listing.status_code == 200
    stages = listing.json()
    assert [stage["order_index"] for stage in stages] == [0, 1]


@pytest.mark.asyncio
async def test_duplicate_order_conflict(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert first.status_code == 201

    duplicate = create_stage(
        client, active_project.id, collaborator_token, name="Repetida", order_index=0
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Stage order already exists"


@pytest.mark.asyncio
async def test_create_stage_requires_active_project(
    client: TestClient,
    test_project: Project,
    collaborator_token: str,
):
    response = create_stage(
        client, test_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not active"


@pytest.mark.asyncio
async def test_client_cannot_create_stage(
    client: TestClient,
    active_project: Project,
    client_token: str,
):
    response = create_stage(
        client, active_project.id, client_token, name="Concepto", order_index=0
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_approve_locked_stage_conflict(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    second = create_stage(
        client, active_project.id, collaborator_token, name="Ejecutivo", order_index=1
    )
    assert second.json()["status"] == "locked"

    response = approve_stage(
        client, active_project.id, second.json()["id"], client_token
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Stage is locked"


@pytest.mark.asyncio
async def test_client_approves_active_stage_unlocks_next(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert first.status_code == 201
    second = create_stage(
        client, active_project.id, collaborator_token, name="Ejecutivo", order_index=1
    )
    assert second.status_code == 201

    response = approve_stage(client, active_project.id, first.json()["id"], client_token)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "approved"
    assert data["approved_by"] == str(client_user.id)
    assert data["approved_at"] is not None

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    stages = {stage["order_index"]: stage["status"] for stage in listing.json()}
    assert stages[0] == "approved"
    assert stages[1] == "active"

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "stage.create",
            AuditLog.entity_id == uuid.UUID(first.json()["id"]),
        )
    )
    create_log = result.scalar_one()
    assert create_log.entity_type == "project_stage"
    assert create_log.actor_user_id == collaborator_user.id
    assert create_log.metadata_json["project_id"] == str(active_project.id)

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "stage.approve",
            AuditLog.entity_id == uuid.UUID(first.json()["id"]),
        )
    )
    approve_log = result.scalar_one()
    assert approve_log.entity_type == "project_stage"
    assert approve_log.actor_user_id == client_user.id
    assert approve_log.metadata_json["project_id"] == str(active_project.id)

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "stage.unlock",
            AuditLog.entity_id == uuid.UUID(second.json()["id"]),
        )
    )
    unlock_log = result.scalar_one()
    assert unlock_log.entity_type == "project_stage"
    assert unlock_log.actor_user_id == client_user.id
    assert unlock_log.metadata_json["project_id"] == str(active_project.id)
    assert (
        unlock_log.metadata_json["unlocked_by_stage_id"] == first.json()["id"]
    )


@pytest.mark.asyncio
async def test_approve_out_of_order_creation(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    # Stages are created out of workflow order: 0, 2, 1.
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    assert first.status_code == 201
    third = create_stage(
        client, active_project.id, collaborator_token, name="Entrega", order_index=2
    )
    assert third.status_code == 201
    second = create_stage(
        client, active_project.id, collaborator_token, name="Ejecutivo", order_index=1
    )
    assert second.status_code == 201

    response = approve_stage(client, active_project.id, first.json()["id"], client_token)
    assert response.status_code == 200

    listing = client.get(
        f"/api/v1/projects/{active_project.id}/stages",
        headers=auth(client_token),
    )
    assert listing.status_code == 200
    stages = {stage["order_index"]: stage["status"] for stage in listing.json()}
    assert stages[0] == "approved"
    assert stages[1] == "active"
    assert stages[2] == "locked"


@pytest.mark.asyncio
async def test_approve_twice_conflict(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )
    stage_id = first.json()["id"]

    assert approve_stage(client, active_project.id, stage_id, client_token).status_code == 200

    response = approve_stage(client, active_project.id, stage_id, client_token)
    assert response.status_code == 409
    assert response.json()["detail"] == "Stage is already approved"


@pytest.mark.asyncio
async def test_team_cannot_approve(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    first = create_stage(
        client, active_project.id, collaborator_token, name="Concepto", order_index=0
    )

    response = approve_stage(client, active_project.id, first.json()["id"], collaborator_token)
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_non_member_client_forbidden(
    client: TestClient,
    active_project: Project,
    other_client_token: str,
):
    response = approve_stage(
        client, active_project.id, str(uuid.uuid4()), other_client_token
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_cross_project_stage_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    client_token: str,
):
    foreign = ProjectStage(
        id=uuid.uuid4(),
        project_id=other_project.id,
        name="Etapa ajena",
        order_index=0,
        status=StageStatus.ACTIVE,
    )
    db_session.add(foreign)
    await db_session.commit()

    response = approve_stage(client, active_project.id, str(foreign.id), client_token)
    assert response.status_code == 404
    assert response.json()["detail"] == "Stage not found"


@pytest.mark.asyncio
async def test_unauthenticated_and_inactive(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    inactive_user: User,
):
    base = f"/api/v1/projects/{active_project.id}/stages"
    stage_id = uuid.uuid4()

    assert client.get(base).status_code == 401
    response = client.post(base, json={"name": "Concepto", "order_index": 0})
    assert response.status_code == 401
    assert client.post(f"{base}/{stage_id}/approve").status_code == 401

    # Even a CLIENT membership cannot revive a deactivated user.
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

    response = client.get(base, headers=auth(token))
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    response = client.post(base, json={"name": "Concepto", "order_index": 0}, headers=auth(token))
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    response = client.post(f"{base}/{uuid.uuid4()}/approve", headers=auth(token))
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"
