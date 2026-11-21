"""Stage schemas: creation payload and public read shape."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.project_stage import StageStatus


class StageCreate(BaseModel):
    """Payload for adding a workflow stage to a project."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    order_index: int = Field(ge=0)


class StageRead(BaseModel):
    """Public shape of a project stage."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    order_index: int
    status: StageStatus
    approved_by: UUID | None
    approved_at: datetime | None
    created_at: datetime
