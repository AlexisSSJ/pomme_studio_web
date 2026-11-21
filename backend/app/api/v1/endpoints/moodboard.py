"""Moodboard endpoints: inspiration uploads and client reactions."""

from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_membership,
    get_storage,
    require_active_project,
    require_project_access_from_path,
    require_roles,
    require_team_member,
)
from ....db.session import get_db
from ....models.moodboard_item import MoodboardItem
from ....models.moodboard_reaction import MoodboardReaction, ReactionType
from ....models.project_member import ProjectRole
from ....models.user import User, UserRole
from ....schemas.moodboard import (
    MoodboardItemRead,
    MoodboardReactionCreate,
    MoodboardReactionRead,
)
from ....services.audit import log_audit
from ....services.storage import (
    MOODBOARD_CONTENT_TYPES,
    LocalStorage,
    UploadTooLargeError,
    UploadValidationError,
)

router = APIRouter()


async def _get_scoped_item(
    db: AsyncSession, project_id: UUID, item_id: UUID
) -> MoodboardItem:
    """Return the item for `item_id` within `project_id` or raise 404.

    Every lookup filters on both the item id and the path project id, so
    cross-project ids are indistinguishable from missing ones.
    """
    result = await db.execute(
        select(MoodboardItem).where(
            MoodboardItem.id == item_id,
            MoodboardItem.project_id == project_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Moodboard item not found",
        )
    return item


async def _require_client_member(
    db: AsyncSession, project_id: UUID, current_user: User
) -> None:
    """Require a CLIENT membership on the project (client-only actions)."""
    member = await get_membership(db, project_id, current_user.id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )
    if member.assigned_role != ProjectRole.CLIENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )


@router.get("", response_model=list[MoodboardItemRead])
async def list_moodboard_items(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[MoodboardItemRead]:
    """List moodboard pieces with reaction counts (any member, any status)."""
    result = await db.execute(
        select(MoodboardItem)
        .where(MoodboardItem.project_id == project_id)
        .order_by(MoodboardItem.sort_order.asc(), MoodboardItem.created_at.asc())
    )
    items = list(result.scalars().all())
    if not items:
        return []

    item_ids = [item.id for item in items]

    counts: dict[tuple[UUID, ReactionType], int] = {}
    count_rows = await db.execute(
        select(
            MoodboardReaction.moodboard_item_id,
            MoodboardReaction.reaction,
            func.count(),
        )
        .where(MoodboardReaction.moodboard_item_id.in_(item_ids))
        .group_by(
            MoodboardReaction.moodboard_item_id,
            MoodboardReaction.reaction,
        )
    )
    for item_id, reaction, count in count_rows.all():
        counts[(item_id, reaction)] = count

    mine: dict[UUID, MoodboardReaction] = {}
    my_rows = await db.execute(
        select(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id.in_(item_ids),
            MoodboardReaction.user_id == current_user.id,
        )
    )
    for reaction in my_rows.scalars().all():
        mine[reaction.moodboard_item_id] = reaction

    reads = []
    for item in items:
        own = mine.get(item.id)
        reads.append(
            MoodboardItemRead.model_validate(item).model_copy(
                update={
                    "like_count": counts.get((item.id, ReactionType.LIKE), 0),
                    "dislike_count": counts.get((item.id, ReactionType.DISLIKE), 0),
                    "comment_count": counts.get((item.id, ReactionType.COMMENT), 0),
                    "my_reaction": own.reaction if own is not None else None,
                    "my_comment": own.comment if own is not None else None,
                }
            )
        )
    return reads


@router.post(
    "",
    response_model=MoodboardItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_moodboard_item(
    project_id: UUID,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1, max_length=255),
    description: str | None = Form(None),
    sort_order: int = Form(0),
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> MoodboardItem:
    """Upload a moodboard piece (studio team only, ACTIVE projects only)."""
    await require_active_project(project_id, db)

    data = await file.read()
    try:
        storage_key = await storage.save(
            project_id, data, file.content_type, MOODBOARD_CONTENT_TYPES
        )
    except UploadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds the 10 MiB limit",
        ) from exc
    except UploadValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unsupported file type",
        ) from exc

    item = MoodboardItem(
        project_id=project_id,
        title=title,
        description=description,
        file_name=(file.filename or "piece")[:255],
        content_type=file.content_type,
        size_bytes=len(data),
        storage_key=storage_key,
        sort_order=sort_order,
        created_by=current_user.id,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="moodboard.item_create",
        entity_type="moodboard_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "file_name": item.file_name,
            "size_bytes": item.size_bytes,
        },
    )
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_moodboard_item(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> None:
    """Delete a piece, its reactions and its file (team, ACTIVE only)."""
    await require_active_project(project_id, db)
    item = await _get_scoped_item(db, project_id, item_id)

    # Reactions first (explicit delete, no ORM cascade), then the stored
    # file, then the item itself.
    await db.execute(
        delete(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id == item.id
        )
    )
    await storage.delete(item.storage_key)
    await db.delete(item)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="moodboard.item_delete",
        entity_type="moodboard_item",
        entity_id=item.id,
        metadata={"project_id": str(project_id)},
    )


@router.get("/items/{item_id}/file")
async def download_moodboard_file(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download a moodboard piece (any member, any project status)."""
    item = await _get_scoped_item(db, project_id, item_id)

    try:
        path = storage.resolve(item.storage_key)
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

    return FileResponse(path, media_type=item.content_type, filename=item.file_name)


@router.post(
    "/items/{item_id}/reactions",
    response_model=MoodboardReactionRead,
    status_code=status.HTTP_201_CREATED,
)
async def react_to_moodboard_item(
    project_id: UUID,
    item_id: UUID,
    payload: MoodboardReactionCreate,
    response: Response,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> MoodboardReaction:
    """React to a piece (project client only, ACTIVE projects only).

    Upsert semantics: the caller holds at most one reaction per piece, so
    an existing reaction is updated (200) instead of duplicated (201).
    """
    await _require_client_member(db, project_id, current_user)
    await require_active_project(project_id, db)
    item = await _get_scoped_item(db, project_id, item_id)

    result = await db.execute(
        select(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id == item.id,
            MoodboardReaction.user_id == current_user.id,
        )
    )
    reaction = result.scalar_one_or_none()
    if reaction is not None:
        reaction.reaction = payload.reaction
        reaction.comment = payload.comment
        await db.commit()
        await db.refresh(reaction)
        response.status_code = status.HTTP_200_OK
    else:
        reaction = MoodboardReaction(
            moodboard_item_id=item.id,
            user_id=current_user.id,
            reaction=payload.reaction,
            comment=payload.comment,
        )
        db.add(reaction)
        await db.commit()
        await db.refresh(reaction)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="moodboard.reaction",
        entity_type="moodboard_reaction",
        entity_id=reaction.id,
        metadata={
            "project_id": str(project_id),
            "reaction": payload.reaction.value,
        },
    )
    return reaction


@router.delete(
    "/items/{item_id}/reactions",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_own_reaction(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove the caller's reaction (project client only, ACTIVE only)."""
    await _require_client_member(db, project_id, current_user)
    await require_active_project(project_id, db)
    item = await _get_scoped_item(db, project_id, item_id)

    result = await db.execute(
        select(MoodboardReaction).where(
            MoodboardReaction.moodboard_item_id == item.id,
            MoodboardReaction.user_id == current_user.id,
        )
    )
    reaction = result.scalar_one_or_none()
    if reaction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reaction not found",
        )

    reaction_id = reaction.id
    await db.delete(reaction)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="moodboard.reaction_delete",
        entity_type="moodboard_reaction",
        entity_id=reaction_id,
        metadata={"project_id": str(project_id)},
    )


@router.get("/items/{item_id}/reactions", response_model=list[MoodboardReactionRead])
async def list_moodboard_reactions(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[MoodboardReaction]:
    """List reactions on a piece (any member, any project status)."""
    item = await _get_scoped_item(db, project_id, item_id)
    result = await db.execute(
        select(MoodboardReaction)
        .where(MoodboardReaction.moodboard_item_id == item.id)
        .order_by(MoodboardReaction.created_at.asc())
    )
    return list(result.scalars().all())
