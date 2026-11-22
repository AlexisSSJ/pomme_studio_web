"""Sprint 4 models: project stages, deliverables and pin comments

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # project_stages
    op.create_table(
        "project_stages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("locked", "active", "approved", name="stage_status", native_enum=False),
            server_default="locked",
            nullable=False,
        ),
        sa.Column("approved_by", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("order_index >= 0", name="ck_stage_order_non_negative"),
        sa.CheckConstraint(
            "(status <> 'approved') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_stage_approval_shape",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "order_index", name="uq_project_stage_order"),
    )
    op.create_index("ix_project_stages_project_id", "project_stages", ["project_id"])

    # deliverables
    op.create_table(
        "deliverables",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("stage_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "in_review", "changes_requested", "approved",
                name="deliverable_status", native_enum=False,
            ),
            server_default="in_review",
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_deliverable_version_positive"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["stage_id"], ["project_stages.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stage_id", "version", name="uq_deliverable_stage_version"),
    )
    op.create_index("ix_deliverables_project_id", "deliverables", ["project_id"])
    op.create_index("ix_deliverables_stage_id", "deliverables", ["stage_id"])

    # deliverable_comments
    op.create_table(
        "deliverable_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("deliverable_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("x_pct", sa.Float(), nullable=False),
        sa.Column("y_pct", sa.Float(), nullable=False),
        sa.Column("page_or_frame", sa.Integer(), server_default="1", nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("round_number", sa.Integer(), server_default="1", nullable=False),
        sa.Column("consumes_round", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("x_pct >= 0 AND x_pct <= 100", name="ck_comment_x_pct"),
        sa.CheckConstraint("y_pct >= 0 AND y_pct <= 100", name="ck_comment_y_pct"),
        sa.CheckConstraint("page_or_frame >= 1", name="ck_comment_page"),
        sa.CheckConstraint("length(trim(body)) > 0", name="ck_comment_body"),
        sa.ForeignKeyConstraint(["deliverable_id"], ["deliverables.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deliverable_comments_deliverable_id", "deliverable_comments", ["deliverable_id"])


def downgrade() -> None:
    # deliverable_comments
    op.drop_index("ix_deliverable_comments_deliverable_id", table_name="deliverable_comments")
    op.drop_table("deliverable_comments")

    # deliverables
    op.drop_index("ix_deliverables_stage_id", table_name="deliverables")
    op.drop_index("ix_deliverables_project_id", table_name="deliverables")
    op.drop_table("deliverables")

    # project_stages
    op.drop_index("ix_project_stages_project_id", table_name="project_stages")
    op.drop_table("project_stages")
