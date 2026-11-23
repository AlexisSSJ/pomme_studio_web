"""Add the explicit client confirmation seal to brief_items.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-23

``client_confirmed`` is the client's explicit "this question is finished"
seal, independent from the automatic answered-based ``status``. The inspector
check keeps the migration idempotent and dialect-portable (no ``IF NOT EXISTS``),
following the reconciliation pattern introduced in 0007.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("brief_items")}
    if "client_confirmed" not in existing:
        bind.execute(
            sa.text(
                "ALTER TABLE brief_items ADD COLUMN client_confirmed BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )


def downgrade() -> None:
    op.drop_column("brief_items", "client_confirmed")
