"""Brief item schemas: question creation, answers, autoguardado and reads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.brief_item import BriefCategory, BriefItemType, BriefItemStatus, BriefStatus


class BriefQuestionCreate(BaseModel):
    """Payload for creating a brief question."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=500)
    category: BriefCategory


class BriefAnswerUpdate(BaseModel):
    """Payload for answering a brief question, supporting multimodal answers and status."""

    model_config = ConfigDict(extra="ignore")

    answer: str | None = Field(None, max_length=10000)
    status: BriefStatus | None = None
    response_type: str | None = Field(None, max_length=50)
    image_url: str | None = Field(None, max_length=500)
    image_storage_key: str | None = Field(None, max_length=500)
    audio_url: str | None = Field(None, max_length=500)
    audio_storage_key: str | None = Field(None, max_length=500)
    audio_transcription: str | None = None
    transcription: str | None = None


class BriefAutosaveItem(BaseModel):
    """Item-level autosave payload."""

    model_config = ConfigDict(extra="ignore")

    item_id: UUID
    answer: str | None = None
    status: BriefStatus | None = None
    response_type: str | None = None
    image_url: str | None = None
    image_storage_key: str | None = None
    audio_url: str | None = None
    audio_storage_key: str | None = None
    audio_transcription: str | None = None
    transcription: str | None = None


class BriefAutosavePayload(BaseModel):
    """Payload for autosaving brief progress (single question or batch)."""

    model_config = ConfigDict(extra="ignore")

    # Single-item shorthand
    item_id: UUID | None = None
    answer: str | None = None
    status: BriefStatus | None = None
    response_type: str | None = None
    image_url: str | None = None
    image_storage_key: str | None = None
    audio_url: str | None = None
    audio_storage_key: str | None = None
    audio_transcription: str | None = None
    transcription: str | None = None

    # Batch support
    items: list[BriefAutosaveItem] | None = None


class BriefConfirmPayload(BaseModel):
    """Explicit client seal: mark a question as finished (or reopen it)."""

    model_config = ConfigDict(extra="forbid")

    confirmed: bool


class BriefImageRead(BaseModel):
    """Public shape of a reference image attached to a brief question; never exposes storage key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    item_id: UUID
    position: int
    content_type: str | None = None
    size_bytes: int | None = None
    url: str | None = None
    created_at: datetime


class BriefItemRead(BaseModel):
    """Public shape of a brief item; never exposes the storage key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    item_type: BriefItemType
    category: BriefCategory
    status: BriefStatus = BriefStatus.PENDING
    prompt: str | None = None
    answer: str | None = None
    note: str | None = None
    file_name: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    response_type: str | None = None
    image_url: str | None = None
    images: list[BriefImageRead] = Field(default_factory=list)
    audio_url: str | None = None
    audio_transcription: str | None = None
    transcription: str | None = None
    client_confirmed: bool = False
    progress: float | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class BriefAutosaveResponse(BaseModel):
    """Response returned upon autosaving brief answers, including progress calculation."""

    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    progress: float
    progress_percentage: float
    status: BriefStatus
    total_questions: int
    answered_questions: int
    pending_questions: int
    item: BriefItemRead | None = None
    items: list[BriefItemRead] = Field(default_factory=list)


class PendingBriefProjectSummary(BaseModel):
    """Summary of a pending brief for a specific project."""

    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    project_title: str
    status: BriefStatus
    progress: float
    total_questions: int
    answered_questions: int
    pending_questions: int


class BriefPendingResponse(BaseModel):
    """Response indicating pending brief status for the logged-in client."""

    model_config = ConfigDict(from_attributes=True)

    has_pending_brief: bool
    project_id: UUID | None = None
    project_title: str | None = None
    status: BriefStatus | None = None
    progress: float = 0.0
    total_questions: int = 0
    answered_questions: int = 0
    pending_questions: int = 0
    items: list[BriefItemRead] = Field(default_factory=list)
    pending_briefs: list[PendingBriefProjectSummary] = Field(default_factory=list)
