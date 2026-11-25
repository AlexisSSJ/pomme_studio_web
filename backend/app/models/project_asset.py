"""ProjectAsset and AssetVersion models — versioned project asset library."""

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class AssetCategory(str, enum.Enum):
    """Curated categories for studio and client project assets."""

    REFERENCES = "references"
    DELIVERABLES = "deliverables"
    CLIENT_RESOURCES = "client_resources"
    TYPOGRAPHY_PALETTE = "typography_palette"


class AssetVisibility(str, enum.Enum):
    """Access scope of a project asset."""

    INTERNAL_ONLY = "internal_only"
    CLIENT_VISIBLE = "client_visible"


class ProjectAsset(Base):
    __tablename__ = "project_assets"

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
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[AssetCategory] = mapped_column(
        SAEnum(
            AssetCategory,
            name="asset_category",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=AssetCategory.REFERENCES,
        server_default="references",
        nullable=False,
        index=True,
    )
    visibility: Mapped[AssetVisibility] = mapped_column(
        SAEnum(
            AssetVisibility,
            name="asset_visibility",
            native_enum=False,
            values_callable=lambda members: [member.value for member in members],
        ),
        default=AssetVisibility.INTERNAL_ONLY,
        server_default="internal_only",
        nullable=False,
        index=True,
    )
    current_version_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
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
        return f"<ProjectAsset {self.title!r} v{self.current_version_number}>"


class AssetVersion(Base):
    __tablename__ = "asset_versions"
    __table_args__ = (
        sa.UniqueConstraint(
            "asset_id",
            "version_number",
            name="uq_asset_versions_asset_number",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_assets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_extension: Mapped[str] = mapped_column(String(32), nullable=False)
    content_type: Mapped[str] = mapped_column(String(150), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    changelog: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=sa.true(),
        nullable=False,
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AssetVersion asset={self.asset_id} v{self.version_number}>"
