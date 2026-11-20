"""Pricing configuration schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PricingConfigUpdate(BaseModel):
    price_per_m2_base: Decimal = Field(..., ge=0)
    branding_base_price: Decimal = Field(..., ge=0)
    integral_multiplier: Decimal = Field(default=Decimal("1.0"), ge=0)
    default_change_rounds: int = Field(default=2, ge=0)


class PricingConfigRead(PricingConfigUpdate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    updated_by: UUID | None
    updated_at: datetime
