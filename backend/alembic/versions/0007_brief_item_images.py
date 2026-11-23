"""Brief item images table and legacy images migration.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-23

Why the column reconciliation below exists
------------------------------------------
Production applied the *original* revision 0004 (``0004_sprint3_brief_moodboard``)
before the multimodal columns were appended to that file. Alembic never re-runs
an already-applied revision, so production's ``brief_items`` table is missing
``image_storage_key`` and the other multimodal columns that the ORM model and
the current 0004 file now declare. The legacy-image copy in this migration
SELECTs ``brief_items.image_storage_key``, which made the 0007 upgrade fail in
production with ``column brief_items.image_storage_key does not exist``.

``_reconcile_brief_item_columns`` closes that schema drift by adding ONLY the
missing nullable columns before the copy loop. It is self-contained (takes an
explicit ``bind`` rather than relying on Alembic's ``op``), idempotent (an
inspector check skips columns that already exist -- no ``IF NOT EXISTS``
syntax, so it is portable across PostgreSQL and SQLite), and additive (it
never alters or drops existing columns or data).
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


def _reconcile_brief_item_columns(bind) -> list[str]:
    """Add multimodal columns missing from a drifted ``brief_items`` table.

    Production's 0004 predates these columns, so the table can be behind the
    ORM model. The inspector check makes this idempotent and dialect-portable
    (no ``IF NOT EXISTS``), and the plain ``ADD COLUMN`` statements are nullable
    with no defaults so they are safe on tables that already hold rows.

    Returns the list of column names that were actually added.
    """
    # (name, portable SQL type) -- exact types from app.models.brief_item.
    # Core columns (id, project_id, item_type, category, status, prompt, answer,
    # storage_key, created_by, created_at, updated_at) are deliberately omitted:
    # they have existed since the original 0004 table creation.
    multimodal_columns = (
        ("note", "VARCHAR(1000)"),
        ("file_name", "VARCHAR(255)"),
        ("content_type", "VARCHAR(100)"),
        ("size_bytes", "INTEGER"),
        ("response_type", "VARCHAR(50)"),
        ("image_url", "VARCHAR(500)"),
        ("image_storage_key", "VARCHAR(500)"),
        ("audio_url", "VARCHAR(500)"),
        ("audio_storage_key", "VARCHAR(500)"),
        ("audio_transcription", "TEXT"),
        ("transcription", "TEXT"),
    )

    existing = {column["name"] for column in sa.inspect(bind).get_columns("brief_items")}
    added: list[str] = []
    for name, column_type in multimodal_columns:
        if name in existing:
            continue
        bind.execute(
            sa.text(f"ALTER TABLE brief_items ADD COLUMN {name} {column_type}")
        )
        added.append(name)
    return added


def upgrade() -> None:
    # Reconcile production's drifted brief_items schema BEFORE the legacy-image
    # copy below reads image_storage_key (see module docstring for the why).
    _reconcile_brief_item_columns(op.get_bind())

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
