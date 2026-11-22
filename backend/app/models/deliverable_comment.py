"""Deliverable comment — a pin anchored at a point of a deliverable version."""

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class DeliverableComment(Base):
    __tablename__ = "deliverable_comments"
    __table_args__ = (
        CheckConstraint("x_pct >= 0 AND x_pct <= 100", name="ck_comment_x_pct"),
        CheckConstraint("y_pct >= 0 AND y_pct <= 100", name="ck_comment_y_pct"),
        CheckConstraint("page_or_frame >= 1", name="ck_comment_page"),
        CheckConstraint("length(trim(body)) > 0", name="ck_comment_body"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    deliverable_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("deliverables.id"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    x_pct: Mapped[float] = mapped_column(Float, nullable=False)
    y_pct: Mapped[float] = mapped_column(Float, nullable=False)
    page_or_frame: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    round_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
    )
    consumes_round: Mapped[bool] = mapped_column(
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

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<DeliverableComment x={self.x_pct} y={self.y_pct}>"
