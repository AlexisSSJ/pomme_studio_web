"""Brief item — an answered question or a reference file within a project brief."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
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


class BriefItemType(str, enum.Enum):
    """Shape of a brief item: an answered question or an uploaded reference."""

    QUESTION = "question"
    REFERENCE = "reference"


class BriefCategory(str, enum.Enum):
    """Area of the engagement a brief item belongs to."""

    BRANDING = "branding"
    INTERIOR = "interior"
    GENERAL = "general"


class BriefItem(Base):
    __tablename__ = "brief_items"
    __table_args__ = (
        CheckConstraint(
            "(item_type = 'question' AND prompt IS NOT NULL) OR (item_type = 'reference' AND storage_key IS NOT NULL)",
            name="ck_brief_item_shape",
        ),
    )

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
    item_type: Mapped[BriefItemType] = mapped_column(
        SAEnum(
            BriefItemType,
            name="brief_item_type",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        nullable=False,
    )
    category: Mapped[BriefCategory] = mapped_column(
        SAEnum(
            BriefCategory,
            name="brief_category",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        nullable=False,
    )
    prompt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        return f"<BriefItem {self.item_type.value} project={self.project_id}>"
