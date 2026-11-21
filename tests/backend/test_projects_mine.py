"""Tests for member-facing project listing and detail endpoints."""

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app.models import Project


@pytest.mark.asyncio
async def test_client_sees_only_member_projects(
    client: TestClient,
    active_project: Project,
    other_project: Project,
    client_token: str,
):
    response = client.get(
        "/api/v1/projects",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 200
    project_ids = {p["id"] for p in response.json()}
    assert str(active_project.id) in project_ids
    assert str(other_project.id) not in project_ids


@pytest.mark.asyncio
async def test_super_admin_sees_all(
    client: TestClient,
    active_project: Project,
    other_project: Project,
    super_admin_token: str,
):
    response = client.get(
        "/api/v1/projects",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    project_ids = {p["id"] for p in response.json()}
    assert str(active_project.id) in project_ids
    assert str(other_project.id) in project_ids


@pytest.mark.asyncio
async def test_get_project_by_id_member_200_nonmember_403(
    client: TestClient,
    active_project: Project,
    client_token: str,
    other_client_token: str,
    super_admin_token: str,
):
    response = client.get(
        f"/api/v1/projects/{active_project.id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 200
    assert response.json()["id"] == str(active_project.id)

    response = client.get(
        f"/api/v1/projects/{active_project.id}",
        headers={"Authorization": f"Bearer {other_client_token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"

    response = client.get(
        f"/api/v1/projects/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"
