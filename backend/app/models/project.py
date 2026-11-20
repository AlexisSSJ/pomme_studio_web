"""Project model — a design engagement with a client and lead designer."""

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base
from .lead import ServiceType


class ProjectStatus(str, enum.Enum):
    """Lifecycle status of a project."""

    DRAFT = "draft"
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        sa.UniqueConstraint("lead_id", name="uq_projects_lead_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    lead_designer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("leads.id"),
        nullable=True,
        index=True,
    )
    scope_type: Mapped[ServiceType | None] = mapped_column(
        SAEnum(ServiceType, name="service_type", native_enum=False),
        nullable=True,
    )
    status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(ProjectStatus, name="project_status", native_enum=False),
        default=ProjectStatus.DRAFT,
        server_default="draft",
        nullable=False,
    )
    included_rounds: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    remaining_rounds: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    balance_paid: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=sa.false(),
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

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Project {self.title!r}>"
