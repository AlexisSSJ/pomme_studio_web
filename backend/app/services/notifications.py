"""Notification delivery service for project-level events."""

from uuid import UUID

from sqlalchemy import select, true
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.notification import Notification
from ..models.project import Project
from ..models.project_member import ProjectMember, ProjectRole
from ..models.user import User

TEAM_MEMBER_ROLES = (ProjectRole.LEAD_DESIGNER, ProjectRole.COLLABORATOR)


async def notify_project_team(
    db: AsyncSession,
    project_id: UUID,
    event_type: str,
    payload: dict,
    exclude_user_id: UUID | None = None,
) -> list[Notification]:
    """Stage one notification per active team member of the project.

    Recipients are the project's LEAD_DESIGNER/COLLABORATOR members plus the
    project's lead designer, deduplicated by user id. The actor is excluded and
    inactive users are skipped. Rows are added to the session but NOT committed:
    the caller owns the transaction boundary.
    """
    project = await db.get(Project, project_id)
    if project is None:
        return []

    members_result = await db.execute(
        select(ProjectMember.user_id).where(
            ProjectMember.project_id == project_id,
            ProjectMember.assigned_role.in_(TEAM_MEMBER_ROLES),
        )
    )
    recipient_ids = set(members_result.scalars().all())
    if project.lead_designer_id is not None:
        recipient_ids.add(project.lead_designer_id)
    if exclude_user_id is not None:
        recipient_ids.discard(exclude_user_id)
    if not recipient_ids:
        return []

    users_result = await db.execute(
        select(User.id).where(
            User.id.in_(recipient_ids),
            User.is_active == true(),
        )
    )
    active_ids = set(users_result.scalars().all())

    notifications = [
        Notification(
            user_id=user_id,
            project_id=project_id,
            event_type=event_type,
            payload=payload,
        )
        for user_id in sorted(active_ids, key=str)
    ]
    if notifications:
        db.add_all(notifications)
    return notifications


async def notify_project_client(
    db: AsyncSession,
    project_id: UUID,
    event_type: str,
    payload: dict,
    exclude_user_id: UUID | None = None,
) -> list[Notification]:
    """Stage one notification for the project's client-side users.

    Recipients are the project's ``client_id`` plus members whose assigned role
    is CLIENT, deduplicated by user id. The actor is excluded and inactive users
    are skipped. Rows are added to the session but NOT committed: the caller
    owns the transaction boundary.
    """
    project = await db.get(Project, project_id)
    if project is None:
        return []

    members_result = await db.execute(
        select(ProjectMember.user_id).where(
            ProjectMember.project_id == project_id,
            ProjectMember.assigned_role == ProjectRole.CLIENT,
        )
    )
    recipient_ids = set(members_result.scalars().all())
    if project.client_id is not None:
        recipient_ids.add(project.client_id)
    if exclude_user_id is not None:
        recipient_ids.discard(exclude_user_id)
    if not recipient_ids:
        return []

    users_result = await db.execute(
        select(User.id).where(
            User.id.in_(recipient_ids),
            User.is_active == true(),
        )
    )
    active_ids = set(users_result.scalars().all())

    notifications = [
        Notification(
            user_id=user_id,
            project_id=project_id,
            event_type=event_type,
            payload=payload,
        )
        for user_id in sorted(active_ids, key=str)
    ]
    if notifications:
        db.add_all(notifications)
    return notifications
