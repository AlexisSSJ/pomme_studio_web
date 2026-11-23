"""Brief item — an answered question or a reference file within a project brief.

Note on enum tolerance (documentation only): the ``_missing_`` hooks on the
enums below make value parsing tolerant for Pydantic/schemas and for incoming
request payloads (e.g. the brief autosave), but they do NOT make SQLAlchemy ORM
reads tolerant. ``SAEnum(native_enum=False)`` resolves stored values through its
own ``_object_lookup`` and rejects raw uppercase values left by legacy rows.
The repair of those raw values in the database is guaranteed by migration 0009
(``alembic/versions/0009_normalize_brief_data.py``), which runs on every deploy
before uvicorn starts -- see also ``app/services/brief_normalization.py``.
"""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class BriefItemType(str, enum.Enum):
    """Shape of a brief item: an answered question or an uploaded reference."""

    QUESTION = "question"
    REFERENCE = "reference"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower()
            for member in cls:
                if member.value == val_lower or member.name.lower() == val_lower:
                    return member
        return None


class BriefCategory(str, enum.Enum):
    """Area of the engagement a brief item belongs to."""

    BRANDING = "branding"
    INTERIOR = "interior"
    GENERAL = "general"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower()
            for member in cls:
                if member.value == val_lower or member.name.lower() == val_lower:
                    return member
        return None


class BriefStatus(str, enum.Enum):
    """Lifecycle status of a brief item or overall project brief."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower()
            for member in cls:
                if member.value == val_lower or member.name.lower() == val_lower:
                    return member
        return None


BriefItemStatus = BriefStatus


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
    status: Mapped[BriefStatus] = mapped_column(
        SAEnum(
            BriefStatus,
            name="brief_status",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=BriefStatus.PENDING,
        server_default="pending",
        nullable=False,
    )
    prompt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Multimodal response fields (text, image, audio with transcription)
    response_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_transcription: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcription: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Explicit client seal: "this question is finished" (independent from the
    # automatic answered-based status; toggled via POST /items/{id}/confirm).
    client_confirmed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
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
        return f"<BriefItem {self.item_type.value} project={self.project_id}>"


Brief = BriefItem

