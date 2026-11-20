"""Sprint 2 hardening: active slot and lead conversion uniqueness

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint("uq_projects_lead_id", "projects", ["lead_id"])

    # MeetingStatus now persists its lowercase values, matching the 0002 schema
    # and the partial-index predicate for existing Sprint 2 databases as well.
    op.execute("UPDATE meetings SET status = lower(status)")
    op.create_index(
        "ux_meetings_start_time_active",
        "meetings",
        ["start_time"],
        unique=True,
        postgresql_where=sa.text("status != 'cancelled'"),
        sqlite_where=sa.text("status != 'cancelled'"),
    )


def downgrade() -> None:
    op.drop_index("ux_meetings_start_time_active", table_name="meetings")
    op.drop_constraint("uq_projects_lead_id", "projects", type_="unique")
    op.execute("UPDATE meetings SET status = upper(status)")
