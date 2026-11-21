"""Stage endpoints: sequential workflow phases with client approval."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_stage_or_404,
    require_active_project,
    require_active_stage,
    require_client_member,
    require_project_access_from_path,
    require_roles,
    require_team_member,
)
from ....db.session import get_db
from ....models.project_stage import ProjectStage, StageStatus
from ....models.user import User, UserRole
from ....schemas.stage import StageCreate, StageRead
from ....services.audit import log_audit

router = APIRouter()


@router.get("", response_model=list[StageRead])
async def list_stages(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectStage]:
    """List the project's stages in workflow order (any member, any status)."""
    result = await db.execute(
        select(ProjectStage)
        .where(ProjectStage.project_id == project_id)
        .order_by(ProjectStage.order_index.asc())
    )
    return list(result.scalars().all())


@router.post(
    "",
    response_model=StageRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_stage(
    project_id: UUID,
    payload: StageCreate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> ProjectStage:
    """Add a workflow stage (studio team, ACTIVE projects only).

    A new stage starts ACTIVE when every earlier stage of the project is
    already APPROVED (vacuously true for the project's first stage, which
    has no predecessors); otherwise it is LOCKED until the client approves
    its predecessor. A duplicate order_index is rejected with 409.
    """
    await require_active_project(project_id, db)

    result = await db.execute(
        select(ProjectStage.id)
        .where(
            ProjectStage.project_id == project_id,
            ProjectStage.order_index < payload.order_index,
            ProjectStage.status != StageStatus.APPROVED,
        )
        .limit(1)
    )
    unapproved_predecessor = result.scalar_one_or_none() is not None

    stage = ProjectStage(
        project_id=project_id,
        name=payload.name,
        order_index=payload.order_index,
        status=StageStatus.LOCKED if unapproved_predecessor else StageStatus.ACTIVE,
    )
    db.add(stage)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stage order already exists",
        ) from exc
    await db.refresh(stage)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="stage.create",
        entity_type="project_stage",
        entity_id=stage.id,
        metadata={
            "project_id": str(project_id),
            "order_index": stage.order_index,
            "status": stage.status.value,
        },
    )
    return stage


@router.post("/{stage_id}/approve", response_model=StageRead)
async def approve_stage(
    project_id: UUID,
    stage_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> ProjectStage:
    """Approve an ACTIVE stage and unlock the next LOCKED one (client only).

    Approval is sequential: the stage with the smallest order_index greater
    than the approved one becomes ACTIVE, regardless of creation order.
    """
    await require_client_member(db, project_id, current_user)
    await require_active_project(project_id, db)
    stage = await get_stage_or_404(db, project_id, stage_id)
    require_active_stage(stage)

    stage.status = StageStatus.APPROVED
    stage.approved_by = current_user.id
    stage.approved_at = datetime.now(timezone.utc)

    result = await db.execute(
        select(ProjectStage)
        .where(
            ProjectStage.project_id == project_id,
            ProjectStage.order_index > stage.order_index,
            ProjectStage.status == StageStatus.LOCKED,
        )
        .order_by(ProjectStage.order_index.asc())
        .limit(1)
    )
    next_stage = result.scalar_one_or_none()
    if next_stage is not None:
        next_stage.status = StageStatus.ACTIVE

    await db.commit()
    await db.refresh(stage)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="stage.approve",
        entity_type="project_stage",
        entity_id=stage.id,
        metadata={"project_id": str(project_id)},
    )
    if next_stage is not None:
        await log_audit(
            db,
            actor_user_id=current_user.id,
            action="stage.unlock",
            entity_type="project_stage",
            entity_id=next_stage.id,
            metadata={
                "project_id": str(project_id),
                "unlocked_by_stage_id": str(stage.id),
            },
        )
    return stage
