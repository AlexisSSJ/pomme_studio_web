"""Project read schema."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from ..models.lead import ServiceType
from ..models.project import ProjectStatus


class ProjectCreate(BaseModel):
    title: str
    scope_type: ServiceType | None = None
    client_id: UUID | None = None
    lead_designer_id: UUID | None = None
    included_rounds: int = 3
    remaining_rounds: int = 3


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    lead_id: UUID | None
    client_id: UUID | None
    lead_designer_id: UUID | None
    scope_type: ServiceType | None
    status: ProjectStatus
    included_rounds: int
    remaining_rounds: int
    balance_paid: bool
    brief_sent_at: datetime | None = None
    created_at: datetime
