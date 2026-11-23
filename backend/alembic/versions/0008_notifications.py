"""Notifications table for project events.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        # Portable JSON column, identical to audit_logs.metadata_json.
        sa.Column(
            "payload",
            sa.JSON().with_variant(JSONB, "postgresql"),
            nullable=True,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_project_id", "notifications", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_notifications_project_id", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
