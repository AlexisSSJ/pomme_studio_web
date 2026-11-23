"""Tests for project team assignment (members, team list, lead reassignment)."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token, get_password_hash
from backend.app.models import (
    AuditLog,
    Notification,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    User,
    UserRole,
)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _create_user(
    db_session: AsyncSession,
    email: str,
    role: UserRole,
    *,
    is_active: bool = True,
    full_name: str | None = None,
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        hashed_password=get_password_hash("testpass123"),
        full_name=full_name or email.split("@")[0],
        role=role,
        is_active=is_active,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_project(
    db_session: AsyncSession,
    title: str = "Team Project",
    *,
    client_id: uuid.UUID | None = None,
    lead_designer_id: uuid.UUID | None = None,
) -> Project:
    project = Project(
        id=uuid.uuid4(),
        title=title,
        client_id=client_id,
        lead_designer_id=lead_designer_id,
        status=ProjectStatus.ACTIVE,
        balance_paid=False,
        brief_sent_at=datetime.now(timezone.utc),
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


async def _add_member(
    db_session: AsyncSession,
    project: Project,
    user: User,
    role: ProjectRole,
    created_at: datetime | None = None,
) -> ProjectMember:
    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=user.id,
        assigned_role=role,
    )
    if created_at is not None:
        member.created_at = created_at
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


async def _memberships(
    db_session: AsyncSession, project: Project
) -> list[ProjectMember]:
    result = await db_session.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project.id)
        .order_by(ProjectMember.created_at, ProjectMember.id)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# GET /admin/projects/{project_id}/members
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_members_super_admin(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    client_user: User,
    collaborator_user: User,
):
    response = client.get(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data) == 2

    by_user = {row["user_id"]: row for row in data}
    collaborator_row = by_user[str(collaborator_user.id)]
    assert collaborator_row["email"] == collaborator_user.email
    assert collaborator_row["full_name"] == collaborator_user.full_name
    assert collaborator_row["assigned_role"] == ProjectRole.COLLABORATOR.value
    assert collaborator_row["id"]

    client_row = by_user[str(client_user.id)]
    assert client_row["email"] == client_user.email
    assert client_row["assigned_role"] == ProjectRole.CLIENT.value
    assert client_row["created_at"]


@pytest.mark.asyncio
async def test_list_members_lead_designer_member(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    collaborator_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(db_session, "Lead member project")
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)
    await _add_member(db_session, project, collaborator_user, ProjectRole.COLLABORATOR)

    response = client.get(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(lead_designer_token),
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_list_members_lead_designer_assigned_lead(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    client_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Assigned lead project", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, client_user, ProjectRole.CLIENT)

    response = client.get(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(lead_designer_token),
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_list_members_collaborator_member_forbidden(
    client: TestClient,
    collaborator_token: str,
    active_project: Project,
):
    response = client.get(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(collaborator_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_list_members_non_member_lead_designer_forbidden(
    client: TestClient,
    lead_designer_token: str,
    active_project: Project,
):
    response = client.get(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(lead_designer_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"


@pytest.mark.asyncio
async def test_list_members_unknown_project_404(
    client: TestClient,
    super_admin_token: str,
):
    response = client.get(
        f"/api/v1/admin/projects/{uuid.uuid4()}/members",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


@pytest.mark.asyncio
async def test_list_members_ordering(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    collaborator_user: User,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Ordering project", lead_designer_id=lead_designer_user.id
    )
    # Insert in reverse priority order to prove the endpoint sorts the groups.
    await _add_member(
        db_session,
        project,
        client_user,
        ProjectRole.CLIENT,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    await _add_member(
        db_session,
        project,
        collaborator_user,
        ProjectRole.COLLABORATOR,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    await _add_member(
        db_session,
        project,
        lead_designer_user,
        ProjectRole.LEAD_DESIGNER,
        created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
    )

    response = client.get(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 200, response.text
    roles = [row["assigned_role"] for row in response.json()]
    assert roles == [
        ProjectRole.LEAD_DESIGNER.value,
        ProjectRole.COLLABORATOR.value,
        ProjectRole.CLIENT.value,
    ]


# ---------------------------------------------------------------------------
# GET /admin/team
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_team_users(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    collaborator_user: User,
    client_user: User,
    db_session: AsyncSession,
):
    inactive_collaborator = await _create_user(
        db_session, "inactive-collab@pomme.studio", UserRole.COLLABORATOR, is_active=False
    )

    response = client.get(
        "/api/v1/admin/team",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    emails = [row["email"] for row in data]

    assert lead_designer_user.email in emails
    assert collaborator_user.email in emails
    assert client_user.email not in emails
    assert inactive_collaborator.email not in emails
    assert emails == sorted(emails)

    lead_row = next(row for row in data if row["email"] == lead_designer_user.email)
    assert lead_row["role"] == UserRole.LEAD_DESIGNER.value
    assert lead_row["full_name"] == lead_designer_user.full_name


@pytest.mark.asyncio
async def test_list_team_forbidden_for_client(
    client: TestClient,
    client_token: str,
):
    response = client.get("/api/v1/admin/team", headers=_auth(client_token))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_team_allowed_for_lead_designer(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    collaborator_user: User,
):
    """A non-SUPER_ADMIN caller can read the assignable team list."""
    response = client.get("/api/v1/admin/team", headers=_auth(lead_designer_token))
    assert response.status_code == 200, response.text
    emails = [row["email"] for row in response.json()]
    assert lead_designer_user.email in emails
    assert collaborator_user.email in emails


# ---------------------------------------------------------------------------
# POST /admin/projects/{project_id}/members
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_collaborator_super_admin(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
    db_session: AsyncSession,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["user_id"] == str(collaborator_two_user.id)
    assert data["email"] == collaborator_two_user.email
    assert data["full_name"] == collaborator_two_user.full_name
    assert data["assigned_role"] == ProjectRole.COLLABORATOR.value

    memberships = await _memberships(db_session, active_project)
    assert collaborator_two_user.id in [m.user_id for m in memberships]

    result = await db_session.execute(
        select(Notification).where(
            Notification.user_id == collaborator_two_user.id,
            Notification.event_type == "project.assigned",
        )
    )
    notification = result.scalar_one()
    assert notification.project_id == active_project.id
    assert notification.payload["project_id"] == str(active_project.id)
    assert notification.payload["project_title"] == active_project.title
    assert notification.payload["assigned_role"] == ProjectRole.COLLABORATOR.value

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.member_added",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = result.scalar_one()
    assert log.metadata_json == {
        "user_id": str(collaborator_two_user.id),
        "assigned_role": ProjectRole.COLLABORATOR.value,
    }


@pytest.mark.asyncio
async def test_add_collaborator_lead_designer_member(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    collaborator_two_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Lead managed project", lead_designer_id=lead_designer_user.id
    )

    response = client.post(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(lead_designer_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 201, response.text
    memberships = await _memberships(db_session, project)
    assert collaborator_two_user.id in [m.user_id for m in memberships]


@pytest.mark.asyncio
async def test_add_member_collaborator_forbidden(
    client: TestClient,
    collaborator_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(collaborator_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_add_member_inactive_user_403(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    inactive_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(inactive_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"


@pytest.mark.asyncio
async def test_add_member_client_role_rejected(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.CLIENT.value,
        },
    )
    assert response.status_code == 422
    assert (
        response.json()["detail"]
        == "Client assignment uses the project client endpoint"
    )


@pytest.mark.asyncio
async def test_add_global_client_as_collaborator_rejected(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    other_client_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(other_client_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Incompatible role"


@pytest.mark.asyncio
async def test_add_lead_designer_for_current_lead(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Current lead project", lead_designer_id=lead_designer_user.id
    )

    response = client.post(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(lead_designer_user.id),
            "assigned_role": ProjectRole.LEAD_DESIGNER.value,
        },
    )
    assert response.status_code == 201, response.text
    memberships = await _memberships(db_session, project)
    assert [(m.user_id, m.assigned_role) for m in memberships] == [
        (lead_designer_user.id, ProjectRole.LEAD_DESIGNER)
    ]


@pytest.mark.asyncio
async def test_add_lead_designer_for_unassigned_project_409(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    """A leadless project cannot gain a lead membership through this endpoint."""
    project = await _create_project(db_session, "No lead project")

    response = client.post(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(lead_designer_user.id),
            "assigned_role": ProjectRole.LEAD_DESIGNER.value,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Use the lead reassignment endpoint"
    assert await _memberships(db_session, project) == []


@pytest.mark.asyncio
async def test_add_lead_designer_when_other_lead_assigned_409(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    other_lead = await _create_user(
        db_session, "other-lead@pomme.studio", UserRole.LEAD_DESIGNER
    )
    project = await _create_project(
        db_session, "Other lead project", lead_designer_id=other_lead.id
    )

    response = client.post(
        f"/api/v1/admin/projects/{project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(lead_designer_user.id),
            "assigned_role": ProjectRole.LEAD_DESIGNER.value,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Use the lead reassignment endpoint"


@pytest.mark.asyncio
async def test_add_lead_designer_role_for_collaborator_global_user_422(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.LEAD_DESIGNER.value,
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Incompatible role"


@pytest.mark.asyncio
async def test_add_duplicate_member_409(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "User is already a member"


@pytest.mark.asyncio
async def test_add_duplicate_member_race_integrity_error_409(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_user: User,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    """The commit-time unique constraint also yields the duplicate-member 409.

    Forcing the pre-check to miss reproduces two concurrent callers: the
    insert hits `uq_project_member` and surfaces as IntegrityError, which must
    roll back the membership *and* the notification and answer the same 409.
    """
    import backend.app.api.v1.endpoints.admin_projects as admin_projects_module

    async def blind_membership_lookup(db, project_id, user_id):
        return None

    monkeypatch.setattr(
        admin_projects_module, "get_membership", blind_membership_lookup
    )

    project_id = active_project.id
    user_id = collaborator_user.id
    members_before = [m.id for m in await _memberships(db_session, active_project)]

    response = client.post(
        f"/api/v1/admin/projects/{project_id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(user_id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "User is already a member"

    # The endpoint rolled the shared session back; query by the captured ids.
    result = await db_session.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.created_at, ProjectMember.id)
    )
    members_after = list(result.scalars().all())
    assert [m.id for m in members_after] == members_before

    result = await db_session.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.event_type == "project.assigned",
        )
    )
    assert result.scalars().all() == []


@pytest.mark.asyncio
async def test_add_member_unknown_user_404(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(uuid.uuid4()),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_add_member_unknown_project_404(
    client: TestClient,
    super_admin_token: str,
    collaborator_two_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{uuid.uuid4()}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


@pytest.mark.asyncio
async def test_add_member_rejects_extra_fields(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.post(
        f"/api/v1/admin/projects/{active_project.id}/members",
        headers=_auth(super_admin_token),
        json={
            "user_id": str(collaborator_two_user.id),
            "assigned_role": ProjectRole.COLLABORATOR.value,
            "email": collaborator_two_user.email,
        },
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /admin/projects/{project_id}/members/{user_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_collaborator(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_user: User,
    db_session: AsyncSession,
):
    response = client.delete(
        f"/api/v1/admin/projects/{active_project.id}/members/{collaborator_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 204, response.text

    memberships = await _memberships(db_session, active_project)
    assert collaborator_user.id not in [m.user_id for m in memberships]

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.member_removed",
            AuditLog.entity_id == active_project.id,
        )
    )
    log = result.scalar_one()
    assert log.metadata_json == {"user_id": str(collaborator_user.id)}


@pytest.mark.asyncio
async def test_remove_member_from_another_project_404(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    db_session: AsyncSession,
):
    """A membership id belonging to another project is indistinguishable from none."""
    response = client.delete(
        f"/api/v1/admin/projects/{active_project.id}/members/{other_client_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Membership not found"

    other_memberships = await _memberships(db_session, other_project)
    assert other_client_user.id in [m.user_id for m in other_memberships]


@pytest.mark.asyncio
async def test_remove_collaborator_by_project_lead(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    collaborator_two_user: User,
    db_session: AsyncSession,
):
    """The assigned lead (non-SUPER_ADMIN) can remove a collaborator."""
    project = await _create_project(
        db_session, "Lead removes member", lead_designer_id=lead_designer_user.id
    )
    await _add_member(
        db_session, project, collaborator_two_user, ProjectRole.COLLABORATOR
    )

    response = client.delete(
        f"/api/v1/admin/projects/{project.id}/members/{collaborator_two_user.id}",
        headers=_auth(lead_designer_token),
    )
    assert response.status_code == 204, response.text
    assert await _memberships(db_session, project) == []


@pytest.mark.asyncio
async def test_remove_lead_designer_member_allowed_for_non_assigned_lead(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    """A LEAD_DESIGNER membership that is not the project's lead can be removed."""
    project = await _create_project(db_session, "Removable lead membership")
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.delete(
        f"/api/v1/admin/projects/{project.id}/members/{lead_designer_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 204, response.text
    assert await _memberships(db_session, project) == []


@pytest.mark.asyncio
async def test_remove_client_member_409(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    client_user: User,
):
    response = client.delete(
        f"/api/v1/admin/projects/{active_project.id}/members/{client_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Change the project client instead"


@pytest.mark.asyncio
async def test_remove_current_lead_409(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Current lead removal", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.delete(
        f"/api/v1/admin/projects/{project.id}/members/{lead_designer_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Reassign the lead instead"


@pytest.mark.asyncio
async def test_remove_non_member_404(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.delete(
        f"/api/v1/admin/projects/{active_project.id}/members/{collaborator_two_user.id}",
        headers=_auth(super_admin_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Membership not found"


@pytest.mark.asyncio
async def test_remove_member_collaborator_forbidden(
    client: TestClient,
    collaborator_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.delete(
        f"/api/v1/admin/projects/{active_project.id}/members/{collaborator_two_user.id}",
        headers=_auth(collaborator_token),
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /admin/projects/{project_id}/lead
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reassign_lead_moves_membership(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    new_lead = await _create_user(
        db_session, "new-lead@pomme.studio", UserRole.LEAD_DESIGNER
    )
    project = await _create_project(
        db_session, "Reassignment project", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(new_lead.id)},
    )
    assert response.status_code == 200, response.text
    assert response.json()["lead_designer_id"] == str(new_lead.id)

    await db_session.refresh(project)
    assert project.lead_designer_id == new_lead.id

    memberships = await _memberships(db_session, project)
    roles_by_user = {m.user_id: m.assigned_role for m in memberships}
    assert lead_designer_user.id not in roles_by_user
    assert roles_by_user[new_lead.id] == ProjectRole.LEAD_DESIGNER

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "project.lead_assigned",
            AuditLog.entity_id == project.id,
        )
    )
    log = result.scalar_one()
    assert log.metadata_json == {
        "previous_lead_id": str(lead_designer_user.id),
        "new_lead_id": str(new_lead.id),
    }


@pytest.mark.asyncio
async def test_reassign_lead_keeps_existing_collaborator_membership(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, "Collaborator becomes lead", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)
    # A global LEAD_DESIGNER can hold a COLLABORATOR membership in the project.
    collaborating_lead = await _create_user(
        db_session, "collab-lead@pomme.studio", UserRole.LEAD_DESIGNER
    )
    await _add_member(
        db_session, project, collaborating_lead, ProjectRole.COLLABORATOR
    )

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(collaborating_lead.id)},
    )
    assert response.status_code == 200, response.text

    memberships = await _memberships(db_session, project)
    roles_by_user = {m.user_id: m.assigned_role for m in memberships}
    assert roles_by_user == {collaborating_lead.id: ProjectRole.COLLABORATOR}


@pytest.mark.asyncio
async def test_reassign_lead_clears_previous_lead_column(
    client: TestClient,
    super_admin_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    """Changing the lead to the same user is a no-op that keeps the membership."""
    project = await _create_project(
        db_session, "Same lead project", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(lead_designer_user.id)},
    )
    assert response.status_code == 200, response.text

    memberships = await _memberships(db_session, project)
    assert [(m.user_id, m.assigned_role) for m in memberships] == [
        (lead_designer_user.id, ProjectRole.LEAD_DESIGNER)
    ]


@pytest.mark.asyncio
async def test_reassign_lead_requires_global_lead_role(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    collaborator_two_user: User,
):
    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(collaborator_two_user.id)},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "User is not a lead designer"


@pytest.mark.asyncio
async def test_reassign_lead_inactive_target_403(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    db_session: AsyncSession,
):
    """PATCH /lead rejects inactive targets, matching POST /members."""
    inactive_lead = await _create_user(
        db_session,
        "inactive-lead@pomme.studio",
        UserRole.LEAD_DESIGNER,
        is_active=False,
    )

    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(inactive_lead.id)},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Inactive user"

    await db_session.refresh(active_project)
    assert active_project.lead_designer_id is None


@pytest.mark.asyncio
async def test_reassign_lead_unknown_user_404(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
):
    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/lead",
        headers=_auth(super_admin_token),
        json={"lead_designer_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_reassign_lead_collaborator_forbidden(
    client: TestClient,
    collaborator_token: str,
    active_project: Project,
    lead_designer_user: User,
):
    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/lead",
        headers=_auth(collaborator_token),
        json={"lead_designer_id": str(lead_designer_user.id)},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_reassign_lead_by_assigned_lead(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    new_lead = await _create_user(
        db_session, "new-lead-2@pomme.studio", UserRole.LEAD_DESIGNER
    )
    project = await _create_project(
        db_session, "Lead self reassignment", lead_designer_id=lead_designer_user.id
    )
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/lead",
        headers=_auth(lead_designer_token),
        json={"lead_designer_id": str(new_lead.id)},
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(project)
    assert project.lead_designer_id == new_lead.id


@pytest.mark.asyncio
async def test_reassign_lead_by_lead_designer_member(
    client: TestClient,
    lead_designer_token: str,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    """A LEAD_DESIGNER membership holder (not the assigned lead) can reassign."""
    new_lead = await _create_user(
        db_session, "new-lead-3@pomme.studio", UserRole.LEAD_DESIGNER
    )
    project = await _create_project(db_session, "Lead membership reassigns")
    await _add_member(db_session, project, lead_designer_user, ProjectRole.LEAD_DESIGNER)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/lead",
        headers=_auth(lead_designer_token),
        json={"lead_designer_id": str(new_lead.id)},
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(project)
    assert project.lead_designer_id == new_lead.id


# ---------------------------------------------------------------------------
# PATCH /admin/projects/{project_id}/client — membership integrity fix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_change_removes_previous_membership(
    client: TestClient,
    super_admin_token: str,
    client_token: str,
    active_project: Project,
    client_user: User,
    other_client_user: User,
    db_session: AsyncSession,
):
    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/client",
        headers=_auth(super_admin_token),
        json={"client_id": str(other_client_user.id)},
    )
    assert response.status_code == 200, response.text
    assert response.json()["client_id"] == str(other_client_user.id)

    memberships = await _memberships(db_session, active_project)
    roles_by_user = {m.user_id: m.assigned_role for m in memberships}
    assert client_user.id not in roles_by_user
    assert roles_by_user[other_client_user.id] == ProjectRole.CLIENT

    # Previous client lost access to the project.
    response = client.get(
        f"/api/v1/projects/{active_project.id}",
        headers=_auth(client_token),
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_change_keeps_previous_member_with_other_role(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    db_session: AsyncSession,
):
    """A previous client that is also a collaborator keeps that membership row."""
    other_client = await _create_user(
        db_session, "other-client-2@example.com", UserRole.CLIENT
    )
    project = await _create_project(
        db_session, "Client also collaborator", client_id=client_user.id
    )
    await _add_member(db_session, project, client_user, ProjectRole.COLLABORATOR)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/client",
        headers=_auth(super_admin_token),
        json={"client_id": str(other_client.id)},
    )
    assert response.status_code == 200, response.text

    memberships = await _memberships(db_session, project)
    roles_by_user = {m.user_id: m.assigned_role for m in memberships}
    assert roles_by_user[client_user.id] == ProjectRole.COLLABORATOR
    assert roles_by_user[other_client.id] == ProjectRole.CLIENT


@pytest.mark.asyncio
async def test_client_assignment_without_change_keeps_membership(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    client_user: User,
    db_session: AsyncSession,
):
    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/client",
        headers=_auth(super_admin_token),
        json={"client_id": str(client_user.id)},
    )
    assert response.status_code == 200, response.text

    memberships = await _memberships(db_session, active_project)
    roles_by_user = {m.user_id: m.assigned_role for m in memberships}
    assert roles_by_user[client_user.id] == ProjectRole.CLIENT


@pytest.mark.asyncio
async def test_client_assignment_promotes_existing_membership_row(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    db_session: AsyncSession,
):
    """An incoming client with an existing COLLABORATOR row is shown as CLIENT."""
    project = await _create_project(db_session, "Client was a collaborator")
    await _add_member(db_session, project, client_user, ProjectRole.COLLABORATOR)

    response = client.patch(
        f"/api/v1/admin/projects/{project.id}/client",
        headers=_auth(super_admin_token),
        json={"client_id": str(client_user.id)},
    )
    assert response.status_code == 200, response.text

    memberships = await _memberships(db_session, project)
    assert [(m.user_id, m.assigned_role) for m in memberships] == [
        (client_user.id, ProjectRole.CLIENT)
    ]


@pytest.mark.asyncio
async def test_new_client_token_for_project_access(
    client: TestClient,
    super_admin_token: str,
    active_project: Project,
    other_client_user: User,
):
    new_token = create_access_token({"sub": str(other_client_user.id)})

    response = client.patch(
        f"/api/v1/admin/projects/{active_project.id}/client",
        headers=_auth(super_admin_token),
        json={"client_id": str(other_client_user.id)},
    )
    assert response.status_code == 200, response.text

    response = client.get(
        f"/api/v1/projects/{active_project.id}",
        headers=_auth(new_token),
    )
    assert response.status_code == 200, response.text
