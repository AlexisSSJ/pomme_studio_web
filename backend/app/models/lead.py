"""Lead model and related enums for inbound prospects."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class ServiceType(str, enum.Enum):
    """Design services offered by the studio."""

    BRANDING = "branding"
    INTERIOR = "interior"
    INTEGRAL = "integral"


class SpaceType(str, enum.Enum):
    """Kind of space the lead is interested in designing."""

    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    HOSPITALITY = "hospitality"
    OFFICE = "office"


class BudgetRange(str, enum.Enum):
    """Self-reported budget range for a lead."""

    UNDER_10K = "under_10k"
    FROM_10K_TO_25K = "10k_25k"
    FROM_25K_TO_50K = "25k_50k"
    FROM_50K_TO_100K = "50k_100k"
    OVER_100K = "over_100k"


class LeadStatus(str, enum.Enum):
    """Lifecycle status of a lead."""

    NEW = "new"
    CONTACTED = "contacted"
    QUALIFIED = "qualified"
    PROPOSAL_SENT = "proposal_sent"
    CONVERTED = "converted"
    DISCARDED = "discarded"


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    contact_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(
        String(320),
        index=True,
        nullable=False,
    )
    service_type: Mapped[ServiceType] = mapped_column(
        SAEnum(ServiceType, name="service_type", native_enum=False),
        nullable=False,
    )
    space_type: Mapped[SpaceType | None] = mapped_column(
        SAEnum(SpaceType, name="space_type", native_enum=False),
        nullable=True,
    )
    area_m2: Mapped[float | None] = mapped_column(
        Numeric(10, 2),
        nullable=True,
    )
    budget_range: Mapped[BudgetRange | None] = mapped_column(
        SAEnum(BudgetRange, name="budget_range", native_enum=False),
        nullable=True,
    )
    status: Mapped[LeadStatus] = mapped_column(
        SAEnum(LeadStatus, name="lead_status", native_enum=False),
        default=LeadStatus.NEW,
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
        return f"<Lead {self.email!r} status={self.status.value}>"
