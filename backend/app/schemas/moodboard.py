"""Moodboard schemas: board validation, comments and item reads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models.moodboard import MoodboardLayout


class MoodboardCommentCreate(BaseModel):
    """Payload for leaving a comment on a moodboard item."""

    model_config = ConfigDict(extra="forbid")

    comment: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _normalize_comment(self) -> "MoodboardCommentCreate":
        text = self.comment.strip()
        if not text:
            raise ValueError("Comment text is required")
        self.comment = text
        return self


class MoodboardCommentRead(BaseModel):
    """Public shape of a moodboard comment, with its author's name."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    moodboard_item_id: UUID
    user_id: UUID
    author_name: str
    comment: str
    created_at: datetime


class MoodboardItemRead(BaseModel):
    """Public shape of a moodboard piece; never exposes the storage key.

    The comment count and the latest comment text are filled in by the list
    endpoints via ``model_copy(update=...)``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    moodboard_id: UUID | None = None
    title: str
    description: str | None
    file_name: str
    content_type: str
    size_bytes: int
    sort_order: int
    created_by: UUID
    created_at: datetime
    comment_count: int = 0
    latest_comment: str | None = None


class MoodboardCreate(BaseModel):
    """Payload for creating a moodboard board."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    curatorial_note: str | None = Field(default=None, max_length=2000)
    layout_variant: MoodboardLayout = MoodboardLayout.EDITORIAL_COLLAGE
    position: int | None = None  # None -> max(position)+1, or 0 for the first


class MoodboardUpdate(BaseModel):
    """Partial update for a board; only provided fields are applied."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    curatorial_note: str | None = Field(default=None, max_length=2000)
    layout_variant: MoodboardLayout | None = None
    position: int | None = None


class MoodboardRead(BaseModel):
    """Public shape of a moodboard board, with its piece count."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    curatorial_note: str | None
    layout_variant: MoodboardLayout
    position: int
    item_count: int = 0
    created_by: UUID
    created_at: datetime
    updated_at: datetime
