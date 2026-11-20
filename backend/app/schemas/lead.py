"""Pydantic schemas for public lead intake and discovery calls."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from ..models.lead import BudgetRange, ServiceType, SpaceType
from ..models.meeting import MeetingStatus, MeetingType


class LeadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contact_name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    service_type: ServiceType
    space_type: SpaceType | None = None
    area_m2: Decimal | None = Field(default=None, gt=0)
    budget_range: BudgetRange | None = None

    @model_validator(mode="after")
    def _require_area_for_interior_or_integral(self) -> "LeadCreate":
        if self.service_type in (ServiceType.INTERIOR, ServiceType.INTEGRAL):
            if self.area_m2 is None or self.area_m2 <= 0:
                raise ValueError("area_m2 is required for interior or integral services")
        return self


class LeadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    contact_name: str
    email: str
    service_type: ServiceType
    space_type: SpaceType | None
    area_m2: Decimal | None
    budget_range: BudgetRange | None
    status: str
    created_at: datetime


class SlotRead(BaseModel):
    start_time: datetime
    end_time: datetime


class AvailabilityRead(BaseModel):
    date: date
    slots: list[SlotRead]


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_time: datetime = Field(..., description="Timezone-aware desired start time")

    @field_validator("start_time")
    @classmethod
    def _start_time_must_be_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("start_time must be timezone-aware")
        return value


class MeetingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lead_id: UUID | None
    project_id: UUID | None
    start_time: datetime
    end_time: datetime
    meeting_type: MeetingType
    status: MeetingStatus
    meet_link: str | None
