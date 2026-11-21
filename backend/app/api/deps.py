"""Shared FastAPI dependencies: database session and RBAC guards.

Every protected endpoint must authenticate the caller, confirm `is_active`,
and (where relevant) check the role and project membership/ownership. The
helpers here cover the first two; project-level checks will build on them.
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
from ..models.user import User, UserRole
from ..models.project_member import ProjectMember
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


def get_calendar_client() -> GoogleCalendarClient:
    """Return the process-wide Google Calendar client instance."""
    return GoogleCalendarClient(settings)


def get_storage() -> LocalStorage:
    """Return the local media storage service (overrideable in tests)."""
    return LocalStorage(Path(settings.MEDIA_ROOT))
