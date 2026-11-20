"""Tests for GET /api/v1/auth/me."""

import pytest
from fastapi.testclient import TestClient

from backend.app.models import User


@pytest.mark.asyncio
async def test_me_ok(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == super_admin_user.email
    assert data["role"] == super_admin_user.role.value
    assert data["full_name"] == super_admin_user.full_name
    assert "hashed_password" not in data


def test_me_no_token(client: TestClient):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_inactive(
    client: TestClient,
    inactive_user: User,
):
    from backend.app.core.security import create_access_token

    token = create_access_token({"sub": str(inactive_user.id)})
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"
