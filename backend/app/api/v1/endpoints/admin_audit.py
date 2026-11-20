"""SUPER_ADMIN audit log query endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import require_roles
from ....db.session import get_db
from ....models.audit_log import AuditLog
from ....models.user import User, UserRole
from ....schemas.audit import AuditLogRead

router = APIRouter()


@router.get("/audit-logs", response_model=list[AuditLogRead])
async def list_audit_logs(
    entity_type: str | None = None,
    actor_user_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[AuditLog]:
    """Query audit logs with optional filters (SUPER_ADMIN only)."""
    query = select(AuditLog)
    if entity_type is not None:
        query = query.where(AuditLog.entity_type == entity_type)
    if actor_user_id is not None:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    query = query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())
