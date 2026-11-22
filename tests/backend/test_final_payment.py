"""Tests for validating final project payment (balance_paid)."""

import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token
from backend.app.models import (
    AuditLog,
    Project,
    ProjectStatus,
    User,
    UserRole,
)


@pytest_asyncio.fixture
async def active_project(
    db_session: AsyncSession,
    client_user: User,
    lead_designer_user: User,
) -> Project:
    """An active project with balance_paid=False initially."""
    project = Project(
        id=uuid.uuid4(),
        title="Active Project For Final Payment",
        client_id=client_user.id,
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.ACTIVE,
        balance_paid=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest_asyncio.fixture
async def draft_project_for_activation(
    db_session: AsyncSession,
    client_user: User,
    lead_designer_user: User,
) -> Project:
    """A draft project to test activation balance_paid decoupling."""
    project = Project(
        id=uuid.uuid4(),
        title="Draft Project For Activation",
        client_id=client_user.id,
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.DRAFT,
        balance_paid=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest_asyncio.fixture
async def inactive_user(db_session: AsyncSession) -> User:
    """An inactive user for permission/status checks."""
    user = User(
        id=uuid.uuid4(),
        email="inactive_admin@pomme.com",
        hashed_password="hashed",
        full_name="Inactive Admin",
        role=UserRole.SUPER_ADMIN,
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def inactive_user_token(inactive_user: User) -> str:
    return create_access_token(data={"sub": str(inactive_user.id), "role": inactive_user.role.value})


@pytest.mark.asyncio
async def test_validate_final_payment_sets_true_and_audits(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
    active_project: Project,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["balance_paid"] is True

    result = await db_session.execute(
        select(Project).where(Project.id == active_project.id)
    )
    project = result.scalar_one()
    assert project.balance_paid is True

    audit_result = await db_session.execute(
        select(AuditLog)
        .where(
            AuditLog.action == "project.final_payment_validated",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = audit_result.scalar_one()
    assert log.actor_user_id == super_admin_user.id
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
    for token in [lead_designer_token, collaborator_token, client_token]:
        response = client.post(
            f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

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
    assert "Final balance already validated" in response.json()["detail"]


@pytest.mark.asyncio
async def test_validate_final_payment_project_not_found(
    client: TestClient,
    super_admin_token: str,
):
    random_id = uuid.uuid4()
    response = client.post(
        f"/api/v1/admin/projects/{random_id}/validate-final-payment",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 404
    assert "Project not found" in response.json()["detail"]


@pytest.mark.asyncio
async def test_validate_final_payment_inactive_user(
    client: TestClient,
    inactive_user_token: str,
    active_project: Project,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/validate-final-payment",
        headers={"Authorization": f"Bearer {inactive_user_token}"},
    )
    assert response.status_code == 403
    assert "Inactive user" in response.json()["detail"]


@pytest.mark.asyncio
async def test_activate_no_longer_marks_balance_paid(
    client: TestClient,
    super_admin_token: str,
    draft_project_for_activation: Project,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{draft_project_for_activation.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == ProjectStatus.ACTIVE.value
    assert data["balance_paid"] is False

    result = await db_session.execute(
        select(Project).where(Project.id == draft_project_for_activation.id)
    )
    project = result.scalar_one()
    assert project.status == ProjectStatus.ACTIVE
    assert project.balance_paid is False
