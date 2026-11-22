"""Tests for project FF&E specifications CRUD endpoints."""

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
    ProjectSpecification,
    ProjectStatus,
    SpecificationCategory,
    User,
)


@pytest.mark.asyncio
async def test_create_and_list_specification(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_user: User,
    collaborator_token: str,
    client_token: str,
):
    """Team member creates a specification; client can list it; audit logged."""
    payload = {
        "category": "furniture",
        "name": "Silla Ergonómica",
        "code": "SKU-1",
        "manufacturer": "Herman Miller",
        "finish": "Negro",
        "dimensions": "60x60x100",
        "supplier": "Proveedor X",
        "reference_url": "https://example.com/silla",
        "location": "Oficina",
        "notes": "Ergonómica de alta gama",
    }
    response = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json=payload,
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["category"] == "furniture"
    assert data["name"] == "Silla Ergonómica"
    assert data["code"] == "SKU-1"
    assert data["manufacturer"] == "Herman Miller"
    assert data["finish"] == "Negro"
    assert data["dimensions"] == "60x60x100"
    assert data["supplier"] == "Proveedor X"
    assert data["reference_url"] == "https://example.com/silla"
    assert data["location"] == "Oficina"
    assert data["notes"] == "Ergonómica de alta gama"
    assert data["project_id"] == str(active_project.id)
    assert data["created_by"] == str(collaborator_user.id)
    spec_id = uuid.UUID(data["id"])

    # Client can list specifications
    list_response = client.get(
        f"/api/v1/projects/{active_project.id}/specifications",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert list_response.status_code == 200
    items = list_response.json()
    assert any(item["id"] == str(spec_id) for item in items)

    # Client can get single specification
    get_response = client.get(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert get_response.status_code == 200
    assert get_response.json()["id"] == str(spec_id)

    # Audit log verification
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "specification.create",
            AuditLog.entity_id == spec_id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "project_specification"
    assert log.actor_user_id == collaborator_user.id
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_client_cannot_write(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_user: User,
    client_token: str,
):
    """Client role cannot create, update, or delete specifications (403)."""
    # Create an existing spec in the project
    spec = ProjectSpecification(
        project_id=active_project.id,
        category=SpecificationCategory.FURNITURE,
        name="Mesa de centro",
        created_by=collaborator_user.id,
    )
    db_session.add(spec)
    await db_session.commit()

    # Client POST
    post_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "lighting", "name": "Lámpara"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert post_res.status_code == 403
    assert post_res.json()["detail"] == "Insufficient permissions"

    # Client PATCH
    patch_res = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{spec.id}",
        json={"finish": "Roble"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert patch_res.status_code == 403
    assert patch_res.json()["detail"] == "Insufficient permissions"

    # Client DELETE
    del_res = client.delete(
        f"/api/v1/projects/{active_project.id}/specifications/{spec.id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert del_res.status_code == 403
    assert del_res.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_collaborator_can_write(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    """Collaborator with project membership can create specifications (201)."""
    response = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "equipment", "name": "Cafetera Express"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Cafetera Express"


@pytest.mark.asyncio
async def test_update_partial(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
):
    """Partial update via PATCH modifies provided fields, leaves others intact, and logs audit."""
    create_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={
            "category": "finishes",
            "name": "Porcelanato Pulido",
            "finish": "Gris",
            "manufacturer": "Porcelanosa",
        },
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert create_res.status_code == 201
    spec_id = uuid.UUID(create_res.json()["id"])

    patch_res = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        json={"finish": "Blanco"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["finish"] == "Blanco"
    assert data["name"] == "Porcelanato Pulido"
    assert data["manufacturer"] == "Porcelanosa"
    assert data["category"] == "finishes"

    # Verify audit log
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "specification.update",
            AuditLog.entity_id == spec_id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "project_specification"
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_delete(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
    client_token: str,
):
    """Delete returns 204, removes from listing, raises 404 on single get, and logs audit."""
    create_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "other", "name": "Planta decorativa"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert create_res.status_code == 201
    spec_id = uuid.UUID(create_res.json()["id"])

    del_res = client.delete(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert del_res.status_code == 204

    # GET list no longer contains the spec
    list_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert list_res.status_code == 200
    assert not any(item["id"] == str(spec_id) for item in list_res.json())

    # GET detail returns 404
    get_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert get_res.status_code == 404
    assert get_res.json()["detail"] == "Specification not found"

    # Audit log check
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "specification.delete",
            AuditLog.entity_id == spec_id,
        )
    )
    log = result.scalar_one()
    assert log.entity_type == "project_specification"
    assert log.metadata_json["project_id"] == str(active_project.id)


@pytest.mark.asyncio
async def test_validation_rejects_blank_name_and_unknown_field(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    collaborator_token: str,
):
    """Validation rejects blank name (422) and unknown fields like quantity or price (422)."""
    # Blank name on POST
    res_blank = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "   "},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res_blank.status_code == 422

    # Extra field quantity on POST
    res_qty = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "Silla", "quantity": 10},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res_qty.status_code == 422

    # Extra field price on POST
    res_price = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "Silla", "price": 150.0},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert res_price.status_code == 422

    # Create valid specification
    create_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "Silla Válida"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert create_res.status_code == 201
    spec_id = create_res.json()["id"]

    # Blank name on PATCH
    patch_blank = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        json={"name": "   "},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_blank.status_code == 422

    # Extra field on PATCH
    patch_extra = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        json={"quantity": 5},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_extra.status_code == 422


@pytest.mark.asyncio
async def test_writes_require_active_project(
    client: TestClient,
    db_session: AsyncSession,
    client_user: User,
    collaborator_user: User,
    collaborator_token: str,
):
    """Mutations on non-ACTIVE project return 409 'Project is not active'."""
    draft_project = Project(
        id=uuid.uuid4(),
        title="Draft Project",
        client_id=client_user.id,
        status=ProjectStatus.DRAFT,
    )
    db_session.add(draft_project)
    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=draft_project.id,
        user_id=collaborator_user.id,
        assigned_role=ProjectRole.COLLABORATOR,
    )
    db_session.add(member)
    spec = ProjectSpecification(
        project_id=draft_project.id,
        category=SpecificationCategory.FURNITURE,
        name="Mesa",
        created_by=collaborator_user.id,
    )
    db_session.add(spec)
    await db_session.commit()

    # POST on DRAFT
    post_res = client.post(
        f"/api/v1/projects/{draft_project.id}/specifications",
        json={"category": "lighting", "name": "Foco"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert post_res.status_code == 409
    assert post_res.json()["detail"] == "Project is not active"

    # PATCH on DRAFT
    patch_res = client.patch(
        f"/api/v1/projects/{draft_project.id}/specifications/{spec.id}",
        json={"finish": "Negro"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_res.status_code == 409
    assert patch_res.json()["detail"] == "Project is not active"

    # DELETE on DRAFT
    del_res = client.delete(
        f"/api/v1/projects/{draft_project.id}/specifications/{spec.id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert del_res.status_code == 409
    assert del_res.json()["detail"] == "Project is not active"


@pytest.mark.asyncio
async def test_cross_project_specification_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    super_admin_user: User,
    collaborator_token: str,
):
    """Accessing another project's specification under active_project returns 404."""
    other_spec = ProjectSpecification(
        project_id=other_project.id,
        category=SpecificationCategory.LIGHTING,
        name="Lámpara colgante",
        created_by=super_admin_user.id,
    )
    db_session.add(other_spec)
    await db_session.commit()

    # GET cross-project
    get_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications/{other_spec.id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert get_res.status_code == 404
    assert get_res.json()["detail"] == "Specification not found"

    # PATCH cross-project
    patch_res = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{other_spec.id}",
        json={"finish": "Dorado"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_res.status_code == 404
    assert patch_res.json()["detail"] == "Specification not found"

    # DELETE cross-project
    del_res = client.delete(
        f"/api/v1/projects/{active_project.id}/specifications/{other_spec.id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert del_res.status_code == 404
    assert del_res.json()["detail"] == "Specification not found"


@pytest.mark.asyncio
async def test_inactive_user_blocked(
    client: TestClient,
    active_project: Project,
    inactive_user: User,
):
    """Deactivated user cannot access endpoints (403 'Inactive user')."""
    inactive_token = create_access_token({"sub": str(inactive_user.id)})

    get_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications",
        headers={"Authorization": f"Bearer {inactive_token}"},
    )
    assert get_res.status_code == 403
    assert get_res.json()["detail"] == "Inactive user"

    post_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "Silla"},
        headers={"Authorization": f"Bearer {inactive_token}"},
    )
    assert post_res.status_code == 403
    assert post_res.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_non_member_blocked(
    client: TestClient,
    active_project: Project,
    collaborator_two_token: str,
):
    """User without membership gets 403 'No access to this project'."""
    get_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications",
        headers={"Authorization": f"Bearer {collaborator_two_token}"},
    )
    assert get_res.status_code == 403
    assert get_res.json()["detail"] == "No access to this project"

    post_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "furniture", "name": "Silla"},
        headers={"Authorization": f"Bearer {collaborator_two_token}"},
    )
    assert post_res.status_code == 403
    assert post_res.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_non_existent_specification_404(
    client: TestClient,
    active_project: Project,
    collaborator_token: str,
):
    """Random non-existent UUID returns 404 'Specification not found'."""
    missing_id = uuid.uuid4()
    get_res = client.get(
        f"/api/v1/projects/{active_project.id}/specifications/{missing_id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert get_res.status_code == 404
    assert get_res.json()["detail"] == "Specification not found"

    patch_res = client.patch(
        f"/api/v1/projects/{active_project.id}/specifications/{missing_id}",
        json={"finish": "Oro"},
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert patch_res.status_code == 404
    assert patch_res.json()["detail"] == "Specification not found"

    del_res = client.delete(
        f"/api/v1/projects/{active_project.id}/specifications/{missing_id}",
        headers={"Authorization": f"Bearer {collaborator_token}"},
    )
    assert del_res.status_code == 404
    assert del_res.json()["detail"] == "Specification not found"


@pytest.mark.asyncio
async def test_super_admin_can_manage_specifications(
    client: TestClient,
    active_project: Project,
    super_admin_token: str,
):
    """Super admin can create, update, and delete specifications without explicit membership."""
    post_res = client.post(
        f"/api/v1/projects/{active_project.id}/specifications",
        json={"category": "lighting", "name": "Aplique de pared"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert post_res.status_code == 201
    spec_id = post_res.json()["id"]

    del_res = client.delete(
        f"/api/v1/projects/{active_project.id}/specifications/{spec_id}",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert del_res.status_code == 204

