"""Deliverable schemas: version reads and pin comment validation."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.deliverable import DeliverableStatus


class DeliverableRead(BaseModel):
    """Public shape of a deliverable version; never exposes the storage key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    stage_id: UUID
    title: str
    version: int
    file_name: str
    content_type: str
    size_bytes: int
    status: DeliverableStatus
    created_by: UUID
    created_at: datetime


class DeliverableCommentCreate(BaseModel):
    """Payload for pinning a comment at a point of a deliverable."""

    model_config = ConfigDict(extra="forbid")

    x_pct: float = Field(ge=0, le=100)
    y_pct: float = Field(ge=0, le=100)
    page_or_frame: int = Field(default=1, ge=1)
    body: str = Field(min_length=1, max_length=2000)


class DeliverableCommentRead(BaseModel):
    """Public shape of a pinned comment."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    deliverable_id: UUID
    created_by: UUID
    x_pct: float
    y_pct: float
    page_or_frame: int
    body: str
    round_number: int
    consumes_round: bool
    created_at: datetime
