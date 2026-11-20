"""Tests for admin project activation and internal listing."""

import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token
from backend.app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectRole,
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


@pytest_asyncio.fixture
async def draft_project_no_client(
    db_session: AsyncSession,
    lead_designer_user: User,
) -> Project:
    """DRAFT project with lead designer but no client."""
    project = Project(
        id=uuid.uuid4(),
        title="Draft Project No Client",
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.DRAFT,
        balance_paid=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.mark.asyncio
async def test_activate_ok(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
    client_user: User,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(draft_project.id)
    assert data["status"] == ProjectStatus.ACTIVE.value
    assert data["balance_paid"] is True

    result = await db_session.execute(
        select(Project).where(Project.id == draft_project.id)
    )
    project = result.scalar_one()
    assert project.status == ProjectStatus.ACTIVE
    assert project.balance_paid is True

    result = await db_session.execute(
        select(ProjectMember).where(ProjectMember.project_id == draft_project.id)
    )
    members = result.scalars().all()
    assert len(members) == 2
    roles_by_user = {m.user_id: m.assigned_role for m in members}
    assert roles_by_user[client_user.id] == ProjectRole.CLIENT
    assert roles_by_user[lead_designer_user.id] == ProjectRole.LEAD_DESIGNER

    result = await db_session.execute(
        select(AuditLog)
        .where(
            AuditLog.action == "project.activate",
            AuditLog.entity_id == draft_project.id,
        )
        .order_by(AuditLog.created_at.desc())
    )
    log = result.scalar_one()
    assert log.metadata_json["balance_paid"] is True
    assert len(log.metadata_json["members_added"]) == 2
    assert str(client_user.id) in log.metadata_json["members_added"]
    assert str(lead_designer_user.id) in log.metadata_json["members_added"]


@pytest.mark.asyncio
async def test_activate_without_client(
    client: TestClient,
    super_admin_token: str,
    draft_project_no_client: Project,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{draft_project_no_client.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200

    result = await db_session.execute(
        select(ProjectMember).where(ProjectMember.project_id == draft_project_no_client.id)
    )
    members = result.scalars().all()
    assert len(members) == 1
    assert members[0].user_id == lead_designer_user.id
    assert members[0].assigned_role == ProjectRole.LEAD_DESIGNER


@pytest.mark.asyncio
async def test_activate_existing_member_not_duplicated(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
    client_user: User,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    existing = ProjectMember(
        project_id=draft_project.id,
        user_id=client_user.id,
        assigned_role=ProjectRole.CLIENT,
    )
    db_session.add(existing)
    await db_session.commit()

    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200

    result = await db_session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == draft_project.id,
            ProjectMember.user_id == client_user.id,
        )
    )
    client_members = result.scalars().all()
    assert len(client_members) == 1

    result = await db_session.execute(
        select(ProjectMember).where(ProjectMember.project_id == draft_project.id)
    )
    members = result.scalars().all()
    assert len(members) == 2


@pytest.mark.asyncio
async def test_activate_twice(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
):
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200

    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not in draft status"


@pytest.mark.asyncio
async def test_activate_not_found(
    client: TestClient,
    super_admin_token: str,
):
    response = client.post(
        f"/api/v1/admin/projects/{uuid.uuid4()}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_activate_rbac(
    client: TestClient,
    draft_project: Project,
    lead_designer_token: str,
    collaborator_token: str,
    client_token: str,
    super_admin_user: User,
    db_session: AsyncSession,
):
    # Lead designer: 403
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {lead_designer_token}"},
    )
    assert response.status_code == 403

    # Collaborator: 403
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 403

    # Client: 403
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403

    # No token: 401
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
    )
    assert response.status_code == 401

    # Inactive super admin: 403
    super_admin_user.is_active = False
    await db_session.commit()
    inactive_token = create_access_token({"sub": str(super_admin_user.id)})
    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {inactive_token}"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_projects_admin_sees_all(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
    draft_project_no_client: Project,
):
    response = client.get(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 2
    project_ids = {p["id"] for p in data}
    assert str(draft_project.id) in project_ids
    assert str(draft_project_no_client.id) in project_ids


@pytest.mark.asyncio
async def test_list_projects_designer_scope(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    project_a = Project(
        id=uuid.uuid4(),
        title="Project A",
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.DRAFT,
    )
    other_designer = User(
        id=uuid.uuid4(),
        email="other@pomme.studio",
        hashed_password="hash",
        role=UserRole.LEAD_DESIGNER,
        is_active=True,
    )
    project_b = Project(
        id=uuid.uuid4(),
        title="Project B",
        lead_designer_id=other_designer.id,
        status=ProjectStatus.DRAFT,
    )
    db_session.add_all([project_a, other_designer, project_b])
    await db_session.commit()

    response = client.get(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {lead_designer_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    project_ids = {p["id"] for p in data}
    assert str(project_a.id) in project_ids
    assert str(project_b.id) not in project_ids


@pytest.mark.asyncio
async def test_list_projects_rbac(
    client: TestClient,
    client_token: str,
):
    # Client: 403
    response = client.get(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403

    # No token: 401
    response = client.get("/api/v1/admin/projects")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_activate_integrity_conflict_returns_409(
    client: TestClient,
    super_admin_token: str,
    draft_project: Project,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    """A concurrent membership insert is a conflict, not an unhandled 500."""
    async def fail_with_integrity_error():
        raise IntegrityError("INSERT project_members", {}, Exception("duplicate"))

    monkeypatch.setattr(db_session, "commit", fail_with_integrity_error)
    client.raise_server_exceptions = False

    response = client.post(
        f"/api/v1/admin/projects/{draft_project.id}/activate",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Project is not in draft status"
    await db_session.rollback()
