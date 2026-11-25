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
    BriefItem,
    BriefItemType,
    BriefStatus,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ServiceType,
    User,
    UserRole,
)


def _create_scoped_project(client: TestClient, token: str, scope: ServiceType,
                           client_user: User, lead_designer_user: User) -> dict:
    """Create a project with an explicit scope via the admin API."""
    response = client.post(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": f"Proyecto {scope.value}",
            "scope_type": scope.value,
            "client_id": str(client_user.id),
            "lead_designer_id": str(lead_designer_user.id),
            "included_rounds": 3,
            "remaining_rounds": 3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _get_brief(client: TestClient, token: str, project_id: str) -> list[dict]:
    """Read the seeded brief for a project as SUPER_ADMIN."""
    response = client.get(
        f"/api/v1/projects/{project_id}/brief",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


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
    assert data["balance_paid"] is False

    result = await db_session.execute(
        select(Project).where(Project.id == draft_project.id)
    )
    project = result.scalar_one()
    assert project.status == ProjectStatus.ACTIVE
    assert project.balance_paid is False

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
    assert len(log.metadata_json["members_added"]) == 2
    assert str(client_user.id) in log.metadata_json["members_added"]
    assert str(lead_designer_user.id) in log.metadata_json["members_added"]


@pytest.mark.asyncio
async def test_create_project_direct_without_lead(
    client: TestClient,
    super_admin_token: str,
    lead_designer_token: str,
    client_user: User,
    db_session: AsyncSession,
):
    """Projects can be created directly from the projects view, without a lead."""
    payload = {
        "title": "Proyecto directo sin lead",
        "scope_type": "interior",
        "client_id": str(client_user.id),
        "included_rounds": 3,
        "remaining_rounds": 3,
    }

    # SUPER_ADMIN creates a project with no lead
    response = client.post(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json=payload,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == payload["title"]
    assert data["lead_id"] is None
    assert data["client_id"] == str(client_user.id)
    assert data["status"] == "draft"

    # Membership for the client was created automatically
    result = await db_session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(data["id"]),
            ProjectMember.user_id == client_user.id,
        )
    )
    member = result.scalar_one()
    assert member.assigned_role == ProjectRole.CLIENT

    # LEAD_DESIGNER can also create directly; becomes lead designer by default
    response = client.post(
        "/api/v1/admin/projects",
        headers={"Authorization": f"Bearer {lead_designer_token}"},
        json={"title": "Proyecto del diseñador"},
    )
    assert response.status_code == 201
    data2 = response.json()
    assert data2["lead_id"] is None
    assert data2["lead_designer_id"] is not None


@pytest.mark.asyncio
async def test_assign_client_and_list_clients(
    client: TestClient,
    super_admin_token: str,
    lead_designer_token: str,
    draft_project_no_client: Project,
    db_session: AsyncSession,
):
    # 1. Create a new client user
    new_client = User(
        id=uuid.uuid4(),
        email="new_client_test@pomme.com",
        hashed_password="fake",
        full_name="New Client Test",
        role=UserRole.CLIENT,
        is_active=True,
    )
    db_session.add(new_client)
    await db_session.commit()

    # 2. List clients as lead designer
    res_clients = client.get(
        "/api/v1/admin/clients",
        headers={"Authorization": f"Bearer {lead_designer_token}"},
    )
    assert res_clients.status_code == 200
    clients_list = res_clients.json()
    assert any(c["id"] == str(new_client.id) for c in clients_list)

    # 3. Assign client to project as lead designer
    res_assign = client.patch(
        f"/api/v1/admin/projects/{draft_project_no_client.id}/client",
        headers={"Authorization": f"Bearer {lead_designer_token}"},
        json={"client_id": str(new_client.id)},
    )
    assert res_assign.status_code == 200
    assert res_assign.json()["client_id"] == str(new_client.id)

    # 4. Verify in DB
    await db_session.refresh(draft_project_no_client)
    assert draft_project_no_client.client_id == new_client.id


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


@pytest.mark.asyncio
async def test_create_project_seeds_branding_template(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    lead_designer_user: User,
    db_session: AsyncSession,
):
    data = _create_scoped_project(client, super_admin_token, ServiceType.BRANDING,
                                  client_user, lead_designer_user)
    items = _get_brief(client, super_admin_token, data["id"])

    questions = [i for i in items if i["item_type"] == BriefItemType.QUESTION.value]
    assert len(questions) >= 6
    assert all(i["status"] == BriefStatus.PENDING.value for i in questions)
    assert {i["category"] for i in questions} <= {"branding", "general"}
    assert all(i["project_id"] == data["id"] for i in questions)

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "brief.template_seeded",
            AuditLog.entity_id == uuid.UUID(data["id"]),
        )
    )
    log = result.scalar_one()
    assert log.metadata_json["scope"] == "branding"
    assert log.metadata_json["questions"] == len(questions)


@pytest.mark.asyncio
async def test_create_project_seeds_interior_template(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    lead_designer_user: User,
):
    data = _create_scoped_project(client, super_admin_token, ServiceType.INTERIOR,
                                  client_user, lead_designer_user)
    items = _get_brief(client, super_admin_token, data["id"])

    questions = [i for i in items if i["item_type"] == BriefItemType.QUESTION.value]
    assert len(questions) >= 6
    assert all(i["status"] == BriefStatus.PENDING.value for i in questions)
    assert {i["category"] for i in questions} <= {"interior", "general"}


@pytest.mark.asyncio
async def test_create_project_seeds_integral_template(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    lead_designer_user: User,
):
    data = _create_scoped_project(client, super_admin_token, ServiceType.INTEGRAL,
                                  client_user, lead_designer_user)
    items = _get_brief(client, super_admin_token, data["id"])

    questions = [i for i in items if i["item_type"] == BriefItemType.QUESTION.value]
    assert len(questions) >= 10
    categories = {i["category"] for i in questions}
    assert {"branding", "interior"} <= categories
    assert all(i["status"] == BriefStatus.PENDING.value for i in questions)


def test_template_questions_are_design_only():
    from backend.app.services.brief_templates import BRIEF_TEMPLATES

    forbidden = ("obra", "montaje", "ejecución", "construcción", "cuadrilla", "instalación")
    for questions in BRIEF_TEMPLATES.values():
        for prompt, _category in questions:
            lowered = prompt.lower()
            for term in forbidden:
                assert term not in lowered, f"Prompt contiene '{term}': {prompt!r}"


@pytest.mark.asyncio
async def test_template_items_belong_to_project(
    client: TestClient,
    super_admin_token: str,
    client_user: User,
    lead_designer_user: User,
):
    branding = _create_scoped_project(client, super_admin_token, ServiceType.BRANDING,
                                      client_user, lead_designer_user)
    interior = _create_scoped_project(client, super_admin_token, ServiceType.INTERIOR,
                                      client_user, lead_designer_user)

    branding_items = _get_brief(client, super_admin_token, branding["id"])
    interior_items = _get_brief(client, super_admin_token, interior["id"])

    assert branding_items and interior_items
    assert all(i["project_id"] == branding["id"] for i in branding_items)
    assert all(i["project_id"] == interior["id"] for i in interior_items)
    assert not ({i["id"] for i in branding_items} & {i["id"] for i in interior_items})


@pytest.mark.asyncio
async def test_create_project_autoflush_off_inserts_parent_before_children():
    """Regression: the production session runs with ``autoflush=False``.

    ``create_project`` must flush the project row before the seeded brief items
    (and memberships) reference it, otherwise the commit inserts the children
    first and Postgres raises ``brief_items_project_id_fkey`` -> 409. The shared
    fixtures use ``autoflush=True`` + SQLite without FK enforcement, so they do
    not exercise this; here we force both production conditions.
    """
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.db.base import Base
    from backend.app.db.session import get_db
    from backend.app.main import app

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    async with factory() as session:
        admin = User(
            id=uuid.uuid4(), email="fk_admin@pomme.studio",
            hashed_password="x", role=UserRole.SUPER_ADMIN, is_active=True,
        )
        session.add(admin)
        await session.commit()

        async def override_get_db():
            yield session

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as c:
                token = create_access_token({"sub": str(admin.id)})
                response = c.post(
                    "/api/v1/admin/projects",
                    headers={"Authorization": f"Bearer {token}"},
                    json={
                        "title": "Proyecto autoflush off",
                        "scope_type": "branding",
                        "included_rounds": 3,
                        "remaining_rounds": 3,
                    },
                )
                assert response.status_code == 201, response.text
                project_id = response.json()["id"]

                brief = c.get(
                    f"/api/v1/projects/{project_id}/brief",
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert brief.status_code == 200
                assert len(brief.json()) >= 6
        finally:
            app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session: AsyncSession, lead_designer_user: User):
    from backend.app.services.brief_templates import seed_brief_from_template

    project = Project(
        id=uuid.uuid4(),
        title="Proyecto idempotente",
        scope_type=ServiceType.BRANDING,
        lead_designer_id=lead_designer_user.id,
        status=ProjectStatus.DRAFT,
        balance_paid=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    first = await seed_brief_from_template(db_session, project, lead_designer_user.id)
    assert len(first) >= 6
    await db_session.commit()

    second = await seed_brief_from_template(db_session, project, lead_designer_user.id)
    assert second == []

    result = await db_session.execute(
        select(BriefItem).where(BriefItem.project_id == project.id)
    )
    assert len(result.scalars().all()) == len(first)

