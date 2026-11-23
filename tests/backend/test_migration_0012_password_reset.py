"""Tests for migration 0012's idempotent password reset additions.

Loads the migration module directly (the ``op`` proxy is only touched inside
``upgrade()``/``downgrade()``) and exercises it on in-memory SQLite tables
shaped like post-0011 ``users``. The inspector guards keep the ADD COLUMN, the
CREATE TABLE and the partial unique index idempotent and dialect-portable, so
the same logic is safe on PostgreSQL.
"""

import importlib.util
import pathlib

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "backend"
    / "alembic"
    / "versions"
    / "0012_password_reset.py"
)

# Current users table shape (simplified core columns), without must_change_password.
USERS_DDL = """
CREATE TABLE users (
    id CHAR(32) PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    specialty VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'CLIENT',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0012", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, step: str) -> None:
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, step)()
        conn.commit()


def _seed_engine() -> sa.Engine:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text(USERS_DDL))
        # A pre-existing row must receive the FALSE default, not NULL.
        conn.execute(
            sa.text(
                "INSERT INTO users (id, email, hashed_password, created_at, updated_at) "
                "VALUES ('u1', 'legacy@example.com', 'hash', '2026-01-01', '2026-01-01')"
            )
        )
    return engine


def test_upgrade_adds_flag_and_creates_request_table():
    engine = _seed_engine()

    _run(engine, "upgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        cols = {c["name"]: c for c in inspector.get_columns("users")}
        assert "must_change_password" in cols
        assert cols["must_change_password"]["nullable"] is False
        value = conn.execute(sa.text("SELECT must_change_password FROM users")).scalar_one()
        assert value in (False, 0)

        assert inspector.has_table("password_reset_requests")
        reset_cols = {
            c["name"] for c in inspector.get_columns("password_reset_requests")
        }
        assert reset_cols == {
            "id",
            "user_id",
            "status",
            "requested_at",
            "resolved_at",
            "resolved_by",
        }

        indexes = {
            index["name"]: index
            for index in inspector.get_indexes("password_reset_requests")
        }
        assert indexes["ix_password_reset_requests_user_id"]["unique"] in (False, 0)
        pending_index = indexes["uq_password_reset_requests_pending_user"]
        assert pending_index["unique"] in (True, 1)
        assert pending_index["column_names"] == ["user_id"]


def test_partial_unique_index_allows_one_pending_row_per_user():
    engine = _seed_engine()
    _run(engine, "upgrade")

    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO password_reset_requests (id, user_id, requested_at) "
                "VALUES ('r1', 'u1', '2026-01-01')"
            )
        )
        # A resolved row is outside the partial predicate and is allowed.
        conn.execute(
            sa.text(
                "INSERT INTO password_reset_requests "
                "(id, user_id, status, requested_at, resolved_at) "
                "VALUES ('r2', 'u1', 'approved', '2026-01-02', '2026-01-03')"
            )
        )

    with engine.connect() as conn:
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(
                sa.text(
                    "INSERT INTO password_reset_requests (id, user_id, requested_at) "
                    "VALUES ('r3', 'u1', '2026-01-04')"
                )
            )


def test_request_status_defaults_to_pending():
    engine = _seed_engine()
    _run(engine, "upgrade")

    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO password_reset_requests (id, user_id, requested_at) "
                "VALUES ('r1', 'u1', '2026-01-01')"
            )
        )

    with engine.connect() as conn:
        assert (
            conn.execute(
                sa.text("SELECT status FROM password_reset_requests")
            ).scalar_one()
            == "pending"
        )


def test_upgrade_is_idempotent():
    engine = _seed_engine()

    _run(engine, "upgrade")
    _run(engine, "upgrade")  # second run must not raise on existing objects

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        cols = [c["name"] for c in inspector.get_columns("users")]
        assert cols.count("must_change_password") == 1
        assert inspector.has_table("password_reset_requests")
        index_names = [
            index["name"]
            for index in inspector.get_indexes("password_reset_requests")
        ]
        assert index_names.count("uq_password_reset_requests_pending_user") == 1
        assert index_names.count("ix_password_reset_requests_user_id") == 1


def test_downgrade_removes_table_and_column():
    engine = _seed_engine()
    _run(engine, "upgrade")

    _run(engine, "downgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        cols = [c["name"] for c in inspector.get_columns("users")]
        assert "must_change_password" not in cols
        assert not inspector.has_table("password_reset_requests")
