"""Specification schemas: FF&E documentation validation and reads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models.project_specification import SpecificationCategory


class SpecificationCreate(BaseModel):
    """Payload for documenting an FF&E specification on a project.

    Documentation only: quantity, price, stock and purchase data are
    intentionally out of scope.
    """

    model_config = ConfigDict(extra="forbid")

    category: SpecificationCategory
    name: str = Field(min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=255)
    finish: str | None = Field(default=None, max_length=255)
    dimensions: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    reference_url: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name_not_blank(cls, value: str) -> str:
        """Reject whitespace-only names before they hit the DB check."""
        if not value.strip():
            raise ValueError("name must not be blank")
        return value


class SpecificationUpdate(BaseModel):
    """Payload for partially updating an FF&E specification."""

    model_config = ConfigDict(extra="forbid")

    category: SpecificationCategory | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=255)
    finish: str | None = Field(default=None, max_length=255)
    dimensions: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    reference_url: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name_not_blank(cls, value: str | None) -> str | None:
        """Reject whitespace-only names before they hit the DB check."""
        if value is not None and not value.strip():
            raise ValueError("name must not be blank")
        return value


class SpecificationRead(BaseModel):
    """Public shape of an FF&E specification."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    category: SpecificationCategory
    name: str
    code: str | None
    manufacturer: str | None
    finish: str | None
    dimensions: str | None
    supplier: str | None
    reference_url: str | None
    location: str | None
    notes: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
