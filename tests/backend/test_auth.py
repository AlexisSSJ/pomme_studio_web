"""Tests for authentication and project access control."""

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_project_access_from_path
from backend.app.models import User, Project, ProjectMember


def test_login_success(client: TestClient, super_admin_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": super_admin_user.email, "password": "adminpass123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client: TestClient, super_admin_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": super_admin_user.email, "password": "wrongpassword"},
    )
    assert response.status_code == 401


def test_login_inactive_user(client: TestClient, inactive_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": inactive_user.email, "password": "inactive123"},
    )
    assert response.status_code == 403


def test_login_nonexistent_user(client: TestClient):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever123"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_project_access_super_admin(
    db_session: AsyncSession, super_admin_user: User, test_project: Project
):
    result = await require_project_access_from_path(
        project_id=test_project.id,
        current_user=super_admin_user,
        db=db_session,
    )
    assert result.id == super_admin_user.id


@pytest.mark.asyncio
async def test_project_access_member(
    db_session: AsyncSession, collaborator_user: User, test_project: Project
):
    result = await require_project_access_from_path(
        project_id=test_project.id,
        current_user=collaborator_user,
        db=db_session,
    )
    assert result.id == collaborator_user.id


@pytest.mark.asyncio
async def test_project_access_non_member(
    db_session: AsyncSession, client_user: User, test_project: Project
):
    with pytest.raises(HTTPException) as exc_info:
        await require_project_access_from_path(
            project_id=test_project.id,
            current_user=client_user,
            db=db_session,
        )
    assert exc_info.value.status_code == 403
