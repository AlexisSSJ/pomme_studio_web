"""Moodboard reaction — a like/dislike or a comment left by a user."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class ReactionType(str, enum.Enum):
    """Kind of feedback left on a moodboard item."""

    LIKE = "like"
    DISLIKE = "dislike"
    COMMENT = "comment"


class MoodboardReaction(Base):
    __tablename__ = "moodboard_reactions"
    __table_args__ = (
        UniqueConstraint("moodboard_item_id", "user_id", name="uq_moodboard_reaction_user"),
        CheckConstraint(
            "(reaction <> 'comment') OR (comment IS NOT NULL AND length(trim(comment)) > 0)",
            name="ck_reaction_comment_required",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    moodboard_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("moodboard_items.id"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    reaction: Mapped[ReactionType] = mapped_column(
        SAEnum(
            ReactionType,
            name="moodboard_reaction",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        nullable=False,
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<MoodboardReaction {self.reaction.value} item={self.moodboard_item_id}>"
