"""Deliverable endpoints: version reads, file download, pins and approval."""

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
    require_project_access_from_path,
    require_roles,
)
from ....db.session import get_db
from ....models.deliverable import Deliverable, DeliverableStatus
from ....models.deliverable_comment import DeliverableComment
from ....models.user import User, UserRole
from ....schemas.deliverable import (
    DeliverableCommentCreate,
    DeliverableCommentRead,
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
    """Read one deliverable version (any member, any status)."""
    return await get_deliverable_or_404(db, project_id, deliverable_id)


@router.get("/{deliverable_id}/file")
async def download_deliverable_file(
    project_id: UUID,
    deliverable_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download a deliverable file (any member, any project status)."""
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)

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
    """List a deliverable's pins in creation order (any member, any status)."""
    deliverable = await get_deliverable_or_404(db, project_id, deliverable_id)
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
