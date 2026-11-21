"""Shared FastAPI dependencies: database session and RBAC guards.

Every protected endpoint must authenticate the caller, confirm `is_active`,
and (where relevant) check the role and project membership/ownership. The
helpers here cover authentication, activation, role checks and the
project-level membership guards.
"""

from pathlib import Path
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import API_V1_PREFIX, settings
from ..core.security import decode_access_token
from ..db.session import get_db
from ..models.deliverable import Deliverable
from ..models.project import Project, ProjectStatus
from ..models.project_member import ProjectMember, ProjectRole
from ..models.project_stage import ProjectStage, StageStatus
from ..models.user import User, UserRole
from ..services.google_calendar import GoogleCalendarClient
from ..services.storage import LocalStorage

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{API_V1_PREFIX}/auth/login",
    auto_error=False,
)


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the authenticated user from the bearer token."""
    if not token:
        raise _credentials_exception()

    payload = decode_access_token(token)
    if payload is None:
        raise _credentials_exception()

    subject = payload.get("sub")
    try:
        user_id = UUID(str(subject))
    except (TypeError, ValueError):
        raise _credentials_exception() from None

    user = await db.get(User, user_id)
    if user is None:
        raise _credentials_exception()
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Reject users that have been deactivated (kill switch)."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user


def require_roles(*roles: UserRole):
    """Dependency factory enforcing that the caller holds one of `roles`."""

    async def _checker(
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return _checker


def require_project_access(project_id: UUID):
    """Dependency factory enforcing project membership or SUPER_ADMIN access.

    Usage with a fixed project_id:
        Depends(require_project_access(some_uuid))

    For path-parameter-based access, use `require_project_access_from_path`.
    """

    async def _checker(
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if current_user.role == UserRole.SUPER_ADMIN:
            return current_user

        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == current_user.id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No access to this project",
            )
        return current_user

    return _checker


async def require_project_access_from_path(
    project_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency that reads project_id from the path and checks access."""
    if current_user.role == UserRole.SUPER_ADMIN:
        return current_user

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )
    return current_user


async def get_project_or_404(project_id: UUID, db: AsyncSession) -> Project:
    """Return the project for `project_id` or raise 404 ("Project not found")."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return project


async def require_active_project(project_id: UUID, db: AsyncSession) -> Project:
    """Return the project when it is ACTIVE.

    Raises 404 ("Project not found") when the project does not exist and
    409 ("Project is not active") for any other status.
    """
    project = await get_project_or_404(project_id, db)
    if project.status != ProjectStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project is not active",
        )
    return project


async def get_membership(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
) -> ProjectMember | None:
    """Return the user's membership row for the project, if any."""
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def require_team_member(
    project_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Require studio-team access to the project.

    SUPER_ADMIN always passes. LEAD_DESIGNER passes with a LEAD_DESIGNER
    membership or when the project's lead designer is the caller.
    COLLABORATOR passes only with a COLLABORATOR membership. Callers
    without a membership get "No access to this project"; members whose
    assigned role is insufficient (including CLIENT members) get
    "Insufficient permissions".
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        return current_user

    member = await get_membership(db, project_id, current_user.id)

    if current_user.role == UserRole.LEAD_DESIGNER:
        if member is not None and member.assigned_role == ProjectRole.LEAD_DESIGNER:
            return current_user
        project = await db.get(Project, project_id)
        if project is not None and project.lead_designer_id == current_user.id:
            return current_user
    elif (
        current_user.role == UserRole.COLLABORATOR
        and member is not None
        and member.assigned_role == ProjectRole.COLLABORATOR
    ):
        return current_user

    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Insufficient permissions",
    )


async def get_stage_or_404(
    db: AsyncSession, project_id: UUID, stage_id: UUID
) -> ProjectStage:
    """Return the stage for `stage_id` within `project_id` or raise 404.

    The lookup filters on both the stage id and the path project id, so
    cross-project stage ids are indistinguishable from missing ones.
    """
    result = await db.execute(
        select(ProjectStage).where(
            ProjectStage.id == stage_id,
            ProjectStage.project_id == project_id,
        )
    )
    stage = result.scalar_one_or_none()
    if stage is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stage not found",
        )
    return stage


def require_active_stage(stage: ProjectStage) -> None:
    """Allow stage mutations only on a stage that is currently ACTIVE.

    Raises 409 ("Stage is locked") for LOCKED stages and 409 ("Stage is
    already approved") for APPROVED ones.
    """
    if stage.status == StageStatus.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stage is locked",
        )
    if stage.status == StageStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stage is already approved",
        )


async def get_deliverable_or_404(
    db: AsyncSession, project_id: UUID, deliverable_id: UUID
) -> Deliverable:
    """Return the deliverable for `deliverable_id` within `project_id` or 404.

    The lookup filters on both the deliverable id and the path project id,
    so cross-project ids are indistinguishable from missing ones.
    """
    result = await db.execute(
        select(Deliverable).where(
            Deliverable.id == deliverable_id,
            Deliverable.project_id == project_id,
        )
    )
    deliverable = result.scalar_one_or_none()
    if deliverable is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deliverable not found",
        )
    return deliverable


async def require_client_member(
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


def get_calendar_client() -> GoogleCalendarClient:
    """Return the process-wide Google Calendar client instance."""
    return GoogleCalendarClient(settings)


def get_storage() -> LocalStorage:
    """Return the local media storage service (overrideable in tests)."""
    return LocalStorage(Path(settings.MEDIA_ROOT))
