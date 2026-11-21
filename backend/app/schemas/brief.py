"""Brief item schemas: question creation, answers and reads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.brief_item import BriefCategory, BriefItemType


class BriefQuestionCreate(BaseModel):
    """Payload for creating a brief question."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=500)
    category: BriefCategory


class BriefAnswerUpdate(BaseModel):
    """Payload for answering a brief question."""

    model_config = ConfigDict(extra="forbid")

    answer: str = Field(min_length=1, max_length=10000)


class BriefItemRead(BaseModel):
    """Public shape of a brief item; never exposes the storage key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    item_type: BriefItemType
    category: BriefCategory
    prompt: str | None
    answer: str | None
    note: str | None
    file_name: str | None
    content_type: str | None
    size_bytes: int | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
