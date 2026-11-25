"""Versioned Project Asset Library endpoints."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_project_or_404,
    get_storage,
    require_project_access_from_path,
    require_team_member,
)
from ....db.session import get_db
from ....models.project_asset import (
    AssetCategory,
    AssetVersion,
    AssetVisibility,
    ProjectAsset,
)
from ....models.user import User, UserRole
from ....schemas.asset import (
    AssetUpdate,
    AssetVersionRead,
    ProjectAssetDetailRead,
    ProjectAssetRead,
)
from ....services.audit import log_audit
from ....services.storage import (
    ASSET_IMAGE_EXTENSIONS,
    LocalStorage,
    UploadTooLargeError,
    UploadValidationError,
    resolve_asset_type,
)

router = APIRouter()


def _user_display_map_entry(user: User | None) -> str | None:
    if user is None:
        return None
    return user.full_name or user.email


def _version_to_read(
    project_id: UUID,
    asset_id: UUID,
    version: AssetVersion,
    uploader_names: dict[UUID, str | None],
) -> AssetVersionRead:
    ext = (version.file_extension or "").lower()
    return AssetVersionRead(
        id=version.id,
        asset_id=asset_id,
        version_number=version.version_number,
        file_name=version.file_name,
        file_extension=ext,
        content_type=version.content_type,
        size_bytes=version.size_bytes,
        changelog=version.changelog,
        is_current=version.is_current,
        is_image=ext in ASSET_IMAGE_EXTENSIONS,
        file_url=f"/api/v1/projects/{project_id}/assets/{asset_id}/versions/{version.id}/file",
        uploaded_by=version.uploaded_by,
        uploaded_by_name=uploader_names.get(version.uploaded_by),
        created_at=version.created_at,
    )


async def _load_uploader_names(
    db: AsyncSession, user_ids: set[UUID]
) -> dict[UUID, str | None]:
    if not user_ids:
        return {}
    res = await db.execute(select(User).where(User.id.in_(user_ids)))
    return {u.id: _user_display_map_entry(u) for u in res.scalars().all()}


def _default_title_from_filename(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    cleaned = stem.replace("_", " ").replace("-", " ").strip()
    return (cleaned or "Asset")[:200]


@router.get("", response_model=list[ProjectAssetRead])
async def list_project_assets(
    project_id: UUID,
    category: AssetCategory | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectAssetRead]:
    """List assets in a project, enforcing visibility for CLIENT users."""
    await get_project_or_404(project_id, db)

    stmt = select(ProjectAsset).where(ProjectAsset.project_id == project_id)
    if current_user.role == UserRole.CLIENT:
        stmt = stmt.where(ProjectAsset.visibility == AssetVisibility.CLIENT_VISIBLE)
    if category is not None:
        stmt = stmt.where(ProjectAsset.category == category)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                ProjectAsset.title.ilike(pattern),
                ProjectAsset.description.ilike(pattern),
            )
        )
    stmt = stmt.order_by(ProjectAsset.updated_at.desc(), ProjectAsset.created_at.desc())

    assets = list((await db.execute(stmt)).scalars().all())
    if not assets:
        return []

    asset_ids = [a.id for a in assets]
    versions_res = await db.execute(
        select(AssetVersion)
        .where(AssetVersion.asset_id.in_(asset_ids))
        .order_by(AssetVersion.version_number.desc())
    )
    versions = list(versions_res.scalars().all())

    versions_by_asset: dict[UUID, list[AssetVersion]] = {}
    user_ids: set[UUID] = {a.uploaded_by for a in assets}
    for v in versions:
        versions_by_asset.setdefault(v.asset_id, []).append(v)
        user_ids.add(v.uploaded_by)

    uploader_names = await _load_uploader_names(db, user_ids)

    response_items: list[ProjectAssetRead] = []
    for asset in assets:
        asset_versions = versions_by_asset.get(asset.id, [])
        current_ver = next((v for v in asset_versions if v.is_current), None)
        if current_ver is None and asset_versions:
            current_ver = asset_versions[0]

        response_items.append(
            ProjectAssetRead(
                id=asset.id,
                project_id=asset.project_id,
                title=asset.title,
                description=asset.description,
                category=asset.category,
                visibility=asset.visibility,
                current_version_number=asset.current_version_number,
                version_count=len(asset_versions),
                uploaded_by=asset.uploaded_by,
                uploaded_by_name=uploader_names.get(asset.uploaded_by),
                current_version=(
                    _version_to_read(project_id, asset.id, current_ver, uploader_names)
                    if current_ver is not None
                    else None
                ),
                created_at=asset.created_at,
                updated_at=asset.updated_at,
            )
        )
    return response_items


@router.post("", response_model=ProjectAssetDetailRead, status_code=status.HTTP_201_CREATED)
async def create_project_asset(
    project_id: UUID,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    description: str | None = Form(default=None),
    category: AssetCategory = Form(default=AssetCategory.REFERENCES),
    visibility: AssetVisibility = Form(default=AssetVisibility.CLIENT_VISIBLE),
    changelog: str | None = Form(default=None),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> ProjectAssetDetailRead:
    """Upload a new asset and automatically initialize version v1."""
    await get_project_or_404(project_id, db)

    raw_filename = (file.filename or "asset").strip()[:255]
    if title is not None and len(title.strip()) > 200:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Title exceeds 200 characters",
        )
    if description is not None and len(description) > 2000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Description exceeds 2000 characters",
        )
    if changelog is not None and len(changelog) > 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Changelog exceeds 500 characters",
        )

    effective_category = category
    effective_visibility = visibility
    if current_user.role == UserRole.CLIENT:
        effective_category = AssetCategory.CLIENT_RESOURCES
        effective_visibility = AssetVisibility.CLIENT_VISIBLE

    data = await file.read()
    try:
        storage_key, ext, normalized_ct = await storage.save_asset(
            project_id, data, raw_filename, file.content_type
        )
    except UploadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds the 25 MiB limit",
        ) from exc
    except UploadValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    resolved_title = (
        title.strip() if title and title.strip() else _default_title_from_filename(raw_filename)
    )
    now = datetime.now(timezone.utc)
    asset = ProjectAsset(
        project_id=project_id,
        title=resolved_title,
        description=description.strip() if description and description.strip() else None,
        category=effective_category,
        visibility=effective_visibility,
        current_version_number=1,
        uploaded_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    await db.flush()

    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        file_name=raw_filename,
        file_extension=ext,
        content_type=normalized_ct,
        size_bytes=len(data),
        storage_key=storage_key,
        changelog=(
            changelog.strip()
            if changelog and changelog.strip()
            else "Versión inicial"
        ),
        is_current=True,
        uploaded_by=current_user.id,
        created_at=now,
    )
    db.add(version)
    await db.commit()
    await db.refresh(asset)
    await db.refresh(version)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="asset.create",
        entity_type="project_asset",
        entity_id=asset.id,
        metadata={
            "project_id": str(project_id),
            "title": asset.title,
            "category": asset.category.value,
            "visibility": asset.visibility.value,
            "file_name": version.file_name,
            "version_number": 1,
        },
    )

    uploader_names = {current_user.id: _user_display_map_entry(current_user)}
    ver_read = _version_to_read(project_id, asset.id, version, uploader_names)
    return ProjectAssetDetailRead(
        id=asset.id,
        project_id=asset.project_id,
        title=asset.title,
        description=asset.description,
        category=asset.category,
        visibility=asset.visibility,
        current_version_number=asset.current_version_number,
        version_count=1,
        uploaded_by=asset.uploaded_by,
        uploaded_by_name=uploader_names.get(asset.uploaded_by),
        current_version=ver_read,
        versions=[ver_read],
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


async def _get_asset_for_user(
    db: AsyncSession,
    project_id: UUID,
    asset_id: UUID,
    user: User,
) -> ProjectAsset:
    res = await db.execute(
        select(ProjectAsset).where(
            ProjectAsset.id == asset_id,
            ProjectAsset.project_id == project_id,
        )
    )
    asset = res.scalar_one_or_none()
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )
    if (
        user.role == UserRole.CLIENT
        and asset.visibility != AssetVisibility.CLIENT_VISIBLE
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )
    return asset


async def _build_asset_detail(
    db: AsyncSession,
    project_id: UUID,
    asset: ProjectAsset,
) -> ProjectAssetDetailRead:
    versions_res = await db.execute(
        select(AssetVersion)
        .where(AssetVersion.asset_id == asset.id)
        .order_by(AssetVersion.version_number.desc())
    )
    versions = list(versions_res.scalars().all())
    user_ids: set[UUID] = {asset.uploaded_by} | {v.uploaded_by for v in versions}
    uploader_names = await _load_uploader_names(db, user_ids)

    version_reads = [
        _version_to_read(project_id, asset.id, v, uploader_names) for v in versions
    ]
    current_ver = next((v for v in version_reads if v.is_current), None)
    if current_ver is None and version_reads:
        current_ver = version_reads[0]

    return ProjectAssetDetailRead(
        id=asset.id,
        project_id=asset.project_id,
        title=asset.title,
        description=asset.description,
        category=asset.category,
        visibility=asset.visibility,
        current_version_number=asset.current_version_number,
        version_count=len(version_reads),
        uploaded_by=asset.uploaded_by,
        uploaded_by_name=uploader_names.get(asset.uploaded_by),
        current_version=current_ver,
        versions=version_reads,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


@router.get("/{asset_id}", response_model=ProjectAssetDetailRead)
async def get_project_asset_detail(
    project_id: UUID,
    asset_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> ProjectAssetDetailRead:
    """Return full asset metadata and version history."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)
    return await _build_asset_detail(db, project_id, asset)


@router.patch("/{asset_id}", response_model=ProjectAssetDetailRead)
async def update_project_asset(
    project_id: UUID,
    asset_id: UUID,
    payload: AssetUpdate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> ProjectAssetDetailRead:
    """Update asset title, description, category or visibility (studio team only)."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)

    changes: dict[str, object] = {}
    if payload.title is not None:
        cleaned = payload.title.strip()
        if not cleaned:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Title cannot be empty",
            )
        asset.title = cleaned
        changes["title"] = cleaned
    if payload.description is not None:
        cleaned_desc = payload.description.strip()
        asset.description = cleaned_desc or None
        changes["description"] = asset.description
    if payload.category is not None:
        asset.category = payload.category
        changes["category"] = payload.category.value
    if payload.visibility is not None:
        asset.visibility = payload.visibility
        changes["visibility"] = payload.visibility.value

    if changes:
        asset.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(asset)
        await log_audit(
            db,
            actor_user_id=current_user.id,
            action="asset.update",
            entity_type="project_asset",
            entity_id=asset.id,
            metadata={"project_id": str(project_id), "changes": changes},
        )

    return await _build_asset_detail(db, project_id, asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_asset(
    project_id: UUID,
    asset_id: UUID,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> Response:
    """Delete an asset and all of its stored versions (studio team only)."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)

    versions_res = await db.execute(
        select(AssetVersion).where(AssetVersion.asset_id == asset.id)
    )
    versions = list(versions_res.scalars().all())
    for v in versions:
        try:
            path = storage.resolve(v.storage_key)
            if path.is_file():
                path.unlink(missing_ok=True)
        except UploadValidationError:
            pass

    title = asset.title
    await db.delete(asset)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="asset.delete",
        entity_type="project_asset",
        entity_id=asset_id,
        metadata={"project_id": str(project_id), "title": title},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{asset_id}/versions",
    response_model=ProjectAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_asset_version(
    project_id: UUID,
    asset_id: UUID,
    file: UploadFile = File(...),
    changelog: str | None = Form(default=None),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> ProjectAssetDetailRead:
    """Upload a new immutable version (v2, v3...) for an existing asset."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)

    if current_user.role == UserRole.CLIENT:
        if (
            asset.uploaded_by != current_user.id
            or asset.category != AssetCategory.CLIENT_RESOURCES
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clients can only version their own client resource assets",
            )

    if changelog is not None and len(changelog) > 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Changelog exceeds 500 characters",
        )

    raw_filename = (file.filename or "asset").strip()[:255]
    data = await file.read()
    try:
        storage_key, ext, normalized_ct = await storage.save_asset(
            project_id, data, raw_filename, file.content_type
        )
    except UploadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds the 25 MiB limit",
        ) from exc
    except UploadValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    max_ver_res = await db.execute(
        select(func.coalesce(func.max(AssetVersion.version_number), 0)).where(
            AssetVersion.asset_id == asset.id
        )
    )
    next_version_number = int(max_ver_res.scalar_one()) + 1

    await db.execute(
        update(AssetVersion)
        .where(AssetVersion.asset_id == asset.id)
        .values(is_current=False)
    )

    now = datetime.now(timezone.utc)
    new_version = AssetVersion(
        asset_id=asset.id,
        version_number=next_version_number,
        file_name=raw_filename,
        file_extension=ext,
        content_type=normalized_ct,
        size_bytes=len(data),
        storage_key=storage_key,
        changelog=changelog.strip() if changelog and changelog.strip() else None,
        is_current=True,
        uploaded_by=current_user.id,
        created_at=now,
    )
    db.add(new_version)
    asset.current_version_number = next_version_number
    asset.updated_at = now
    await db.commit()
    await db.refresh(asset)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="asset.version_create",
        entity_type="asset_version",
        entity_id=new_version.id,
        metadata={
            "project_id": str(project_id),
            "asset_id": str(asset.id),
            "version_number": next_version_number,
            "file_name": raw_filename,
            "changelog": new_version.changelog,
        },
    )

    return await _build_asset_detail(db, project_id, asset)


@router.post(
    "/{asset_id}/versions/{version_id}/restore",
    response_model=ProjectAssetDetailRead,
)
async def restore_asset_version(
    project_id: UUID,
    asset_id: UUID,
    version_id: UUID,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> ProjectAssetDetailRead:
    """Promote an existing historical version back to current (studio team only)."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)

    ver_res = await db.execute(
        select(AssetVersion).where(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
        )
    )
    target = ver_res.scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset version not found",
        )

    await db.execute(
        update(AssetVersion)
        .where(AssetVersion.asset_id == asset.id)
        .values(is_current=False)
    )
    target.is_current = True
    asset.current_version_number = target.version_number
    asset.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(asset)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="asset.version_restore",
        entity_type="asset_version",
        entity_id=target.id,
        metadata={
            "project_id": str(project_id),
            "asset_id": str(asset.id),
            "restored_version_number": target.version_number,
        },
    )

    return await _build_asset_detail(db, project_id, asset)


@router.get("/{asset_id}/versions/{version_id}/file")
async def download_asset_version_file(
    project_id: UUID,
    asset_id: UUID,
    version_id: UUID,
    download: bool = Query(default=False),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    storage: LocalStorage = Depends(get_storage),
) -> FileResponse:
    """Stream or download a specific asset version with RBAC and visibility enforcement."""
    await get_project_or_404(project_id, db)
    asset = await _get_asset_for_user(db, project_id, asset_id, current_user)

    ver_res = await db.execute(
        select(AssetVersion).where(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
        )
    )
    version = ver_res.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset version not found",
        )

    try:
        path = storage.resolve(version.storage_key)
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

    ext, normalized_ct = resolve_asset_type(version.file_name, version.content_type)
    headers: dict[str, str] = {"X-Content-Type-Options": "nosniff"}
    if ext == "svg":
        headers["Content-Security-Policy"] = "sandbox"

    if download:
        return FileResponse(
            path,
            media_type=normalized_ct,
            filename=version.file_name,
            headers=headers,
        )
    return FileResponse(
        path,
        media_type=normalized_ct,
        headers=headers,
    )
