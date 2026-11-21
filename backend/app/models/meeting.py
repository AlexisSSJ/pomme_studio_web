"""Meeting model linked to leads or projects with Google Calendar metadata."""

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, DateTime, Enum as SAEnum, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class MeetingType(str, enum.Enum):
    """Purpose of a scheduled meeting."""

    DISCOVERY = "discovery"
    PROPOSAL = "proposal"
    REVIEW = "review"
    FOLLOW_UP = "follow_up"
    SURVEY = "survey"


class MeetingStatus(str, enum.Enum):
    """Lifecycle status of a meeting."""

    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    NO_SHOW = "no_show"


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint("end_time > start_time", name="ck_meeting_time_order"),
        CheckConstraint(
            "(lead_id IS NOT NULL) <> (project_id IS NOT NULL)",
            name="ck_meeting_single_parent",
        ),
        Index("ix_meetings_start_time", "start_time"),
        Index(
            "ux_meetings_start_time_active",
            "start_time",
            unique=True,
            postgresql_where=sa.text("status != 'cancelled'"),
            sqlite_where=sa.text("status != 'cancelled'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("leads.id"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id"),
        nullable=True,
        index=True,
    )
    google_event_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    meet_link: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    meeting_type: Mapped[MeetingType] = mapped_column(
        SAEnum(MeetingType, name="meeting_type", native_enum=False),
        nullable=False,
    )
    status: Mapped[MeetingStatus] = mapped_column(
        SAEnum(
            MeetingStatus,
            name="meeting_status",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=MeetingStatus.SCHEDULED,
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
        return f"<Meeting {self.meeting_type.value} status={self.status.value}>"
