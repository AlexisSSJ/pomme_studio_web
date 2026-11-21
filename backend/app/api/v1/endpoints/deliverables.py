"""Deliverable endpoints: version reads, file download, pins and approval."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_deliverable_or_404,
    get_stage_or_404,
    get_storage,
    require_active_project,
    require_active_stage,
    require_client_member,
    require_deliverable_visible,
    require_project_access_from_path,
    require_roles,
    require_team_member,
)
from ....db.session import get_db
from ....models.deliverable import Deliverable, DeliverableStatus
from ....models.deliverable_comment import DeliverableComment
from ....models.user import User, UserRole
from ....schemas.deliverable import (
    DeliverableCommentCreate,
    DeliverableCommentRead,
    DeliverableFinalHandover,
    DeliverablePublish,
    DeliverableRead,
)
from ....services.audit import log_audit
from ....services.storage import LocalStorage, UploadValidationError

router = APIRouter()


@router.get("/{deliverable_id}", response_model=DeliverableRead)
async def get_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """Read one deliverable version.

    Team roles see every version; CLIENT callers only see published ones.
    """
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)
    return deliverable


@router.get("/{deliverable_id}/file")
async def download_deliverable_file(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download a deliverable file (published ones only for CLIENT callers)."""
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)

    try:
        path = storage.resolve(deliverable.storage_key)
    except UploadValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        ) from exc
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    return FileResponse(
        path,
        media_type=deliverable.content_type,
        filename=deliverable.file_name,
    )


@router.get(
    "/{deliverable_id}/comments",
    response_model=list[DeliverableCommentRead],
)
async def list_deliverable_comments(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[DeliverableComment]:
    """List a deliverable's pins in creation order (published only for CLIENT)."""
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)
    result = await db.execute(
        select(DeliverableComment)
        .where(DeliverableComment.deliverable_id == deliverable.id)
        .order_by(DeliverableComment.created_at.asc())
    )
    return list(result.scalars().all())


@router.post(
    "/{deliverable_id}/comments",
    response_model=DeliverableCommentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_deliverable_comment(
    project_id: UUID,
    deliverable_id: UUID,
    payload: DeliverableCommentCreate,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> DeliverableComment:
    """Pin a comment on an in-review deliverable (project client only).

    The pin belongs to the current change round, computed from the
    project's consumed rounds; it does not consume a round itself.
    """
    await require_client_member(db, project_id, current_user)
    project = await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)
    stage = await get_stage_or_404(db, project_id, deliverable.stage_id)
    require_active_stage(stage)
    if deliverable.status != DeliverableStatus.IN_REVIEW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Deliverable is not in review",
        )

    comment = DeliverableComment(
        deliverable_id=deliverable.id,
        created_by=current_user.id,
        x_pct=payload.x_pct,
        y_pct=payload.y_pct,
        page_or_frame=payload.page_or_frame,
        body=payload.body,
        round_number=project.included_rounds - project.remaining_rounds + 1,
        consumes_round=False,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.comment",
        entity_type="deliverable_comment",
        entity_id=comment.id,
        metadata={
            "project_id": str(project_id),
            "deliverable_id": str(deliverable.id),
            "round_number": comment.round_number,
        },
    )
    return comment


@router.post("/{deliverable_id}/approve", response_model=DeliverableRead)
async def approve_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """Approve an in-review deliverable version (project client only)."""
    await require_client_member(db, project_id, current_user)
    await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)
    stage = await get_stage_or_404(db, project_id, deliverable.stage_id)
    require_active_stage(stage)
    if deliverable.status == DeliverableStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Deliverable is already approved",
        )

    deliverable.status = DeliverableStatus.APPROVED
    await db.commit()
    await db.refresh(deliverable)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.approve",
        entity_type="deliverable",
        entity_id=deliverable.id,
        metadata={"project_id": str(project_id)},
    )
    return deliverable


@router.post("/{deliverable_id}/request-changes", response_model=DeliverableRead)
async def request_changes(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """Request changes on an in-review deliverable, consuming one change round.

    The project must have remaining rounds; existing pins are not required,
    but any unconsumed pin on this deliverable is marked as consumed. The
    decrement, the pin consumption and the status flip happen in a single
    transaction.
    """
    await require_client_member(db, project_id, current_user)
    project = await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
    require_deliverable_visible(deliverable, current_user)
    stage = await get_stage_or_404(db, project_id, deliverable.stage_id)
    require_active_stage(stage)
    if deliverable.status != DeliverableStatus.IN_REVIEW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Deliverable is not in review",
        )
    if project.remaining_rounds <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No remaining change rounds",
        )

    project.remaining_rounds -= 1
    result = await db.execute(
        select(DeliverableComment).where(
            DeliverableComment.deliverable_id == deliverable.id,
            DeliverableComment.consumes_round.is_(False),
        )
    )
    for comment in result.scalars().all():
        comment.consumes_round = True
    deliverable.status = DeliverableStatus.CHANGES_REQUESTED
    await db.commit()
    await db.refresh(project)
    await db.refresh(deliverable)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.changes_requested",
        entity_type="deliverable",
        entity_id=deliverable.id,
        metadata={
            "project_id": str(project_id),
            "deliverable_id": str(deliverable.id),
            "stage_id": str(deliverable.stage_id),
            "remaining_rounds": project.remaining_rounds,
            "consumed_round": project.included_rounds - project.remaining_rounds,
        },
    )
    return deliverable


@router.post("/{deliverable_id}/publish", response_model=DeliverableRead)
async def publish_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    payload: DeliverablePublish,
    current_user: User = Depends(
        require_roles(UserRole.LEAD_DESIGNER, UserRole.SUPER_ADMIN)
    ),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """Publish a deliverable version to the client portal.

    Only LEAD_DESIGNER and SUPER_ADMIN members of the project may
    publish: the role gate rejects COLLABORATOR (and CLIENT) callers with
    403 "Insufficient permissions" even though they can upload drafts.
    """
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)

    deliverable.is_client_visible = True
    deliverable.is_final_handover = payload.is_final_handover
    deliverable.published_at = datetime.now(timezone.utc)
    deliverable.published_by = current_user.id
    await db.commit()
    await db.refresh(deliverable)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.publish",
        entity_type="deliverable",
        entity_id=deliverable.id,
        metadata={
            "project_id": str(project_id),
            "is_final_handover": deliverable.is_final_handover,
        },
    )
    return deliverable


@router.post("/{deliverable_id}/unpublish", response_model=DeliverableRead)
async def unpublish_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(
        require_roles(UserRole.LEAD_DESIGNER, UserRole.SUPER_ADMIN)
    ),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """Hide a published deliverable version from the client portal again."""
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)

    deliverable.is_client_visible = False
    await db.commit()
    await db.refresh(deliverable)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.unpublish",
        entity_type="deliverable",
        entity_id=deliverable.id,
        metadata={"project_id": str(project_id)},
    )
    return deliverable


@router.post("/{deliverable_id}/final-handover", response_model=DeliverableRead)
async def mark_final_handover(
    project_id: UUID,
    deliverable_id: UUID,
    payload: DeliverableFinalHandover,
    current_user: User = Depends(
        require_roles(UserRole.LEAD_DESIGNER, UserRole.SUPER_ADMIN)
    ),
    db: AsyncSession = Depends(get_db),
) -> Deliverable:
    """(Un)mark a deliverable version as the project's final handover."""
    await require_team_member(project_id=project_id, current_user=current_user, db=db)
    await require_active_project(project_id, db)
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)

    deliverable.is_final_handover = payload.is_final_handover
    await db.commit()
    await db.refresh(deliverable)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="deliverable.final_handover",
        entity_type="deliverable",
        entity_id=deliverable.id,
        metadata={
            "project_id": str(project_id),
            "is_final_handover": deliverable.is_final_handover,
        },
    )
    return deliverable
