"""Schemas for versioned project asset library."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models.project_asset import AssetCategory, AssetVisibility


class AssetUpdate(BaseModel):
    """Payload for updating asset metadata (studio team only)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=5000)
    category: AssetCategory | None = None
    visibility: AssetVisibility | None = None

    @model_validator(mode="after")
    def _require_any_field(self) -> "AssetUpdate":
        if (
            self.title is None
            and self.description is None
            and self.category is None
            and self.visibility is None
        ):
            raise ValueError("At least one field must be provided")
        return self


class AssetVersionRead(BaseModel):
    """Public shape of an asset version; never exposes storage_key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    asset_id: UUID
    version_number: int
    file_name: str
    file_extension: str
    content_type: str
    size_bytes: int
    changelog: str | None = None
    is_current: bool
    uploaded_by: UUID
    uploaded_by_name: str | None = None
    file_url: str
    is_image: bool
    created_at: datetime


class ProjectAssetRead(BaseModel):
    """Public shape of a project asset with its current version summary."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    description: str | None = None
    category: AssetCategory
    visibility: AssetVisibility
    current_version_number: int
    version_count: int = 1
    uploaded_by: UUID
    uploaded_by_name: str | None = None
    current_version: AssetVersionRead | None = None
    created_at: datetime
    updated_at: datetime


class ProjectAssetDetailRead(ProjectAssetRead):
    """Detailed project asset response including full version history."""

    versions: list[AssetVersionRead] = Field(default_factory=list)
