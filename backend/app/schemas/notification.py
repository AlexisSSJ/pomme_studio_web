"""Notification read schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    """Public shape of a notification; never exposes the recipient's user id."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: str
    project_id: UUID | None
    payload: dict | None
    read_at: datetime | None
    created_at: datetime
