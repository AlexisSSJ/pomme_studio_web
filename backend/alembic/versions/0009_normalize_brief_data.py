"""Idempotent normalization of legacy brief data.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-23

Repairs enum casing, derives missing status/category/item_type/response_type,
restores placeholder prompts, syncs transcriptions and reconciles legacy image
keys with the brief_item_images child table. All statements are idempotent, so
the migration is safe to run on every deploy.
"""

from typing import Sequence, Union

from alembic import context, op
from sqlalchemy import text

from app.services.brief_normalization import (
    NORMALIZATION_STATEMENTS,
    copy_legacy_images,
    rewrite_legacy_image_urls,
)

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for statement in NORMALIZATION_STATEMENTS:
        op.execute(text(statement))

    if context.is_offline_mode():
        # `--sql` can only emit the portable statements; the two Python helpers
        # need a live connection to read rows. Production always runs online,
        # and `scripts/normalize_briefs.py` applies the same helpers on demand.
        return

    bind = op.get_bind()
    copy_legacy_images(bind)
    rewrite_legacy_image_urls(bind)


def downgrade() -> None:
    """No-op: data repairs cannot be reversed without discarding recovered data.

    The schema is untouched by this revision; running it again is harmless.
    """
