"""Member-facing project listing and detail endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_current_active_user,
    get_project_or_404,
    require_project_access_from_path,
)
from ....db.session import get_db
from ....models.project import Project
from ....models.project_member import ProjectMember
from ....models.user import User, UserRole
from ....schemas.project import ProjectRead

router = APIRouter()


@router.get("", response_model=list[ProjectRead])
async def list_my_projects(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    """List the caller's projects, most recent first.

    SUPER_ADMIN sees every project; everyone else sees only the projects
    where they hold a membership.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        result = await db.execute(
            select(Project).order_by(desc(Project.created_at))
        )
        return list(result.scalars().all())

    result = await db.execute(
        select(Project)
        .where(
            Project.id.in_(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == current_user.id
                )
            )
        )
        .order_by(desc(Project.created_at))
    )
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Return a single project for its members (SUPER_ADMIN included)."""
    return await get_project_or_404(project_id, db)
