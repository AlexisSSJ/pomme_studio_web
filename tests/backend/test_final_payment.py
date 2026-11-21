"""Tests for SUPER_ADMIN final-payment validation and activation decoupling."""

import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token, get_password_hash
from backend.app.models import (
    AuditLog,
    Project,
    ProjectStatus,
    User,
    UserRole,
)


@pytest_asyncio.fixture
async def draft_project(
    db_session: AsyncSession,
    client_user: User,
    lead_designer_user: User,
) -> Project:
    """DRAFT project with client and lead designer assigned."""
    project = Project(
        id=uuid.uuid4(),
        title="Draft Project",
        client_id=client_user.id,
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.DRAFT,
        balance_paid=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.mark.asyncio
async def test_validate_final_payment_sets_true_and_audits(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
    active_project: Project,
    db_session: AsyncSession,
):
    assert active_project.balance_paid is False

    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(active_project.id)
    assert data["balance_paid"] is True

    result = await db_session.execute(
        select(Project).where(Project.id == active_project.id)
    )
    project = result.scalar_one()
    assert project.balance_paid is True

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.final_payment_validated",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = result.scalar_one()
    assert log.actor_user_id == super_admin_user.id
    assert log.entity_type == "project"
    assert log.metadata_json["project_id"] == str(active_project.id)
    assert log.metadata_json["balance_paid"] is True


@pytest.mark.asyncio
async def test_validate_final_payment_forbidden_roles(
    client: TestClient,
    lead_designer_token: str,
    collaborator_token: str,
    client_token: str,
    active_project: Project,
    db_session: AsyncSession,
):
    for token in (lead_designer_token, collaborator_token, client_token):
        response = client.post(
            f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Insufficient permissions"

    # No token → 401.
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
    )
    assert response.status_code == 401

    result = await db_session.execute(
        select(Project).where(Project.id == active_project.id)
    )
    project = result.scalar_one()
    assert project.balance_paid is False


@pytest.mark.asyncio
async def test_validate_final_payment_already_paid_conflict(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    db_session: AsyncSession,
):
    active_project.balance_paid = True
    await db_session.commit()

    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Final balance already validated"


@pytest.mark.asyncio
async def test_validate_final_payment_project_not_found(
    client: TestClient,
    super_admin_token: str,
):
    response = client.post(
        f"/api/v1/admin/projects/{uuid.uuid4()}/validate-final-payment",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


@pytest.mark.asyncio
async def test_validate_final_payment_inactive_user(
    client: TestClient,
    active_project: Project,
    db_session: AsyncSession,
):
    inactive_admin = User(
        id=uuid.uuid4(),
        email="inactive-admin@pomme.studio",
        hashed_password=get_password_hash("inactivepass123"),
        full_name="Inactive Admin",
        role=UserRole.SUPER_ADMIN,
        is_active=False,
    )
    db_session.add(inactive_admin)
    await db_session.commit()
    inactive_token = create_access_token({"sub": str(inactive_admin.id)})

    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers={"Authorization": f"Bearer {inactive_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_activate_no_longer_marks_balance_paid(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == ProjectStatus.ACTIVE.value
    assert data["balance_paid"] is False

    result = await db_session.execute(
        select(Project).where(Project.id == draft_project.id)
    )
    project = result.scalar_one()
    assert project.status == ProjectStatus.ACTIVE
    assert project.balance_paid is False
