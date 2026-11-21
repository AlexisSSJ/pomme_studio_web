"""Deliverable schemas: version reads and pin comment validation."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    is_client_visible: bool
    is_final_handover: bool
    published_at: datetime | None
    published_by: UUID | None
    created_by: UUID
    created_at: datetime


class DeliverableCommentCreate(BaseModel):
    """Payload for pinning a comment at a point of a deliverable."""

    model_config = ConfigDict(extra="forbid")

    x_pct: float = Field(ge=0, le=100)
    y_pct: float = Field(ge=0, le=100)
    page_or_frame: int = Field(default=1, ge=1)
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def validate_body_not_blank(cls, value: str) -> str:
        """Reject whitespace-only bodies before they hit the DB check."""
        if not value.strip():
            raise ValueError("body must not be blank")
        return value


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


class DeliverablePublish(BaseModel):
    """Payload for publishing a deliverable version to the client portal."""

    model_config = ConfigDict(extra="forbid")

    is_final_handover: bool = False


class DeliverableFinalHandover(BaseModel):
    """Payload for (un)marking a deliverable version as the final handover."""

    model_config = ConfigDict(extra="forbid")

    is_final_handover: bool
