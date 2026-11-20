"""Pricing configuration — editable by SUPER_ADMIN."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class PricingConfig(Base):
    __tablename__ = "pricing_config"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    price_per_m2_base: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    branding_base_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )
    integral_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("1.0"),
    )
    default_change_rounds: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=2,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PricingConfig {self.id}>"
