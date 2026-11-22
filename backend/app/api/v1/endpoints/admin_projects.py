"""Admin project activation and internal listing endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import require_active_project, require_roles, require_team_member
from ....db.session import get_db
from ....models.project import Project, ProjectStatus
from ....models.project_member import ProjectMember, ProjectRole
from ....models.user import User, UserRole
from ....schemas.project import ProjectRead
from ....services.audit import log_audit

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

    if client_id is not None:
        client_user = await db.get(User, client_id)
        if client_user is None or client_user.role != UserRole.CLIENT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User not found or is not a client",
            )

    project.client_id = client_id

    # Ensure client membership in project_members if client_id is set
    if client_id is not None:
        existing_member = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == client_id,
            )
        )
        if not existing_member.scalar_one_or_none():
            db.add(
                ProjectMember(
                    project_id=project.id,
                    user_id=client_id,
                    assigned_role=ProjectRole.CLIENT,
                )
            )

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
