"""Sprint 5 models: deliverable visibility/handover flags and project_specifications

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # deliverables: client-portal visibility and final-handover publication metadata
    op.add_column(
        "deliverables",
        sa.Column("is_client_visible", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "deliverables",
        sa.Column("is_final_handover", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "deliverables",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("deliverables", sa.Column("published_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_deliverables_published_by",
        "deliverables",
        "users",
        ["published_by"],
        ["id"],
    )

    # project_specifications (FF&E documentation: no quantity/price/stock columns)
    op.create_table(
        "project_specifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "furniture", "lighting", "finishes", "equipment", "other",
                name="specification_category", native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=120), nullable=True),
        sa.Column("manufacturer", sa.String(length=255), nullable=True),
        sa.Column("finish", sa.String(length=255), nullable=True),
        sa.Column("dimensions", sa.String(length=255), nullable=True),
        sa.Column("supplier", sa.String(length=255), nullable=True),
        sa.Column("reference_url", sa.String(length=500), nullable=True),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_specification_name"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_specifications_project_id", "project_specifications", ["project_id"])


def downgrade() -> None:
    # project_specifications
    op.drop_index("ix_project_specifications_project_id", table_name="project_specifications")
    op.drop_table("project_specifications")

    # deliverables (reverse order of the upgrade additions)
    op.drop_constraint("fk_deliverables_published_by", "deliverables", type_="foreignkey")
    op.drop_column("deliverables", "published_by")
    op.drop_column("deliverables", "published_at")
    op.drop_column("deliverables", "is_final_handover")
    op.drop_column("deliverables", "is_client_visible")
