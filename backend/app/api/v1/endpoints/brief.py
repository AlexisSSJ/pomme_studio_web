"""Project brief endpoints: questionnaire and reference uploads."""

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
from sqlalchemy import select
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
from ....models.brief_item import BriefCategory, BriefItem, BriefItemType
from ....models.project_member import ProjectRole
from ....models.user import User, UserRole
from ....schemas.brief import BriefAnswerUpdate, BriefItemRead, BriefQuestionCreate
from ....services.audit import log_audit
from ....services.storage import (
    BRIEF_REFERENCE_CONTENT_TYPES,
    LocalStorage,
    UploadTooLargeError,
    UploadValidationError,
)

router = APIRouter()


@router.get("", response_model=list[BriefItemRead])
async def list_brief_items(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[BriefItem]:
    """List the project brief, oldest first (any member, any status)."""
    result = await db.execute(
        select(BriefItem)
        .where(BriefItem.project_id == project_id)
        .order_by(BriefItem.created_at.asc())
    )
    return list(result.scalars().all())


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

    await require_active_project(project_id, db)

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

    item.answer = payload.answer
    await db.commit()
    await db.refresh(item)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="brief.answer",
        entity_type="brief_item",
        entity_id=item.id,
        metadata={"project_id": str(project_id)},
    )
    return item


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
