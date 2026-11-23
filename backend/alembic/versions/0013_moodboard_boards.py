"""Moodboard boards: table, moodboard_items.moodboard_id and backfill.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-23

Before this revision every ``moodboard_items`` row hung directly off its
project. Boards introduce a curated grouping, so this migration:

- creates the ``moodboards`` table (indexed by project);
- adds the nullable ``moodboard_items.moodboard_id`` column and its index;
- backfills legacy pieces: each project with unassigned pieces reuses its
  first board or gets a "Moodboard 01" (editorial collage, position 0), then
  every piece is linked to that board.

Inspector checks keep every step idempotent and dialect-portable (no
``IF NOT EXISTS``), following the reconciliation pattern of 0007/0012.
"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LAYOUT_VARIANTS = ("editorial_collage", "atelier_grid", "monograph_strip")
DEFAULT_LAYOUT = "editorial_collage"
DEFAULT_TITLE = "Moodboard 01"


def _moodboard_tables() -> tuple[sa.TableClause, sa.TableClause]:
    """Typed Core tables so UUID/DateTime binding stays portable."""
    moodboards = sa.table(
        "moodboards",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("project_id", sa.Uuid(as_uuid=True)),
        sa.column("title", sa.String()),
        sa.column("curatorial_note", sa.Text()),
        sa.column("layout_variant", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("created_by", sa.Uuid(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    moodboard_items = sa.table(
        "moodboard_items",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("project_id", sa.Uuid(as_uuid=True)),
        sa.column("moodboard_id", sa.Uuid(as_uuid=True)),
        sa.column("created_by", sa.Uuid(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    return moodboards, moodboard_items


def _backfill(bind) -> None:
    """Link every piece without a board to its project's board.

    A project that already has a board reuses its first one; otherwise a
    "Moodboard 01" is inserted authored by the oldest unassigned piece.
    """
    moodboards, moodboard_items = _moodboard_tables()

    project_ids = (
        bind.execute(
            sa.select(moodboard_items.c.project_id)
            .where(moodboard_items.c.moodboard_id.is_(None))
            .group_by(moodboard_items.c.project_id)
        )
        .scalars()
        .all()
    )

    for project_id in project_ids:
        board_id = bind.execute(
            sa.select(moodboards.c.id)
            .where(moodboards.c.project_id == project_id)
            .order_by(moodboards.c.position.asc(), moodboards.c.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()

        if board_id is None:
            created_by = bind.execute(
                sa.select(moodboard_items.c.created_by)
                .where(
                    moodboard_items.c.project_id == project_id,
                    moodboard_items.c.moodboard_id.is_(None),
                )
                .order_by(moodboard_items.c.created_at.asc())
                .limit(1)
            ).scalar_one_or_none()
            now = datetime.now(timezone.utc)
            board_id = uuid.uuid4()
            bind.execute(
                moodboards.insert().values(
                    id=board_id,
                    project_id=project_id,
                    title=DEFAULT_TITLE,
                    curatorial_note=None,
                    layout_variant=DEFAULT_LAYOUT,
                    position=0,
                    created_by=created_by,
                    created_at=now,
                    updated_at=now,
                )
            )

        bind.execute(
            sa.update(moodboard_items)
            .where(
                moodboard_items.c.project_id == project_id,
                moodboard_items.c.moodboard_id.is_(None),
            )
            .values(moodboard_id=board_id)
        )


def upgrade() -> None:
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("moodboards"):
        op.create_table(
            "moodboards",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "project_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("projects.id"),
                nullable=False,
            ),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("curatorial_note", sa.Text(), nullable=True),
            sa.Column(
                "layout_variant",
                sa.Enum(
                    *LAYOUT_VARIANTS,
                    name="moodboard_layout",
                    native_enum=False,
                ),
                server_default=DEFAULT_LAYOUT,
                nullable=False,
            ),
            sa.Column(
                "position",
                sa.Integer(),
                server_default="0",
                nullable=False,
            ),
            sa.Column(
                "created_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    # Indexes are reconciled separately so a database that already has the
    # table still converges to the same shape.
    board_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("moodboards")
    }
    if "ix_moodboards_project_id" not in board_indexes:
        op.create_index("ix_moodboards_project_id", "moodboards", ["project_id"])

    item_columns = {
        column["name"]
        for column in sa.inspect(bind).get_columns("moodboard_items")
    }
    if "moodboard_id" not in item_columns:
        # ADD COLUMN with an inline REFERENCES clause is portable, but SQLite
        # rejects Alembic's ALTER-constraint path: emit the dialect type name.
        uuid_type = "CHAR(32)" if bind.dialect.name == "sqlite" else "UUID"
        bind.execute(
            sa.text(
                "ALTER TABLE moodboard_items ADD COLUMN moodboard_id "
                f"{uuid_type} REFERENCES moodboards (id)"
            )
        )

    item_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("moodboard_items")
    }
    if "ix_moodboard_items_moodboard_id" not in item_indexes:
        op.create_index(
            "ix_moodboard_items_moodboard_id",
            "moodboard_items",
            ["moodboard_id"],
        )

    _backfill(bind)


def downgrade() -> None:
    bind = op.get_bind()

    item_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("moodboard_items")
    }
    if "ix_moodboard_items_moodboard_id" in item_indexes:
        op.drop_index(
            "ix_moodboard_items_moodboard_id", table_name="moodboard_items"
        )

    item_columns = {
        column["name"]
        for column in sa.inspect(bind).get_columns("moodboard_items")
    }
    if "moodboard_id" in item_columns:
        op.drop_column("moodboard_items", "moodboard_id")

    if sa.inspect(bind).has_table("moodboards"):
        board_indexes = {
            index["name"] for index in sa.inspect(bind).get_indexes("moodboards")
        }
        if "ix_moodboards_project_id" in board_indexes:
            op.drop_index("ix_moodboards_project_id", table_name="moodboards")
        op.drop_table("moodboards")
