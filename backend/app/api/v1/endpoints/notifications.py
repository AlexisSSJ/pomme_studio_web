"""Endpoints for the authenticated user's own notifications."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import get_current_active_user
from ....db.session import get_db
from ....models.notification import Notification
from ....models.user import User
from ....schemas.notification import NotificationRead

router = APIRouter()

MAX_NOTIFICATIONS = 50


@router.get("", response_model=list[NotificationRead])
async def list_notifications(
    unread_only: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[Notification]:
    """List the caller's notifications, newest first (any active role)."""
    query = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(desc(Notification.created_at)).limit(MAX_NOTIFICATIONS)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Mark every unread notification belonging to the caller as read."""
    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return {"marked_read": result.rowcount or 0}


@router.post("/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Notification:
    """Mark one of the caller's notifications as read; others read as 404."""
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notification)
    return notification
