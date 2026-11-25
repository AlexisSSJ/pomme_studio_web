"""Admin project activation and internal listing endpoints."""

from uuid import UUID
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_membership,
    require_active_project,
    require_roles,
    require_team_member,
)
from ....db.session import get_db
from ....models.notification import Notification
from ....models.project import Project, ProjectStatus
from ....models.project_member import ProjectMember, ProjectRole
from ....models.user import User, UserRole
from ....schemas.project import (
    LeadUpdate,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectRead,
    TeamUserRead,
)
from ....services.audit import log_audit
from ....services.brief_templates import seed_brief_from_template

router = APIRouter()


@router.get("/projects", response_model=list[ProjectRead])
async def list_projects(
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    """List internal projects.

    SUPER_ADMIN sees every project; LEAD_DESIGNER sees projects where they are
    the assigned lead designer or a project member.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        result = await db.execute(
            select(Project).order_by(Project.created_at.desc())
        )
    else:
        result = await db.execute(
            select(Project)
            .where(
                (Project.lead_designer_id == current_user.id)
                | Project.id.in_(
                    select(ProjectMember.project_id).where(
                        ProjectMember.user_id == current_user.id
                    )
                )
            )
            .order_by(Project.created_at.desc())
        )
    return list(result.scalars().all())


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Create a new project directly without a lead.

    SUPER_ADMIN or LEAD_DESIGNER.
    """
    project = Project(
        id=uuid.uuid4(),
        title=payload.title,
        scope_type=payload.scope_type,
        client_id=payload.client_id,
        lead_designer_id=payload.lead_designer_id or (current_user.id if current_user.role == UserRole.LEAD_DESIGNER else None),
        included_rounds=payload.included_rounds,
        remaining_rounds=payload.remaining_rounds,
        status=ProjectStatus.DRAFT,
        balance_paid=False,
    )
    db.add(project)
    # The request session runs with autoflush=False. Flush the project row now
    # so the memberships and seeded brief items added below can satisfy their
    # foreign key to projects within this same transaction; otherwise the final
    # commit inserts the children before the parent and raises a FK violation
    # (surfaced as a 409 "Project creation conflict").
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project creation conflict",
        ) from exc

    if project.client_id:
        db.add(ProjectMember(project_id=project.id, user_id=project.client_id, assigned_role=ProjectRole.CLIENT))
    if project.lead_designer_id:
        db.add(ProjectMember(project_id=project.id, user_id=project.lead_designer_id, assigned_role=ProjectRole.LEAD_DESIGNER))

    seeded_questions = await seed_brief_from_template(db, project, current_user.id)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project creation conflict",
        ) from exc
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.create_direct",
        entity_type="project",
        entity_id=project.id,
        metadata={"title": project.title},
    )

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.template_seeded",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "scope": project.scope_type.value if project.scope_type else None,
            "questions": len(seeded_questions),
        },
    )

    return project


@router.post("/projects/{project_id}/activate", response_model=ProjectRead)
async def activate_project(
    project_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Activate a DRAFT project after the down payment is received.

    Sets the project status to ACTIVE and creates CLIENT / LEAD_DESIGNER
    memberships from the project's client_id and lead_designer_id when
    present, skipping users that already have a membership for the project.
    The final balance is NOT marked as paid here; a SUPER_ADMIN validates it
    separately via `validate_final_payment`.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.status != ProjectStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project is not in draft status",
        )

    project.status = ProjectStatus.ACTIVE

    desired_members: list[tuple[UUID, ProjectRole]] = []
    if project.client_id is not None:
        desired_members.append((project.client_id, ProjectRole.CLIENT))
    if project.lead_designer_id is not None:
        desired_members.append((project.lead_designer_id, ProjectRole.LEAD_DESIGNER))

    members_added: list[str] = []
    if desired_members:
        desired_user_ids = [user_id for user_id, _ in desired_members]
        existing_result = await db.execute(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id.in_(desired_user_ids),
            )
        )
        existing_user_ids = set(existing_result.scalars().all())

        for user_id, role in desired_members:
            if user_id not in existing_user_ids:
                db.add(
                    ProjectMember(
                        project_id=project.id,
                        user_id=user_id,
                        assigned_role=role,
                    )
                )
                members_added.append(str(user_id))

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project is not in draft status",
        ) from exc
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.activate",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "members_added": members_added,
        },
    )

    return project


@router.post("/projects/{project_id}/validate-final-payment", response_model=ProjectRead)
async def validate_final_payment(
    project_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Validate that the final balance of a project has been paid.

    SUPER_ADMIN-only. Marks `balance_paid` on the project and records an
    audit entry; activating a project no longer sets this flag, so the
    download gate (final deliverable handover) stays closed until this
    endpoint is called.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.balance_paid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Final balance already validated",
        )

    project.balance_paid = True
    await db.commit()
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.final_payment_validated",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "project_id": str(project_id),
            "balance_paid": True,
        },
    )
    return project


@router.patch("/projects/{project_id}/client", response_model=ProjectRead)
async def assign_project_client(
    project_id: UUID,
    payload: dict,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Assign or change the client of a project.

    SUPER_ADMIN or LEAD_DESIGNER (assigned lead or project member).
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    client_id_str = payload.get("client_id")
    client_id = UUID(client_id_str) if client_id_str else None
    previous_client_id = project.client_id

    if client_id is not None:
        client_user = await db.get(User, client_id)
        if client_user is None or client_user.role != UserRole.CLIENT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User not found or is not a client",
            )

    project.client_id = client_id

    # Ensure client membership in project_members if client_id is set. An
    # existing row for the incoming client is updated in place, otherwise the
    # project's client would be listed under a stale role.
    if client_id is not None:
        existing_member = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == client_id,
            )
        )
        existing_row = existing_member.scalar_one_or_none()
        if existing_row is None:
            db.add(
                ProjectMember(
                    project_id=project.id,
                    user_id=client_id,
                    assigned_role=ProjectRole.CLIENT,
                )
            )
        elif existing_row.assigned_role != ProjectRole.CLIENT:
            existing_row.assigned_role = ProjectRole.CLIENT

    # Changing the client revokes the previous client's membership (and with
    # it their access to the project). A previous client that holds another
    # membership role keeps that row.
    if previous_client_id is not None and previous_client_id != client_id:
        previous_membership = await get_membership(db, project.id, previous_client_id)
        if (
            previous_membership is not None
            and previous_membership.assigned_role == ProjectRole.CLIENT
        ):
            await db.delete(previous_membership)

    await db.commit()
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.client_assigned",
        entity_type="project",
        entity_id=project.id,
        metadata={"client_id": str(client_id) if client_id else None},
    )

    return project


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberRead])
async def list_project_members(
    project_id: UUID,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectMemberRead]:
    """List the project's members with their assigned roles.

    SUPER_ADMIN or LEAD_DESIGNER (assigned lead or project member). Members
    are ordered LEAD_DESIGNER, COLLABORATOR, CLIENT and by `created_at`
    within each group, so the output is deterministic.
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    role_priority = case(
        (ProjectMember.assigned_role == ProjectRole.LEAD_DESIGNER, 0),
        (ProjectMember.assigned_role == ProjectRole.COLLABORATOR, 1),
        else_=2,
    )
    result = await db.execute(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
        .order_by(role_priority, ProjectMember.created_at, ProjectMember.id)
    )
    return [
        ProjectMemberRead(
            id=member.id,
            user_id=member.user_id,
            email=user.email,
            full_name=user.full_name,
            assigned_role=member.assigned_role,
            created_at=member.created_at,
        )
        for member, user in result.all()
    ]


@router.get("/team", response_model=list[TeamUserRead])
async def list_team_users(
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> list[TeamUserRead]:
    """List active LEAD_DESIGNER / COLLABORATOR users for project assignment."""
    result = await db.execute(
        select(User)
        .where(
            User.role.in_((UserRole.LEAD_DESIGNER, UserRole.COLLABORATOR)),
            User.is_active.is_(True),
        )
        .order_by(User.email)
    )
    return [
        TeamUserRead(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
        )
        for user in result.scalars().all()
    ]


@router.post(
    "/projects/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_project_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> ProjectMemberRead:
    """Add a collaborator (or the current lead designer) to a project.

    SUPER_ADMIN or LEAD_DESIGNER (assigned lead or project member). The
    target must be active and its global role compatible with the requested
    project role; CLIENT assignments go through the client endpoint and lead
    changes through the lead reassignment endpoint. Adding a member
    notifies the target user and records an audit entry.
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    target_user = await db.get(User, payload.user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    role = payload.assigned_role
    if role == ProjectRole.CLIENT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Client assignment uses the project client endpoint",
        )

    if role == ProjectRole.LEAD_DESIGNER:
        if target_user.role != UserRole.LEAD_DESIGNER:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Incompatible role",
            )
        # The lead column is the single canonical source: a LEAD_DESIGNER
        # membership can only mirror an already assigned lead.
        if project.lead_designer_id != target_user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Use the lead reassignment endpoint",
            )
    elif target_user.role not in (
        UserRole.COLLABORATOR,
        UserRole.LEAD_DESIGNER,
        UserRole.SUPER_ADMIN,
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Incompatible role",
        )

    existing = await get_membership(db, project.id, target_user.id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member",
        )

    member = ProjectMember(
        project_id=project.id,
        user_id=target_user.id,
        assigned_role=role,
    )
    db.add(member)
    db.add(
        Notification(
            user_id=target_user.id,
            project_id=project.id,
            event_type="project.assigned",
            payload={
                "project_id": str(project.id),
                "project_title": project.title,
                "assigned_role": role.value,
            },
        )
    )

    try:
        await db.commit()
    except IntegrityError as exc:
        # Race-safe fallback for the (project_id, user_id) unique constraint.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member",
        ) from exc
    await db.refresh(member)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.member_added",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "user_id": str(target_user.id),
            "assigned_role": role.value,
        },
    )

    return ProjectMemberRead(
        id=member.id,
        user_id=member.user_id,
        email=target_user.email,
        full_name=target_user.full_name,
        assigned_role=member.assigned_role,
        created_at=member.created_at,
    )


@router.delete(
    "/projects/{project_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_project_member(
    project_id: UUID,
    user_id: UUID,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a project member (collaborator or non-assigned lead).

    SUPER_ADMIN or LEAD_DESIGNER (assigned lead or project member). The
    project's client is changed through the client endpoint and the assigned
    lead through the lead reassignment endpoint, so both are rejected here.
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    membership = await get_membership(db, project.id, user_id)
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership not found",
        )

    if membership.assigned_role == ProjectRole.CLIENT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Change the project client instead",
        )

    if project.lead_designer_id == user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reassign the lead instead",
        )

    await db.delete(membership)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.member_removed",
        entity_type="project",
        entity_id=project.id,
        metadata={"user_id": str(user_id)},
    )


@router.patch("/projects/{project_id}/lead", response_model=ProjectRead)
async def assign_project_lead(
    project_id: UUID,
    payload: LeadUpdate,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Reassign the project's lead designer.

    SUPER_ADMIN or LEAD_DESIGNER (assigned lead or project member). The
    target must be an active global LEAD_DESIGNER. The previous lead
    loses their LEAD_DESIGNER membership; the new lead gains one unless a
    membership row already exists (the unique constraint allows only one row
    per user and project, and the project's `lead_designer_id` already grants
    lead access).
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    new_lead = await db.get(User, payload.lead_designer_id)
    if new_lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if new_lead.role != UserRole.LEAD_DESIGNER:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="User is not a lead designer",
        )

    if not new_lead.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    previous_lead_id = project.lead_designer_id
    project.lead_designer_id = new_lead.id

    if previous_lead_id is not None and previous_lead_id != new_lead.id:
        previous_membership = await get_membership(db, project.id, previous_lead_id)
        if (
            previous_membership is not None
            and previous_membership.assigned_role == ProjectRole.LEAD_DESIGNER
        ):
            await db.delete(previous_membership)

    new_membership = await get_membership(db, project.id, new_lead.id)
    if new_membership is None:
        db.add(
            ProjectMember(
                project_id=project.id,
                user_id=new_lead.id,
                assigned_role=ProjectRole.LEAD_DESIGNER,
            )
        )

    await db.commit()
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.lead_assigned",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "previous_lead_id": (
                str(previous_lead_id) if previous_lead_id is not None else None
            ),
            "new_lead_id": str(new_lead.id),
        },
    )

    return project


@router.get("/clients", response_model=list[dict])
async def list_clients(
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List all users with role CLIENT for project assignment."""
    result = await db.execute(
        select(User).where(User.role == UserRole.CLIENT).order_by(User.email)
    )
    clients = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "email": c.email,
            "full_name": c.full_name,
            "role": c.role.value,
        }
        for c in clients
    ]


@router.post("/projects/{project_id}/extra-round", response_model=ProjectRead)
async def grant_extra_round(
    project_id: UUID,
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Grant one extra change round on an ACTIVE project (studio leadership).

    Only SUPER_ADMIN or the project's lead designer (LEAD_DESIGNER membership
    or assignment) may grant rounds; collaborators and clients are rejected
    by the role gate. Both counters increment, keeping remaining rounds at
    most the included ones.
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    project = await require_active_project(project_id, db)

    project.included_rounds += 1
    project.remaining_rounds += 1
    await db.commit()
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="project.extra_round_granted",
        entity_type="project",
        entity_id=project.id,
        metadata={
            "project_id": str(project_id),
            "included_rounds": project.included_rounds,
            "remaining_rounds": project.remaining_rounds,
        },
    )
    return project
