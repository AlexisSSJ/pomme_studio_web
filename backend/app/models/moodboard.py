"""Moodboard board — a curated group of inspiration pieces within a project."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class MoodboardLayout(str, enum.Enum):
    """Editorial layout used to present a board."""

    EDITORIAL_COLLAGE = "editorial_collage"
    ATELIER_GRID = "atelier_grid"
    MONOGRAPH_STRIP = "monograph_strip"


class Moodboard(Base):
    __tablename__ = "moodboards"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    curatorial_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    layout_variant: Mapped[MoodboardLayout] = mapped_column(
        SAEnum(
            MoodboardLayout,
            name="moodboard_layout",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        nullable=False,
        server_default=MoodboardLayout.EDITORIAL_COLLAGE.value,
    )
    position: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
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
        return f"<Moodboard {self.title!r} project={self.project_id}>"
