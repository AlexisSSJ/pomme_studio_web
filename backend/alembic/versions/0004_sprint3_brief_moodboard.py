"""Sprint 3 models: brief items, moodboard items and reactions

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # brief_items
    op.create_table(
        "brief_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "item_type",
            sa.Enum("question", "reference", name="brief_item_type", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "category",
            sa.Enum("branding", "interior", "general", name="brief_category", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "in_progress", "completed", name="brief_status", native_enum=False),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("prompt", sa.String(length=500), nullable=True),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("storage_key", sa.String(length=500), nullable=True),
        sa.Column("response_type", sa.String(length=50), nullable=True),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("image_storage_key", sa.String(length=500), nullable=True),
        sa.Column("audio_url", sa.String(length=500), nullable=True),
        sa.Column("audio_storage_key", sa.String(length=500), nullable=True),
        sa.Column("audio_transcription", sa.Text(), nullable=True),
        sa.Column("transcription", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(item_type = 'question' AND prompt IS NOT NULL) OR (item_type = 'reference' AND storage_key IS NOT NULL)",
            name="ck_brief_item_shape",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_brief_items_project_id", "brief_items", ["project_id"])

    # moodboard_items
    op.create_table(
        "moodboard_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moodboard_items_project_id", "moodboard_items", ["project_id"])

    # moodboard_reactions
    op.create_table(
        "moodboard_reactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("moodboard_item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "reaction",
            sa.Enum("like", "dislike", "comment", name="moodboard_reaction", native_enum=False),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(reaction <> 'comment') OR (comment IS NOT NULL AND length(trim(comment)) > 0)",
            name="ck_reaction_comment_required",
        ),
        sa.ForeignKeyConstraint(["moodboard_item_id"], ["moodboard_items.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("moodboard_item_id", "user_id", name="uq_moodboard_reaction_user"),
    )
    op.create_index("ix_moodboard_reactions_moodboard_item_id", "moodboard_reactions", ["moodboard_item_id"])
    op.create_index("ix_moodboard_reactions_user_id", "moodboard_reactions", ["user_id"])


def downgrade() -> None:
    # moodboard_reactions
    op.drop_index("ix_moodboard_reactions_user_id", table_name="moodboard_reactions")
    op.drop_index("ix_moodboard_reactions_moodboard_item_id", table_name="moodboard_reactions")
    op.drop_table("moodboard_reactions")

    # moodboard_items
    op.drop_index("ix_moodboard_items_project_id", table_name="moodboard_items")
    op.drop_table("moodboard_items")

    # brief_items
    op.drop_index("ix_brief_items_project_id", table_name="brief_items")
    op.drop_table("brief_items")
