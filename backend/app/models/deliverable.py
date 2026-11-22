"""Deliverable — a versioned file produced within a project stage."""

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class DeliverableStatus(str, enum.Enum):
    """Review lifecycle of a deliverable version."""

    IN_REVIEW = "in_review"
    CHANGES_REQUESTED = "changes_requested"
    APPROVED = "approved"


class Deliverable(Base):
    __tablename__ = "deliverables"
    __table_args__ = (
        UniqueConstraint("stage_id", "version", name="uq_deliverable_stage_version"),
        CheckConstraint("version >= 1", name="ck_deliverable_version_positive"),
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
    stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_stages.id"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[DeliverableStatus] = mapped_column(
        SAEnum(
            DeliverableStatus,
            name="deliverable_status",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=DeliverableStatus.IN_REVIEW,
        server_default="in_review",
        nullable=False,
    )
    is_client_visible: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=sa.false(),
        nullable=False,
    )
    is_final_handover: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=sa.false(),
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
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
        return f"<Deliverable {self.title!r} v{self.version}>"
