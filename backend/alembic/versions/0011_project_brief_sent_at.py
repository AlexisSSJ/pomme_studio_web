"""Add the brief ready-to-answer gate to projects.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-23

``projects.brief_sent_at`` is the gate: NULL means the brief is still a studio
draft, so its questions are hidden from the project's CLIENT. Projects whose
brief was already answered before this change are backfilled from
``updated_at`` so they stay visible after deploy. The inspector check keeps
the migration idempotent and dialect-portable (no ``IF NOT EXISTS``), following
the reconciliation pattern of 0007/0010; the backfill is plain SQL with EXISTS
subqueries, valid on both SQLite and PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BACKFILL_SQL = """
UPDATE projects
SET brief_sent_at = updated_at
WHERE brief_sent_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM brief_items
      WHERE brief_items.project_id = projects.id
        AND brief_items.item_type = 'question'
        AND (
            brief_items.status = 'completed'
            OR brief_items.answer IS NOT NULL
            OR brief_items.image_storage_key IS NOT NULL
            OR brief_items.audio_storage_key IS NOT NULL
            OR EXISTS (
                SELECT 1
                FROM brief_item_images
                WHERE brief_item_images.item_id = brief_items.id
            )
        )
  )
"""


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "brief_sent_at" not in existing:
        op.add_column(
            "projects",
            sa.Column("brief_sent_at", sa.DateTime(timezone=True), nullable=True),
        )

    bind.execute(sa.text(BACKFILL_SQL))


def downgrade() -> None:
    op.drop_column("projects", "brief_sent_at")
