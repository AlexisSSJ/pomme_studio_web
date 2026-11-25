"""Schemas for AI-generated and team-editable brief executive reports."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.brief_report import BriefReportStatus


class BriefReportUpdate(BaseModel):
    """Payload for team edits to the Markdown content of a brief report."""

    model_config = ConfigDict(extra="forbid")

    content_markdown: str = Field(min_length=1, max_length=100000)


class BriefReportRead(BaseModel):
    """Public shape of a persisted brief executive report."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    brief_id: UUID
    content_markdown: str
    status: BriefReportStatus
    model_used: str | None = None
    generated_by: UUID | None = None
    updated_by: UUID | None = None
    generated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BriefSubmitReviewResponse(BaseModel):
    """Response returned when the client submits the brief for team review."""

    project_id: UUID
    brief_submitted_at: datetime
    report_generated: bool = False
    report_error: str | None = None
