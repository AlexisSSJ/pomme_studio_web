"""Audit logging service for sensitive actions."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit_log import AuditLog


async def log_audit(
    db: AsyncSession,
    actor_user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    metadata: dict | None = None,
) -> AuditLog:
    """Create and persist an audit log entry."""
    entry = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=metadata,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry
