"""Schemas for quotes, proposals and lead conversion."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.lead import ServiceType


class QuoteLineRead(BaseModel):
    concept: str
    amount: Decimal


class QuoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    service_type: ServiceType
    area_m2: Decimal | None
    lines: list[QuoteLineRead]
    multiplier: Decimal
    total: Decimal
    change_rounds: int


class ProposalRead(QuoteRead):
    lead_id: UUID
    generated_at: datetime


class ConvertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=3, max_length=255)
    client_id: UUID | None = None
