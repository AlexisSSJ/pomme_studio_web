"""Brief AI reports and versioned project asset library.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-25

Adds:
- ``projects.brief_submitted_at`` for explicit client brief review submission;
- ``brief_reports`` for persisted AI-generated and team-editable Markdown reports;
- ``project_assets`` and ``asset_versions`` for the versioned asset library.

Uses SQLAlchemy Inspector guards for idempotency across PostgreSQL and SQLite.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(bind, table_name: str) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns(table_name)}


def _index_names(bind, table_name: str) -> set[str]:
    return {idx["name"] for idx in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. projects.brief_submitted_at
    if inspector.has_table("projects") and "brief_submitted_at" not in _column_names(
        bind, "projects"
    ):
        op.add_column(
            "projects",
            sa.Column("brief_submitted_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 2. brief_reports
    if not inspector.has_table("brief_reports"):
        op.create_table(
            "brief_reports",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "project_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("projects.id"),
                nullable=False,
            ),
            sa.Column("brief_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("content_markdown", sa.Text(), nullable=False),
            sa.Column(
                "status",
                sa.Enum(
                    "draft",
                    "generated",
                    "edited",
                    name="brief_report_status",
                    native_enum=False,
                ),
                nullable=False,
                server_default="generated",
            ),
            sa.Column("model_used", sa.String(120), nullable=True),
            sa.Column(
                "generated_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column(
                "updated_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("project_id", name="uq_brief_reports_project_id"),
        )

    report_indexes = _index_names(bind, "brief_reports")
    if "ix_brief_reports_project_id" not in report_indexes:
        op.create_index("ix_brief_reports_project_id", "brief_reports", ["project_id"])
    if "ix_brief_reports_brief_id" not in report_indexes:
        op.create_index("ix_brief_reports_brief_id", "brief_reports", ["brief_id"])

    # 3. project_assets
    if not inspector.has_table("project_assets"):
        op.create_table(
            "project_assets",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "project_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("projects.id"),
                nullable=False,
            ),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column(
                "category",
                sa.Enum(
                    "references",
                    "deliverables",
                    "client_resources",
                    "typography_palette",
                    name="asset_category",
                    native_enum=False,
                ),
                nullable=False,
                server_default="references",
            ),
            sa.Column(
                "visibility",
                sa.Enum(
                    "internal_only",
                    "client_visible",
                    name="asset_visibility",
                    native_enum=False,
                ),
                nullable=False,
                server_default="internal_only",
            ),
            sa.Column(
                "current_version_number",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "uploaded_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    asset_indexes = _index_names(bind, "project_assets")
    if "ix_project_assets_project_id" not in asset_indexes:
        op.create_index("ix_project_assets_project_id", "project_assets", ["project_id"])
    if "ix_project_assets_category" not in asset_indexes:
        op.create_index("ix_project_assets_category", "project_assets", ["category"])
    if "ix_project_assets_visibility" not in asset_indexes:
        op.create_index("ix_project_assets_visibility", "project_assets", ["visibility"])

    # 4. asset_versions
    if not inspector.has_table("asset_versions"):
        op.create_table(
            "asset_versions",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "asset_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("project_assets.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_extension", sa.String(32), nullable=False),
            sa.Column("content_type", sa.String(150), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("storage_key", sa.String(500), nullable=False),
            sa.Column("changelog", sa.Text(), nullable=True),
            sa.Column(
                "is_current",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "uploaded_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "asset_id",
                "version_number",
                name="uq_asset_versions_asset_number",
            ),
        )

    version_indexes = _index_names(bind, "asset_versions")
    if "ix_asset_versions_asset_id" not in version_indexes:
        op.create_index("ix_asset_versions_asset_id", "asset_versions", ["asset_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("asset_versions"):
        if "ix_asset_versions_asset_id" in _index_names(bind, "asset_versions"):
            op.drop_index("ix_asset_versions_asset_id", table_name="asset_versions")
        op.drop_table("asset_versions")

    if inspector.has_table("project_assets"):
        asset_indexes = _index_names(bind, "project_assets")
        for idx_name in (
            "ix_project_assets_visibility",
            "ix_project_assets_category",
            "ix_project_assets_project_id",
        ):
            if idx_name in asset_indexes:
                op.drop_index(idx_name, table_name="project_assets")
        op.drop_table("project_assets")

    if inspector.has_table("brief_reports"):
        report_indexes = _index_names(bind, "brief_reports")
        for idx_name in (
            "ix_brief_reports_brief_id",
            "ix_brief_reports_project_id",
        ):
            if idx_name in report_indexes:
                op.drop_index(idx_name, table_name="brief_reports")
        op.drop_table("brief_reports")

    if inspector.has_table("projects") and "brief_submitted_at" in _column_names(
        bind, "projects"
    ):
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_column("brief_submitted_at")
