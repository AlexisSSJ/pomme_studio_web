"""Comprehensive RBAC, kill switch, and audit integration tests."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import User, UserRole, AuditLog, Project, ProjectMember


def test_kill_switch_deactivated_user_gets_403(
    client: TestClient, super_admin_token: str, client_user: User
):
    # Deactivate the user via admin endpoint.
    res = client.patch(
        f"/api/v1/admin/users/{client_user.id}/status",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"is_active": False},
    )
    assert res.status_code == 200

    # The user's existing token should now be rejected on protected endpoints.
    from backend.app.core.security import create_access_token
    token = create_access_token({"sub": str(client_user.id)})
    res = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    # CLIENT role is not SUPER_ADMIN, so 403 for role. But the kill switch
    # should trigger first. Since get_current_active_user checks is_active
    # before require_roles, we expect 403 "Inactive user".
    assert res.status_code == 403
    assert "Inactive" in res.json().get("detail", "")


def test_super_admin_accesses_admin_endpoints(
    client: TestClient, super_admin_token: str
):
    res = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert res.status_code == 200

    res = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert res.status_code == 200


def test_client_denied_admin_endpoints(client: TestClient, client_token: str):
    res = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res.status_code == 403

    res = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert res.status_code == 403


def test_collaborator_denied_admin_endpoints(
    client: TestClient, collaborator_token: str
):
    res = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_collaborator_without_membership_denied_project(
    db_session: AsyncSession, collaborator_user: User
):
    from backend.app.api.deps import require_project_access_from_path
    from fastapi import HTTPException

    # Create a project the collaborator is NOT a member of.
    project = Project(id=uuid.uuid4(), name="Other Project")
    db_session.add(project)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await require_project_access_from_path(
            project_id=project.id,
            current_user=collaborator_user,
            db=db_session,
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_collaborator_with_membership_accesses_project(
    db_session: AsyncSession, collaborator_user: User, test_project: Project
):
    from backend.app.api.deps import require_project_access_from_path

    result = await require_project_access_from_path(
        project_id=test_project.id,
        current_user=collaborator_user,
        db=db_session,
    )
    assert result.id == collaborator_user.id


@pytest.mark.asyncio
async def test_role_change_recorded_in_audit(
    client: TestClient, super_admin_token: str, client_user: User, db_session: AsyncSession
):
    res = client.patch(
        f"/api/v1/admin/users/{client_user.id}/role",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"role": "COLLABORATOR"},
    )
    assert res.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "user.role_change",
            AuditLog.entity_id == client_user.id,
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.metadata_json["old_role"] == "CLIENT"
    assert log.metadata_json["new_role"] == "COLLABORATOR"


@pytest.mark.asyncio
async def test_deactivation_recorded_in_audit(
    client: TestClient, super_admin_token: str, client_user: User, db_session: AsyncSession
):
    res = client.patch(
        f"/api/v1/admin/users/{client_user.id}/status",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"is_active": False},
    )
    assert res.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "user.deactivate",
            AuditLog.entity_id == client_user.id,
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None


def test_unauthenticated_request_gets_401(client: TestClient):
    res = client.get("/api/v1/admin/users")
    assert res.status_code == 401


def test_invalid_token_gets_401(client: TestClient):
    res = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert res.status_code == 401
