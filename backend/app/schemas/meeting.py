"""Schemas for in-project meetings (stage reviews and site surveys)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models.meeting import MeetingStatus, MeetingType


class ProjectMeetingCreate(BaseModel):
    """Payload for booking a review or survey meeting on a project."""

    model_config = ConfigDict(extra="forbid")

    meeting_type: MeetingType
    start_time: datetime = Field(..., description="Timezone-aware desired start time")
    stage_id: UUID | None = None

    @field_validator("start_time")
    @classmethod
    def _start_time_must_be_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("start_time must be timezone-aware")
        return value

    @field_validator("meeting_type")
    @classmethod
    def _meeting_type_must_be_project_kind(cls, value: MeetingType) -> MeetingType:
        if value not in (MeetingType.REVIEW, MeetingType.SURVEY):
            raise ValueError("meeting_type must be review or survey")
        return value


class ProjectMeetingRead(BaseModel):
    """Public shape of a meeting attached to a project."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    google_event_id: str | None
    meet_link: str | None
    start_time: datetime
    end_time: datetime
    meeting_type: MeetingType
    status: MeetingStatus
    created_at: datetime
