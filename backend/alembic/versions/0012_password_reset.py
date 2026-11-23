"""Admin-mediated password reset: users.must_change_password + request queue.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-23

``users.must_change_password`` flags an account whose password was replaced by
a temporary one; the API blocks every endpoint except ``/auth/me`` and
``/auth/change-password`` until the user changes it. ``password_reset_requests``
is the SUPER_ADMIN queue fed by the public request endpoint.

The inspector checks keep the migration idempotent and dialect-portable (no
``IF NOT EXISTS``), following the reconciliation pattern of 0007/0010/0011.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RESET_STATUSES = ("pending", "approved", "rejected")
PENDING_UNIQUE_INDEX = "uq_password_reset_requests_pending_user"


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "must_change_password" not in existing:
        bind.execute(
            sa.text(
                "ALTER TABLE users ADD COLUMN must_change_password "
                "BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )

    if not sa.inspect(bind).has_table("password_reset_requests"):
        op.create_table(
            "password_reset_requests",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column(
                "status",
                sa.Enum(
                    *RESET_STATUSES,
                    name="password_reset_request_status",
                    native_enum=False,
                ),
                server_default="pending",
                nullable=False,
            ),
            sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "resolved_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
        )

    # Indexes are reconciled separately so a database that already has the
    # table (older 0012 run) still converges to the same shape.
    existing_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("password_reset_requests")
    }
    if "ix_password_reset_requests_user_id" not in existing_indexes:
        op.create_index(
            "ix_password_reset_requests_user_id",
            "password_reset_requests",
            ["user_id"],
        )
    if PENDING_UNIQUE_INDEX not in existing_indexes:
        # Partial unique index: at most one PENDING request per user, so two
        # concurrent public requests cannot create duplicates. Resolved
        # (approved/rejected) rows are outside the predicate and never block.
        op.create_index(
            PENDING_UNIQUE_INDEX,
            "password_reset_requests",
            ["user_id"],
            unique=True,
            postgresql_where=sa.text("status = 'pending'"),
            sqlite_where=sa.text("status = 'pending'"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("password_reset_requests"):
        existing_indexes = {
            index["name"]
            for index in sa.inspect(bind).get_indexes("password_reset_requests")
        }
        for index_name in (
            PENDING_UNIQUE_INDEX,
            "ix_password_reset_requests_user_id",
        ):
            if index_name in existing_indexes:
                op.drop_index(index_name, table_name="password_reset_requests")
        op.drop_table("password_reset_requests")

    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "must_change_password" in existing:
        op.drop_column("users", "must_change_password")
