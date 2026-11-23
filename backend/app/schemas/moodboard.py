"""Moodboard schemas: board validation, reaction validation and item reads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models.moodboard import MoodboardLayout
from ..models.moodboard_reaction import ReactionType


class MoodboardReactionCreate(BaseModel):
    """Payload for reacting to a moodboard item.

    COMMENT reactions require non-blank comment text (stored stripped);
    any other reaction must not carry a comment.
    """

    model_config = ConfigDict(extra="forbid")

    reaction: ReactionType
    comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _validate_comment(self) -> "MoodboardReactionCreate":
        if self.reaction == ReactionType.COMMENT:
            if self.comment is None or not self.comment.strip():
                raise ValueError("Comment text is required")
            self.comment = self.comment.strip()
        elif self.comment is not None:
            raise ValueError("Comment only allowed with COMMENT reaction")
        return self


class MoodboardReactionRead(BaseModel):
    """Public shape of a moodboard reaction."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    moodboard_item_id: UUID
    user_id: UUID
    reaction: ReactionType
    comment: str | None
    created_at: datetime


class MoodboardItemRead(BaseModel):
    """Public shape of a moodboard piece; never exposes the storage key.

    Reaction counts and the caller's own reaction are filled in by the
    list endpoint via ``model_copy(update=...)``.
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
    like_count: int = 0
    dislike_count: int = 0
    comment_count: int = 0
    my_reaction: ReactionType | None = None
    my_comment: str | None = None


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
