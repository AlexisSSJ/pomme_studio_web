"""Project brief endpoints: questionnaire, multimodal responses, autosave and reference uploads."""

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_current_active_user,
    get_membership,
    get_project_or_404,
    get_storage,
    require_active_project,
    require_project_access_from_path,
    require_roles,
    require_team_member,
)
from ....db.session import get_db
from ....models.brief_item import BriefCategory, BriefItem, BriefItemType, BriefStatus
from ....models.brief_item_image import BriefItemImage
from ....models.project import Project, ProjectStatus
from ....models.project_member import ProjectMember, ProjectRole
from ....models.user import User, UserRole
from ....schemas.brief import (
    BriefAnswerUpdate,
    BriefAutosaveItem,
    BriefAutosavePayload,
    BriefAutosaveResponse,
    BriefConfirmPayload,
    BriefImageRead,
    BriefItemRead,
    BriefPendingResponse,
    BriefQuestionCreate,
    BriefQuestionUpdate,
    BriefSendResponse,
    PendingBriefProjectSummary,
)
from ....services.audit import log_audit
from ....services.notifications import notify_project_client, notify_project_team
from ....services.storage import (
    BRIEF_REFERENCE_CONTENT_TYPES,
    BRIEF_RESPONSE_CONTENT_TYPES,
    CONTENT_TYPE_EXTENSIONS,
    LocalStorage,
    UploadTooLargeError,
    UploadValidationError,
)
from ....services.transcription import transcribe_audio

router = APIRouter()
client_brief_router = APIRouter()

# A brief question accepts at most two reference images.
MAX_BRIEF_ITEM_IMAGES = 2


def is_question_answered(item: BriefItem) -> bool:
    """Determine whether a brief question has been answered (multimodal or text)."""
    if item.status == BriefStatus.COMPLETED:
        return True
    if item.answer and item.answer.strip():
        return True
    if item.image_url or item.image_storage_key:
        return True
    if item.audio_url or item.audio_storage_key:
        return True
    if (item.audio_transcription and item.audio_transcription.strip()) or (
        item.transcription and item.transcription.strip()
    ):
        return True
    return False


def require_brief_sent(project: Project) -> None:
    """Block client answer actions until the studio sends the brief."""
    if project.brief_sent_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Brief is not ready to be answered",
        )


def client_sees_questions(project: Project, user: User) -> bool:
    """Questions are visible to team roles always and to CLIENTs after the send."""
    return user.role != UserRole.CLIENT or project.brief_sent_at is not None


async def compute_brief_progress(
    project_id: UUID, db: AsyncSession
) -> tuple[float, BriefStatus, int, int, list[BriefItem]]:
    """Calculate the brief progress percentage, overall status, total questions, answered questions and questions."""
    result = await db.execute(
        select(BriefItem)
        .where(
            BriefItem.project_id == project_id,
            BriefItem.item_type == BriefItemType.QUESTION,
        )
        .order_by(BriefItem.created_at.asc())
    )
    questions = list(result.scalars().all())
    total = len(questions)
    if total == 0:
        return 100.0, BriefStatus.PENDING, 0, 0, questions

    answered = sum(1 for q in questions if is_question_answered(q))
    progress = round((answered / total) * 100.0, 2)
    if answered == 0:
        status_val = BriefStatus.PENDING
    elif answered >= total:
        status_val = BriefStatus.COMPLETED
    else:
        status_val = BriefStatus.IN_PROGRESS
    return progress, status_val, total, answered, questions


async def _is_brief_completed(project_id: UUID, db: AsyncSession) -> bool:
    """Snapshot the brief's completion state before applying any changes."""
    return (await compute_brief_progress(project_id, db))[1] == BriefStatus.COMPLETED


async def _maybe_notify_completion(
    db: AsyncSession,
    project_id: UUID,
    actor_id: UUID,
    was_completed: bool,
) -> None:
    """Notify the studio team and audit a single False -> COMPLETED transition.

    Called after the answer has been committed. Re-saving an already completed
    brief is a no-op, so team members are never notified twice for one event.
    """
    if was_completed:
        return
    if not await _is_brief_completed(project_id, db):
        return

    project = await db.get(Project, project_id)
    if project is None:
        return

    payload = {"project_id": str(project_id), "project_title": project.title}
    await notify_project_team(
        db,
        project_id,
        event_type="brief.completed",
        payload=payload,
        exclude_user_id=actor_id,
    )
    await db.commit()
    await log_audit(
        db,
        actor_user_id=actor_id,
        action="brief.completed",
        entity_type="project",
        entity_id=project_id,
        metadata=payload,
    )


async def _populate_images_for_items(
    db: AsyncSession, project_id: UUID, items: list[BriefItem]
) -> None:
    """Attach the public image list to each item (empty for items without images)."""
    if not items:
        return

    item_ids = [item.id for item in items]
    result = await db.execute(
        select(BriefItemImage)
        .where(BriefItemImage.item_id.in_(item_ids))
        .order_by(BriefItemImage.position.asc())
    )

    images_by_item: dict[UUID, list[BriefImageRead]] = {item_id: [] for item_id in item_ids}
    for image in result.scalars().all():
        images_by_item.setdefault(image.item_id, []).append(
            BriefImageRead(
                id=image.id,
                item_id=image.item_id,
                position=image.position,
                content_type=image.content_type,
                size_bytes=image.size_bytes,
                url=(
                    f"/api/v1/projects/{project_id}/brief/items/"
                    f"{image.item_id}/images/{image.id}/media"
                ),
                created_at=image.created_at,
            )
        )

    for item in items:
        setattr(item, "images", images_by_item.get(item.id, []))


async def _get_question_or_404(
    db: AsyncSession, project_id: UUID, item_id: UUID
) -> BriefItem:
    """Return the question for `item_id` within `project_id` or raise 404.

    Filtering on both ids makes cross-project items indistinguishable from
    missing ones.
    """
    result = await db.execute(
        select(BriefItem).where(
            BriefItem.id == item_id,
            BriefItem.project_id == project_id,
            BriefItem.item_type == BriefItemType.QUESTION,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Brief item not found",
        )
    return item


async def _get_item_images(db: AsyncSession, item_id: UUID) -> list[BriefItemImage]:
    """Return the item's images ordered by position."""
    result = await db.execute(
        select(BriefItemImage)
        .where(BriefItemImage.item_id == item_id)
        .order_by(BriefItemImage.position.asc())
    )
    return list(result.scalars().all())


def _image_media_url(project_id: UUID, item_id: UUID, image_id: UUID) -> str:
    """Public URL of a single reference image."""
    return f"/api/v1/projects/{project_id}/brief/items/{item_id}/images/{image_id}/media"


def _sync_legacy_image_fields(item: BriefItem, images: list[BriefItemImage]) -> None:
    """Mirror the first image into the legacy columns, clearing them when none remain."""
    first = images[0] if images else None
    if first is None:
        item.image_storage_key = None
        item.image_url = None
        item.content_type = None
        return
    item.image_storage_key = first.storage_key
    item.image_url = _image_media_url(item.project_id, item.id, first.id)
    item.content_type = first.content_type


def _has_any_response(item: BriefItem) -> bool:
    """Content-based check that ignores status, used after removing media."""
    return bool(
        (item.answer and item.answer.strip())
        or item.image_storage_key
        or item.audio_storage_key
        or (item.audio_transcription and item.audio_transcription.strip())
        or (item.transcription and item.transcription.strip())
    )


def _guess_media_type(storage_key: str) -> str:
    """Derive a media type from the stored extension (legacy rows carry none)."""
    extension = Path(storage_key).suffix.lower()
    for content_type, known_extension in CONTENT_TYPE_EXTENSIONS.items():
        if known_extension == extension:
            return content_type
    return "application/octet-stream"


@router.get("", response_model=list[BriefItemRead])
async def list_brief_items(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[BriefItem]:
    """List the project brief, oldest first (any member, any status).

    A CLIENT only sees the references until the studio sends the brief;
    questions stay hidden while the project is still a draft.
    """
    project = await get_project_or_404(project_id, db)
    query = select(BriefItem).where(BriefItem.project_id == project_id)
    if not client_sees_questions(project, current_user):
        query = query.where(BriefItem.item_type == BriefItemType.REFERENCE)
    result = await db.execute(query.order_by(BriefItem.created_at.asc()))
    items = list(result.scalars().all())
    await _populate_images_for_items(db, project_id, items)
    return items


@router.post(
    "/questions",
    response_model=BriefItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_question(
    project_id: UUID,
    payload: BriefQuestionCreate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> BriefItem:
    """Create a brief question (studio team only, ACTIVE projects only)."""
    await require_active_project(project_id, db)

    item = BriefItem(
        project_id=project_id,
        item_type=BriefItemType.QUESTION,
        category=payload.category,
        prompt=payload.prompt,
        status=BriefStatus.PENDING,
        created_by=current_user.id,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.question_create",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "category": payload.category.value,
        },
    )
    return item


@router.patch("/questions/{item_id}", response_model=BriefItemRead)
async def update_question(
    project_id: UUID,
    item_id: UUID,
    payload: BriefQuestionUpdate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> BriefItem:
    """Edit a brief question's prompt and/or category (studio team only)."""
    await require_active_project(project_id, db)

    item = await _get_question_or_404(db, project_id, item_id)

    if payload.prompt is not None:
        item.prompt = payload.prompt
    if payload.category is not None:
        item.category = payload.category

    await db.commit()
    await db.refresh(item)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.question_update",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={"project_id": str(project_id)},
    )
    return item


@router.delete("/questions/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    project_id: UUID,
    item_id: UUID,
    force: bool = False,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> None:
    """Delete a brief question, refusing to discard answers unless `force=true`."""
    await require_active_project(project_id, db)

    item = await _get_question_or_404(db, project_id, item_id)
    had_response = is_question_answered(item)
    if had_response and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Question has responses; use force=true to delete",
        )

    images = await _get_item_images(db, item.id)
    child_keys = {image.storage_key for image in images}
    storage_keys = list(child_keys)
    if item.image_storage_key and item.image_storage_key not in child_keys:
        storage_keys.append(item.image_storage_key)
    if item.audio_storage_key:
        storage_keys.append(item.audio_storage_key)

    for storage_key in storage_keys:
        try:
            await storage.delete(storage_key)
        except UploadValidationError:
            # A malformed legacy key must not block the deletion.
            pass

    for image in images:
        await db.delete(image)
    await db.flush()
    await db.delete(item)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.question_delete",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "forced": force,
            "had_response": had_response,
            "removed_images": len(images),
        },
    )


@router.post("/send", response_model=BriefSendResponse)
async def send_brief(
    project_id: UUID,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> BriefSendResponse:
    """Release the brief to the client: opens the questionnaire and notifies them."""
    project = await require_active_project(project_id, db)

    # Conditional UPDATE instead of a read-then-set: two concurrent senders both
    # saw NULL and would each notify the client. Only the caller whose UPDATE
    # matched the still-NULL row wins; the other one reads rowcount == 0.
    result = await db.execute(
        update(Project)
        .where(Project.id == project_id, Project.brief_sent_at.is_(None))
        .values(brief_sent_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        # No write happened; get_db rolls the open transaction back when the
        # exception propagates (an explicit rollback would needlessly expire
        # every object in this session).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Brief already sent",
        )

    payload = {"project_id": str(project_id), "project_title": project.title}
    await notify_project_client(
        db,
        project_id,
        event_type="brief.ready",
        payload=payload,
        exclude_user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.sent",
        entity_type="project",
        entity_id=project_id,
        metadata=payload,
    )
    return BriefSendResponse(
        project_id=project.id,
        brief_sent_at=project.brief_sent_at,
    )


@router.patch("/items/{item_id}", response_model=BriefItemRead)
async def answer_question(
    project_id: UUID,
    item_id: UUID,
    payload: BriefAnswerUpdate,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> BriefItem:
    """Answer a brief question (the project client only, ACTIVE projects only)."""
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    result = await db.execute(
        select(BriefItem).where(
            BriefItem.id == item_id,
            BriefItem.project_id == project_id,
            BriefItem.item_type == BriefItemType.QUESTION,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Brief item not found",
        )

    was_completed = await _is_brief_completed(project_id, db)

    if payload.answer is not None:
        item.answer = payload.answer
    if payload.image_url is not None:
        item.image_url = payload.image_url
    if payload.image_storage_key is not None:
        item.image_storage_key = payload.image_storage_key
    if payload.audio_url is not None:
        item.audio_url = payload.audio_url
    if payload.audio_storage_key is not None:
        item.audio_storage_key = payload.audio_storage_key
    if payload.audio_transcription is not None:
        item.audio_transcription = payload.audio_transcription
        if item.transcription is None:
            item.transcription = payload.audio_transcription
    if payload.transcription is not None:
        # The client's edited text is authoritative: mirror it into both columns
        # so a reload (which hydrates from audio_transcription) does not revive
        # the old service transcription.
        item.transcription = payload.transcription
        item.audio_transcription = payload.transcription
    if payload.response_type is not None:
        item.response_type = payload.response_type

    if payload.status is not None:
        item.status = payload.status
    else:
        # Automatically update status if answered
        if is_question_answered(item):
            item.status = BriefStatus.COMPLETED
        else:
            item.status = BriefStatus.IN_PROGRESS

    await db.commit()
    await _maybe_notify_completion(db, project_id, current_user.id, was_completed)
    await db.refresh(item)

    progress, _, _, _, _ = await compute_brief_progress(project_id, db)
    setattr(item, "progress", progress)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.answer",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={"project_id": str(project_id)},
    )
    return item


async def _apply_autosave(
    project_id: UUID,
    payload: BriefAutosavePayload,
    current_user: User,
    db: AsyncSession,
) -> BriefAutosaveResponse:
    """Internal helper to process brief autosave and compute overall progress."""
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    was_completed = await _is_brief_completed(project_id, db)

    items_to_update: list[BriefAutosaveItem] = []
    if payload.items:
        items_to_update.extend(payload.items)
    if payload.item_id:
        items_to_update.append(
            BriefAutosaveItem(
                item_id=payload.item_id,
                answer=payload.answer,
                status=payload.status,
                response_type=payload.response_type,
                image_url=payload.image_url,
                image_storage_key=payload.image_storage_key,
                audio_url=payload.audio_url,
                audio_storage_key=payload.audio_storage_key,
                audio_transcription=payload.audio_transcription,
                transcription=payload.transcription,
            )
        )

    updated_brief_items: list[BriefItem] = []
    for update in items_to_update:
        res = await db.execute(
            select(BriefItem).where(
                BriefItem.id == update.item_id,
                BriefItem.project_id == project_id,
                BriefItem.item_type == BriefItemType.QUESTION,
            )
        )
        item = res.scalar_one_or_none()
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brief item not found: {update.item_id}",
            )

        if update.answer is not None:
            item.answer = update.answer
        if update.image_url is not None:
            item.image_url = update.image_url
        if update.image_storage_key is not None:
            item.image_storage_key = update.image_storage_key
        if update.audio_url is not None:
            item.audio_url = update.audio_url
        if update.audio_storage_key is not None:
            item.audio_storage_key = update.audio_storage_key
        if update.audio_transcription is not None:
            item.audio_transcription = update.audio_transcription
            if item.transcription is None:
                item.transcription = update.audio_transcription
        if update.transcription is not None:
            # Same sync as answer_question: an edited transcription wins in both
            # columns, otherwise a reload would show the stale service text.
            item.transcription = update.transcription
            item.audio_transcription = update.transcription
        if update.response_type is not None:
            item.response_type = update.response_type

        if update.status is not None:
            item.status = update.status
        else:
            if is_question_answered(item):
                item.status = BriefStatus.COMPLETED
            else:
                item.status = BriefStatus.IN_PROGRESS

        updated_brief_items.append(item)

    await db.commit()
    await _maybe_notify_completion(db, project_id, current_user.id, was_completed)

    for item in updated_brief_items:
        await db.refresh(item)

    progress, overall_status, total, answered, all_questions = await compute_brief_progress(
        project_id, db
    )
    await _populate_images_for_items(db, project_id, all_questions)

    primary_item = updated_brief_items[0] if updated_brief_items else None
    if primary_item:
        setattr(primary_item, "progress", progress)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.autosave",
        entity_type="brief_item",
        entity_id=primary_item.id if primary_item else project_id,
        metadata={
            "project_id": str(project_id),
            "progress": progress,
            "status": overall_status.value,
        },
    )

    return BriefAutosaveResponse(
        project_id=project_id,
        progress=progress,
        progress_percentage=progress,
        status=overall_status,
        total_questions=total,
        answered_questions=answered,
        pending_questions=max(0, total - answered),
        item=BriefItemRead.model_validate(primary_item) if primary_item else None,
        items=[BriefItemRead.model_validate(q) for q in all_questions],
    )


@router.patch("/autosave", response_model=BriefAutosaveResponse)
async def autosave_brief(
    project_id: UUID,
    payload: BriefAutosavePayload,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> BriefAutosaveResponse:
    """Autosave one or multiple questions in the brief with real-time progress calculation."""
    return await _apply_autosave(project_id, payload, current_user, db)


@router.patch("/items/{item_id}/autosave", response_model=BriefAutosaveResponse)
async def autosave_brief_item(
    project_id: UUID,
    item_id: UUID,
    payload: BriefAnswerUpdate,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> BriefAutosaveResponse:
    """Autosave a single brief question by item_id with progress calculation."""
    autosave_payload = BriefAutosavePayload(
        item_id=item_id,
        answer=payload.answer,
        status=payload.status,
        response_type=payload.response_type,
        image_url=payload.image_url,
        image_storage_key=payload.image_storage_key,
        audio_url=payload.audio_url,
        audio_storage_key=payload.audio_storage_key,
        audio_transcription=payload.audio_transcription,
        transcription=payload.transcription,
    )
    return await _apply_autosave(project_id, autosave_payload, current_user, db)


@router.get("/pending", response_model=BriefPendingResponse)
@router.get("/status", response_model=BriefPendingResponse)
async def get_project_brief_status(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> BriefPendingResponse:
    """Consult the brief progress and pending status for this project."""
    project = await get_project_or_404(project_id, db)
    if not client_sees_questions(project, current_user):
        # Pre-send: the client has no questionnaire yet, only references.
        return BriefPendingResponse(
            brief_sent=False,
            has_pending_brief=False,
            project_id=project.id,
            project_title=project.title,
            status=None,
            progress=0.0,
            total_questions=0,
            answered_questions=0,
            pending_questions=0,
            items=[],
            pending_briefs=[],
        )

    progress, status_val, total, answered, questions = await compute_brief_progress(
        project_id, db
    )
    await _populate_images_for_items(db, project_id, questions)
    pending_count = max(0, total - answered)
    is_pending = total > 0 and answered < total and project.status == ProjectStatus.ACTIVE

    item_reads = [BriefItemRead.model_validate(q) for q in questions]
    summary = PendingBriefProjectSummary(
        project_id=project.id,
        project_title=project.title,
        status=status_val,
        progress=progress,
        total_questions=total,
        answered_questions=answered,
        pending_questions=pending_count,
    )

    return BriefPendingResponse(
        brief_sent=project.brief_sent_at is not None,
        has_pending_brief=is_pending,
        project_id=project.id,
        project_title=project.title,
        status=status_val,
        progress=progress,
        total_questions=total,
        answered_questions=answered,
        pending_questions=pending_count,
        items=item_reads,
        pending_briefs=[summary] if is_pending else [],
    )


@client_brief_router.get("/pending", response_model=BriefPendingResponse)
@client_brief_router.get("/status", response_model=BriefPendingResponse)
async def get_client_pending_brief(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> BriefPendingResponse:
    """Consult the pending brief for the logged-in client (for the pending brief indicator)."""
    # Active projects where the caller is client or project member
    if current_user.role == UserRole.SUPER_ADMIN:
        proj_result = await db.execute(
            select(Project)
            .where(Project.status == ProjectStatus.ACTIVE)
            .order_by(desc(Project.created_at))
        )
    else:
        proj_result = await db.execute(
            select(Project)
            .where(
                Project.status == ProjectStatus.ACTIVE,
                (Project.client_id == current_user.id)
                | (
                    Project.id.in_(
                        select(ProjectMember.project_id).where(
                            ProjectMember.user_id == current_user.id,
                            ProjectMember.assigned_role == ProjectRole.CLIENT,
                        )
                    )
                ),
            )
            .order_by(desc(Project.created_at))
        )
    projects = list(proj_result.scalars().all())

    pending_summaries: list[PendingBriefProjectSummary] = []
    primary_project: Project | None = None
    primary_progress: float = 0.0
    primary_status: BriefStatus = BriefStatus.PENDING
    primary_total: int = 0
    primary_answered: int = 0
    primary_questions: list[BriefItem] = []
    primary_sent: bool = False
    # Projects the caller can actually see: unsent drafts are skipped below and
    # must not count as "everything done" for the fallback progress.
    visible_projects = 0

    for proj in projects:
        # Unsent briefs (studio drafts) are invisible to the client indicator.
        if not client_sees_questions(proj, current_user):
            continue
        visible_projects += 1
        prog, stat, tot, ans, q_list = await compute_brief_progress(proj.id, db)
        p_count = max(0, tot - ans)
        if tot > 0 and ans < tot:
            summary = PendingBriefProjectSummary(
                project_id=proj.id,
                project_title=proj.title,
                status=stat,
                progress=prog,
                total_questions=tot,
                answered_questions=ans,
                pending_questions=p_count,
            )
            pending_summaries.append(summary)
            if primary_project is None:
                primary_project = proj
                primary_progress = prog
                primary_status = stat
                primary_total = tot
                primary_answered = ans
                primary_questions = q_list
                primary_sent = proj.brief_sent_at is not None

    if primary_project is not None:
        await _populate_images_for_items(db, primary_project.id, primary_questions)
        return BriefPendingResponse(
            brief_sent=primary_sent,
            has_pending_brief=True,
            project_id=primary_project.id,
            project_title=primary_project.title,
            status=primary_status,
            progress=primary_progress,
            total_questions=primary_total,
            answered_questions=primary_answered,
            pending_questions=max(0, primary_total - primary_answered),
            items=[BriefItemRead.model_validate(q) for q in primary_questions],
            pending_briefs=pending_summaries,
        )

    return BriefPendingResponse(
        brief_sent=False,
        has_pending_brief=False,
        project_id=None,
        project_title=None,
        status=None,
        progress=100.0 if visible_projects else 0.0,
        total_questions=0,
        answered_questions=0,
        pending_questions=0,
        items=[],
        pending_briefs=[],
    )


@router.post(
    "/items/{item_id}/response-file",
    response_model=BriefItemRead,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/items/{item_id}/upload",
    response_model=BriefItemRead,
    status_code=status.HTTP_200_OK,
)
async def upload_response_file(
    project_id: UUID,
    item_id: UUID,
    file: UploadFile = File(...),
    transcription: str | None = Form(None),
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> BriefItem:
    """Upload multimodal media (image or audio) answering a brief question."""
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    item = await _get_question_or_404(db, project_id, item_id)

    was_completed = await _is_brief_completed(project_id, db)

    is_audio = (file.content_type or "").startswith("audio/")
    existing_images: list[BriefItemImage] = []
    if not is_audio:
        existing_images = await _get_item_images(db, item.id)
        if len(existing_images) >= MAX_BRIEF_ITEM_IMAGES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Maximum of 2 images per question",
            )

    data = await file.read()
    try:
        storage_key = await storage.save(
            project_id, data, file.content_type, BRIEF_RESPONSE_CONTENT_TYPES
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

    media_url = f"/api/v1/projects/{project_id}/brief/items/{item.id}/media"

    previous_audio_key: str | None = None
    if is_audio:
        # A re-upload replaces the previous recording; text and images stay.
        previous_audio_key = item.audio_storage_key
        if previous_audio_key == storage_key:
            previous_audio_key = None
        if previous_audio_key:
            try:
                await storage.delete(previous_audio_key)
            except UploadValidationError:
                pass

        item.audio_storage_key = storage_key
        item.audio_url = media_url
        item.response_type = "audio"

        if transcription:
            item.audio_transcription = transcription
            item.transcription = transcription
        else:
            text = await transcribe_audio(data, file.content_type or "")
            if text:
                item.audio_transcription = text
                item.transcription = text
    else:
        # A legacy key that never reached the child table would be orphaned by
        # this upload, so drop its file (migrated keys are kept).
        if item.image_storage_key and not any(
            image.storage_key == item.image_storage_key for image in existing_images
        ):
            try:
                await storage.delete(item.image_storage_key)
            except UploadValidationError:
                pass

        db.add(
            BriefItemImage(
                item_id=item.id,
                storage_key=storage_key,
                content_type=file.content_type,
                size_bytes=len(data),
                position=max((image.position for image in existing_images), default=0) + 1,
            )
        )
        try:
            await db.flush()
        except IntegrityError as exc:
            # A concurrent upload claimed the same position after our count.
            await db.rollback()
            try:
                await storage.delete(storage_key)
            except UploadValidationError:
                pass
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Maximum of 2 images per question",
            ) from exc

        _sync_legacy_image_fields(item, await _get_item_images(db, item.id))
        item.response_type = "image"

    item.status = BriefStatus.COMPLETED
    await db.commit()
    await _maybe_notify_completion(db, project_id, current_user.id, was_completed)
    await db.refresh(item)

    progress, _, _, _, _ = await compute_brief_progress(project_id, db)
    setattr(item, "progress", progress)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.response_upload",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "content_type": file.content_type,
            "response_type": item.response_type,
        },
    )
    return item


@router.delete(
    "/items/{item_id}/images/{image_id}",
    response_model=BriefItemRead,
    status_code=status.HTTP_200_OK,
)
async def delete_item_image(
    project_id: UUID,
    item_id: UUID,
    image_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> BriefItem:
    """Remove one reference image from a question and resync the legacy columns."""
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    item = await _get_question_or_404(db, project_id, item_id)

    result = await db.execute(
        select(BriefItemImage).where(
            BriefItemImage.id == image_id,
            BriefItemImage.item_id == item.id,
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    try:
        await storage.delete(image.storage_key)
    except UploadValidationError:
        # A malformed legacy key must not turn a delete into a 500.
        pass

    await db.delete(image)
    await db.flush()

    remaining = await _get_item_images(db, item.id)
    for position, remaining_image in enumerate(remaining, start=1):
        remaining_image.position = position
    await db.flush()

    _sync_legacy_image_fields(item, remaining)
    if not _has_any_response(item):
        item.status = BriefStatus.PENDING

    await db.commit()
    await db.refresh(item)

    progress, _, _, _, _ = await compute_brief_progress(project_id, db)
    setattr(item, "progress", progress)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.image_delete",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "image_id": str(image_id),
            "remaining_images": len(remaining),
        },
    )
    return item


@router.delete(
    "/items/{item_id}/audio",
    response_model=BriefItemRead,
    status_code=status.HTTP_200_OK,
)
async def delete_item_audio(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> BriefItem:
    """Remove the voice note from a question; text and images are preserved."""
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    item = await _get_question_or_404(db, project_id, item_id)
    if not item.audio_storage_key and not item.audio_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio not found",
        )

    if item.audio_storage_key:
        try:
            await storage.delete(item.audio_storage_key)
        except UploadValidationError:
            # A malformed legacy key must not turn a delete into a 500.
            pass

    item.audio_storage_key = None
    item.audio_url = None
    # The transcription belongs to the removed recording; drop both mirrors.
    item.audio_transcription = None
    item.transcription = None
    if item.response_type == "audio":
        item.response_type = None
    # Removing part of the answer invalidates the client's "finished" seal.
    item.client_confirmed = False
    if not _has_any_response(item):
        item.status = BriefStatus.PENDING

    await db.commit()
    await db.refresh(item)

    progress, _, _, _, _ = await compute_brief_progress(project_id, db)
    setattr(item, "progress", progress)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.audio_delete",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={"project_id": str(project_id)},
    )
    return item


@router.post(
    "/items/{item_id}/confirm",
    response_model=BriefItemRead,
    status_code=status.HTTP_200_OK,
)
async def confirm_item(
    project_id: UUID,
    item_id: UUID,
    payload: BriefConfirmPayload,
    current_user: User = Depends(require_roles(UserRole.CLIENT)),
    db: AsyncSession = Depends(get_db),
) -> BriefItem:
    """Explicit client seal: mark a question as finished, or reopen it.

    Independent from the automatic answered-based status and progress: the
    seal only records the client's declaration that the answer is final.
    """
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

    project = await require_active_project(project_id, db)
    require_brief_sent(project)

    item = await _get_question_or_404(db, project_id, item_id)
    if payload.confirmed and not is_question_answered(item):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Question has no response to confirm",
        )

    item.client_confirmed = payload.confirmed

    await db.commit()
    await db.refresh(item)

    progress, _, _, _, _ = await compute_brief_progress(project_id, db)
    setattr(item, "progress", progress)
    await _populate_images_for_items(db, project_id, [item])

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.confirm",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "confirmed": payload.confirmed,
        },
    )
    return item


@router.get("/items/{item_id}/images/{image_id}/media")
async def download_item_image_media(
    project_id: UUID,
    item_id: UUID,
    image_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download one reference image of a question."""
    project = await get_project_or_404(project_id, db)
    if not client_sees_questions(project, current_user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Brief item not found",
        )

    item = await _get_question_or_404(db, project_id, item_id)

    result = await db.execute(
        select(BriefItemImage).where(
            BriefItemImage.id == image_id,
            BriefItemImage.item_id == item.id,
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    try:
        path = storage.resolve(image.storage_key)
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
        path, media_type=image.content_type or "application/octet-stream"
    )


@router.get("/items/{item_id}/media")
async def download_response_media(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download the question's audio, or its first image, as the legacy single-media endpoint."""
    project = await get_project_or_404(project_id, db)
    if not client_sees_questions(project, current_user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Brief item not found",
        )

    item = await _get_question_or_404(db, project_id, item_id)

    if item.audio_storage_key:
        storage_key = item.audio_storage_key
        media_type = None
    else:
        images = await _get_item_images(db, item.id)
        first = images[0] if images else None
        storage_key = first.storage_key if first else item.image_storage_key
        media_type = first.content_type if first else item.content_type

    if storage_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    try:
        path = storage.resolve(storage_key)
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

    return FileResponse(path, media_type=media_type or _guess_media_type(storage_key))


@router.post(
    "/references",
    response_model=BriefItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_reference(
    project_id: UUID,
    file: UploadFile = File(...),
    category: BriefCategory = Form(...),
    note: str | None = Form(None),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> BriefItem:
    """Upload a reference file to the brief (any member, ACTIVE projects only)."""
    await require_active_project(project_id, db)

    if note is not None and len(note) > 1000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Note exceeds the 1000 character limit",
        )

    data = await file.read()
    try:
        storage_key = await storage.save(
            project_id, data, file.content_type, BRIEF_REFERENCE_CONTENT_TYPES
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

    item = BriefItem(
        project_id=project_id,
        item_type=BriefItemType.REFERENCE,
        category=category,
        status=BriefStatus.COMPLETED,
        note=note,
        file_name=(file.filename or "reference")[:255],
        content_type=file.content_type,
        size_bytes=len(data),
        storage_key=storage_key,
        created_by=current_user.id,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.reference_upload",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={
            "project_id": str(project_id),
            "file_name": item.file_name,
            "size_bytes": item.size_bytes,
        },
    )
    return item


@router.get("/items/{item_id}/file")
async def download_reference_file(
    project_id: UUID,
    item_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Download a reference file (any member, any project status)."""
    result = await db.execute(
        select(BriefItem).where(
            BriefItem.id == item_id,
            BriefItem.project_id == project_id,
            BriefItem.item_type == BriefItemType.REFERENCE,
        )
    )
    item = result.scalar_one_or_none()
    if item is None or item.storage_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Brief item not found",
        )

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
