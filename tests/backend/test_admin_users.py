"""Tests for SUPER_ADMIN user management endpoints."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import User, UserRole, AuditLog


def test_super_admin_creates_user(
    client: TestClient, super_admin_token: str, db_session: AsyncSession
):
    response = client.post(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={
            "email": "newuser@example.com",
            "password": "newpass123",
            "full_name": "New User",
            "role": "COLLABORATOR",
            "specialty": "Interiors",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "newuser@example.com"
    assert data["role"] == "COLLABORATOR"
    assert data["specialty"] == "Interiors"
    assert "hashed_password" not in data


@pytest.mark.asyncio
async def test_create_user_audit_log(
    client: TestClient, super_admin_token: str, db_session: AsyncSession
):
    response = client.post(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={
            "email": "audited@example.com",
            "password": "auditpass123",
            "full_name": "Audited User",
            "role": "CLIENT",
        },
    )
    assert response.status_code == 201

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.create")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1
    assert logs[-1].entity_type == "user"


def test_client_cannot_create_user(client: TestClient, client_token: str):
    response = client.post(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "email": "hacker@example.com",
            "password": "hackpass123",
            "full_name": "Hacker",
            "role": "SUPER_ADMIN",
        },
    )
    assert response.status_code == 403


def test_super_admin_lists_users(
    client: TestClient, super_admin_token: str, super_admin_user: User
):
    response = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_change_role_audit(
    client: TestClient, super_admin_token: str, client_user: User, db_session: AsyncSession
):
    response = client.patch(
        f"/api/v1/admin/users/{client_user.id}/role",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"role": "COLLABORATOR"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "COLLABORATOR"


@pytest.mark.asyncio
async def test_change_role_audit_log(
    client: TestClient, super_admin_token: str, client_user: User, db_session: AsyncSession
):
    response = client.patch(
        f"/api/v1/admin/users/{client_user.id}/role",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"role": "LEAD_DESIGNER"},
    )
    assert response.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.role_change")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1
    meta = logs[-1].metadata_json
    assert meta["old_role"] == "CLIENT"
    assert meta["new_role"] == "LEAD_DESIGNER"


def test_deactivate_user(
    client: TestClient, super_admin_token: str, client_user: User
):
    response = client.patch(
        f"/api/v1/admin/users/{client_user.id}/status",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


@pytest.mark.asyncio
async def test_deactivate_audit_log(
    client: TestClient, super_admin_token: str, client_user: User, db_session: AsyncSession
):
    response = client.patch(
        f"/api/v1/admin/users/{client_user.id}/status",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"is_active": False},
    )
    assert response.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.deactivate")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1


def test_deactivated_user_cannot_login(
    client: TestClient, super_admin_token: str, client_user: User
):
    # Deactivate the user.
    client.patch(
        f"/api/v1/admin/users/{client_user.id}/status",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"is_active": False},
    )
    # Try to login.
    response = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": "clientpass123"},
    )
    assert response.status_code == 403
