"""Brief item images table and legacy images migration.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-23

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "brief_item_images",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "item_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("brief_items.id"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.UniqueConstraint("item_id", "position", name="uq_brief_item_image_position"),
    )
    op.create_index(
        "ix_brief_item_images_item_id", "brief_item_images", ["item_id"]
    )

    # Copy each legacy image into the child table as position 1. Typed Core
    # tables keep the UUID binding portable across PostgreSQL and SQLite, and
    # the NOT EXISTS guard makes the copy idempotent.
    brief_items = sa.table(
        "brief_items",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("item_type", sa.String()),
        sa.column("image_storage_key", sa.String()),
        sa.column("content_type", sa.String()),
        sa.column("size_bytes", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    brief_item_images = sa.table(
        "brief_item_images",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("item_id", sa.Uuid(as_uuid=True)),
        sa.column("storage_key", sa.String()),
        sa.column("content_type", sa.String()),
        sa.column("size_bytes", sa.Integer()),
        sa.column("position", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            brief_items.c.id,
            brief_items.c.image_storage_key,
            brief_items.c.content_type,
            brief_items.c.size_bytes,
            brief_items.c.created_at,
        ).where(
            brief_items.c.image_storage_key.is_not(None),
            brief_items.c.item_type == "question",
            ~sa.exists().where(
                brief_item_images.c.item_id == brief_items.c.id
            ),
        )
    ).fetchall()

    for row in rows:
        bind.execute(
            brief_item_images.insert().values(
                id=uuid.uuid4(),
                item_id=row.id,
                storage_key=row.image_storage_key,
                content_type=row.content_type,
                size_bytes=row.size_bytes,
                position=1,
                created_at=row.created_at,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_brief_item_images_item_id", table_name="brief_item_images")
    op.drop_table("brief_item_images")
