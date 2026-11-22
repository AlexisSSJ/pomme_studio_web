"""Project FF&E specification endpoints: catalog CRUD with RBAC and audit."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_specification_or_404,
    require_active_project,
    require_project_access_from_path,
    require_team_member,
)
from ....db.session import get_db
from ....models.project_specification import ProjectSpecification
from ....models.user import User
from ....schemas.specification import (
    SpecificationCreate,
    SpecificationRead,
    SpecificationUpdate,
)
from ....services.audit import log_audit

router = APIRouter()


@router.get("", response_model=list[SpecificationRead])
async def list_specifications(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectSpecification]:
    """List FF&E specifications in chronological order (any member, any status)."""
    result = await db.execute(
        select(ProjectSpecification)
        .where(ProjectSpecification.project_id == project_id)
        .order_by(ProjectSpecification.created_at.asc())
    )
    return list(result.scalars().all())


@router.post(
    "",
    response_model=SpecificationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_specification(
    project_id: UUID,
    payload: SpecificationCreate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> ProjectSpecification:
    """Create an FF&E specification (studio team only, ACTIVE projects only)."""
    await require_active_project(project_id, db)

    spec = ProjectSpecification(
        project_id=project_id,
        created_by=current_user.id,
        **payload.model_dump(),
    )
    db.add(spec)
    await db.commit()
    await db.refresh(spec)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="specification.create",
        entity_type="project_specification",
        entity_id=spec.id,
        metadata={"project_id": str(project_id)},
    )
    return spec


@router.get("/{specification_id}", response_model=SpecificationRead)
async def get_specification(
    project_id: UUID,
    specification_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> ProjectSpecification:
    """Read a single specification (any member, any status)."""
    return await get_specification_or_404(db, project_id, specification_id)


@router.patch("/{specification_id}", response_model=SpecificationRead)
async def update_specification(
    project_id: UUID,
    specification_id: UUID,
    payload: SpecificationUpdate,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> ProjectSpecification:
    """Partially update a specification (studio team only, ACTIVE projects only)."""
    await require_active_project(project_id, db)
    spec = await get_specification_or_404(db, project_id, specification_id)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(spec, field, value)

    await db.commit()
    await db.refresh(spec)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="specification.update",
        entity_type="project_specification",
        entity_id=spec.id,
        metadata={"project_id": str(project_id)},
    )
    return spec


@router.delete(
    "/{specification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_specification(
    project_id: UUID,
    specification_id: UUID,
    current_user: User = Depends(require_team_member),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a specification (studio team only, ACTIVE projects only)."""
    await require_active_project(project_id, db)
    spec = await get_specification_or_404(db, project_id, specification_id)

    spec_id = spec.id
    await db.delete(spec)
    await db.commit()

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="specification.delete",
        entity_type="project_specification",
        entity_id=spec_id,
        metadata={"project_id": str(project_id)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
