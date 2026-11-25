"""BriefReport model — AI-generated and team-editable executive brief report."""

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class BriefReportStatus(str, enum.Enum):
    """Lifecycle status of an executive brief report."""

    DRAFT = "draft"
    GENERATED = "generated"
    EDITED = "edited"


class BriefReport(Base):
    __tablename__ = "brief_reports"
    __table_args__ = (
        sa.UniqueConstraint("project_id", name="uq_brief_reports_project_id"),
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
    # Logical brief identifier (defaults to project_id when the brief is scoped 1:1 per project).
    brief_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
        index=True,
    )
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[BriefReportStatus] = mapped_column(
        SAEnum(
            BriefReportStatus,
            name="brief_report_status",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=BriefReportStatus.GENERATED,
        server_default="generated",
        nullable=False,
    )
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    generated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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

    def __repr__(self) -> str:  # pragma: no cover
        return f"<BriefReport project={self.project_id} status={self.status.value}>"
