"""Project read and team-assignment schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from ..models.lead import ServiceType
from ..models.project import ProjectStatus
from ..models.project_member import ProjectRole
from ..models.user import UserRole


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


class ProjectMemberCreate(BaseModel):
    """Payload for adding a team member to a project."""

    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    assigned_role: ProjectRole


class ProjectMemberRead(BaseModel):
    """A project membership joined with the member's user profile."""

    id: UUID
    user_id: UUID
    email: str
    full_name: str | None
    assigned_role: ProjectRole
    created_at: datetime


class TeamUserRead(BaseModel):
    """A studio-team user available for project assignment."""

    id: UUID
    email: str
    full_name: str | None
    role: UserRole


class LeadUpdate(BaseModel):
    """Payload for reassigning a project's lead designer."""

    model_config = ConfigDict(extra="forbid")

    lead_designer_id: UUID
