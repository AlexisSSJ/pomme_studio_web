"""Project read schema."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from ..models.lead import ServiceType
from ..models.project import ProjectStatus


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
    created_at: datetime
