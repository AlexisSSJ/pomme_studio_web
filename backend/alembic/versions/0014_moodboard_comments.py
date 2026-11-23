"""Moodboard comments: table, backfill from comments, drop reactions.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-23

Notion-style comment threads replace the like/dislike/comment reaction system:

- creates the ``moodboard_comments`` table and its two indexes;
- backfills every existing ``comment`` reaction row, preserving its id,
  text, author and timestamps (``like``/``dislike`` rows are discarded);
- drops ``moodboard_reactions`` once the comments are safe.

Inspector checks keep every step idempotent and dialect-portable, following
the reconciliation pattern of 0007/0012/0013. The downgrade recreates the
0004 reaction table and copies the first comment per ``(item, user)`` back.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REACTION_VALUES = ("like", "dislike", "comment")


def _comment_table() -> sa.TableClause:
    """Typed Core table so UUID/DateTime binding stays portable."""
    return sa.table(
        "moodboard_comments",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("moodboard_item_id", sa.Uuid(as_uuid=True)),
        sa.column("user_id", sa.Uuid(as_uuid=True)),
        sa.column("comment", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )


def _reaction_table() -> sa.TableClause:
    """Typed Core view of the pre-0014 reaction table."""
    return sa.table(
        "moodboard_reactions",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("moodboard_item_id", sa.Uuid(as_uuid=True)),
        sa.column("user_id", sa.Uuid(as_uuid=True)),
        sa.column("reaction", sa.String()),
        sa.column("comment", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )


def _comment_index_names(bind) -> set[str]:
    return {
        index["name"] for index in sa.inspect(bind).get_indexes("moodboard_comments")
    }


def _create_comment_indexes(bind) -> None:
    """Create the comment indexes a previously-created table may lack."""
    index_names = _comment_index_names(bind)
    if "ix_moodboard_comments_moodboard_item_id" not in index_names:
        op.create_index(
            "ix_moodboard_comments_moodboard_item_id",
            "moodboard_comments",
            ["moodboard_item_id"],
        )
    if "ix_moodboard_comments_user_id" not in index_names:
        op.create_index(
            "ix_moodboard_comments_user_id",
            "moodboard_comments",
            ["user_id"],
        )


def _backfill_comments(bind) -> None:
    """Copy comment reactions into the new table, preserving their ids.

    The NOT EXISTS guard makes the insert id-preserving and idempotent even
    if a partially-run upgrade left some rows behind.
    """
    comments = _comment_table()
    reactions = _reaction_table()

    already_copied = sa.select(comments.c.id).where(comments.c.id == reactions.c.id)
    source = sa.select(
        reactions.c.id,
        reactions.c.moodboard_item_id,
        reactions.c.user_id,
        reactions.c.comment,
        reactions.c.created_at,
        reactions.c.updated_at,
    ).where(
        reactions.c.reaction == "comment",
        reactions.c.comment.is_not(None),
        ~sa.exists(already_copied),
    )
    bind.execute(
        comments.insert().from_select(
            [
                "id",
                "moodboard_item_id",
                "user_id",
                "comment",
                "created_at",
                "updated_at",
            ],
            source,
        )
    )


def _drop_reaction_table(bind) -> None:
    """Drop the reaction table after its indexes, when it still exists."""
    if not sa.inspect(bind).has_table("moodboard_reactions"):
        return
    index_names = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("moodboard_reactions")
    }
    for name in (
        "ix_moodboard_reactions_moodboard_item_id",
        "ix_moodboard_reactions_user_id",
    ):
        if name in index_names:
            op.drop_index(name, table_name="moodboard_reactions")
    op.drop_table("moodboard_reactions")


def _create_reaction_table(bind) -> None:
    """Recreate the 0004 reaction table and its indexes when missing."""
    if not sa.inspect(bind).has_table("moodboard_reactions"):
        op.create_table(
            "moodboard_reactions",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("moodboard_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column(
                "reaction",
                sa.Enum(
                    *REACTION_VALUES,
                    name="moodboard_reaction",
                    native_enum=False,
                ),
                nullable=False,
            ),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "(reaction <> 'comment') OR (comment IS NOT NULL AND "
                "length(trim(comment)) > 0)",
                name="ck_reaction_comment_required",
            ),
            sa.ForeignKeyConstraint(["moodboard_item_id"], ["moodboard_items.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "moodboard_item_id",
                "user_id",
                name="uq_moodboard_reaction_user",
            ),
        )

    index_names = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("moodboard_reactions")
    }
    if "ix_moodboard_reactions_moodboard_item_id" not in index_names:
        op.create_index(
            "ix_moodboard_reactions_moodboard_item_id",
            "moodboard_reactions",
            ["moodboard_item_id"],
        )
    if "ix_moodboard_reactions_user_id" not in index_names:
        op.create_index(
            "ix_moodboard_reactions_user_id",
            "moodboard_reactions",
            ["user_id"],
        )


def _backfill_reactions(bind) -> None:
    """Copy the first comment per (item, user) back as a comment reaction."""
    comments = _comment_table()
    reactions = _reaction_table()

    rows = bind.execute(
        sa.select(
            comments.c.id,
            comments.c.moodboard_item_id,
            comments.c.user_id,
            comments.c.comment,
            comments.c.created_at,
            comments.c.updated_at,
        ).order_by(
            comments.c.moodboard_item_id.asc(),
            comments.c.user_id.asc(),
            comments.c.created_at.asc(),
            comments.c.id.asc(),
        )
    ).all()

    copied: set[tuple] = set()
    for row in rows:
        pair = (row.moodboard_item_id, row.user_id)
        if pair in copied:
            continue
        copied.add(pair)
        existing = bind.execute(
            sa.select(reactions.c.id).where(
                reactions.c.moodboard_item_id == row.moodboard_item_id,
                reactions.c.user_id == row.user_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue
        bind.execute(
            reactions.insert().values(
                id=row.id,
                moodboard_item_id=row.moodboard_item_id,
                user_id=row.user_id,
                reaction="comment",
                comment=row.comment,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )


def upgrade() -> None:
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("moodboard_comments"):
        op.create_table(
            "moodboard_comments",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "moodboard_item_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("moodboard_items.id"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("comment", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    _create_comment_indexes(bind)

    if sa.inspect(bind).has_table("moodboard_reactions"):
        _backfill_comments(bind)

    _drop_reaction_table(bind)


def downgrade() -> None:
    bind = op.get_bind()

    _create_reaction_table(bind)

    if sa.inspect(bind).has_table("moodboard_comments"):
        _backfill_reactions(bind)
        index_names = _comment_index_names(bind)
        for name in (
            "ix_moodboard_comments_moodboard_item_id",
            "ix_moodboard_comments_user_id",
        ):
            if name in index_names:
                op.drop_index(name, table_name="moodboard_comments")
        op.drop_table("moodboard_comments")
