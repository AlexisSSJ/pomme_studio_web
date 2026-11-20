"""Sprint 2 models: leads, meetings, and project extensions

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # leads
    op.create_table(
        "leads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("contact_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "service_type",
            sa.Enum("branding", "interior", "integral", name="service_type", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "space_type",
            sa.Enum("residential", "commercial", "hospitality", "office", name="space_type", native_enum=False),
            nullable=True,
        ),
        sa.Column("area_m2", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column(
            "budget_range",
            sa.Enum(
                "under_10k",
                "10k_25k",
                "25k_50k",
                "50k_100k",
                "over_100k",
                name="budget_range",
                native_enum=False,
            ),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "new",
                "contacted",
                "qualified",
                "proposal_sent",
                "converted",
                "discarded",
                name="lead_status",
                native_enum=False,
            ),
            server_default="new",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_leads_email", "leads", ["email"])

    # projects: rename name -> title and add Sprint 2 columns
    op.alter_column(
        "projects",
        "name",
        new_column_name="title",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )
    op.add_column(
        "projects",
        sa.Column("lead_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_projects_lead_id", "projects", ["lead_id"])
    op.create_foreign_key("fk_projects_lead_id", "projects", "leads", ["lead_id"], ["id"])
    op.add_column(
        "projects",
        sa.Column(
            "scope_type",
            sa.Enum("branding", "interior", "integral", name="service_type", native_enum=False),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "active",
                "on_hold",
                "completed",
                "cancelled",
                name="project_status",
                native_enum=False,
            ),
            server_default="draft",
            nullable=False,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("included_rounds", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "projects",
        sa.Column("remaining_rounds", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "projects",
        sa.Column("balance_paid", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    # meetings
    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lead_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("google_event_id", sa.String(length=255), nullable=True),
        sa.Column("meet_link", sa.String(length=512), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "meeting_type",
            sa.Enum("discovery", "proposal", "review", "follow_up", name="meeting_type", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "scheduled",
                "confirmed",
                "cancelled",
                "completed",
                "no_show",
                name="meeting_status",
                native_enum=False,
            ),
            server_default="scheduled",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("end_time > start_time", name="ck_meeting_time_order"),
        sa.CheckConstraint(
            "(lead_id IS NOT NULL) <> (project_id IS NOT NULL)",
            name="ck_meeting_single_parent",
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meetings_lead_id", "meetings", ["lead_id"])
    op.create_index("ix_meetings_project_id", "meetings", ["project_id"])
    op.create_index("ix_meetings_start_time", "meetings", ["start_time"])


def downgrade() -> None:
    # meetings
    op.drop_index("ix_meetings_start_time", table_name="meetings")
    op.drop_index("ix_meetings_project_id", table_name="meetings")
    op.drop_index("ix_meetings_lead_id", table_name="meetings")
    op.drop_table("meetings")

    # projects: drop Sprint 2 columns and rename title -> name
    op.drop_column("projects", "balance_paid")
    op.drop_column("projects", "remaining_rounds")
    op.drop_column("projects", "included_rounds")
    op.drop_column("projects", "status")
    op.drop_column("projects", "scope_type")
    op.drop_constraint("fk_projects_lead_id", "projects", type_="foreignkey")
    op.drop_index("ix_projects_lead_id", table_name="projects")
    op.drop_column("projects", "lead_id")
    op.alter_column(
        "projects",
        "title",
        new_column_name="name",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )

    # leads
    op.drop_index("ix_leads_email", table_name="leads")
    op.drop_table("leads")
