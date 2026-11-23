"""Tests for migration 0010's idempotent client_confirmed column addition.

Loads the migration module directly (the ``op`` proxy is only touched inside
``upgrade()``) and exercises it on an in-memory SQLite table shaped like the
current ``brief_items`` (post-0009). The inspector guard makes the ADD COLUMN
idempotent and dialect-portable, so the same logic is safe on PostgreSQL.
"""

import importlib.util
import pathlib

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "backend"
    / "alembic"
    / "versions"
    / "0010_brief_item_client_confirmed.py"
)

# Current table shape (simplified core + status), without client_confirmed.
BASE_DDL = """
CREATE TABLE brief_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    category VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    prompt VARCHAR(500),
    answer TEXT,
    created_by CHAR(32) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0010", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(engine) -> None:
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
        conn.commit()


def test_upgrade_adds_client_confirmed_with_false_default():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text(BASE_DDL))
        # A pre-existing row must receive the FALSE default, not NULL.
        conn.execute(
            sa.text(
                "INSERT INTO brief_items "
                "(id, project_id, item_type, category, created_by, created_at, updated_at) "
                "VALUES ('x', 'p', 'question', 'general', 'u', '2026-01-01', '2026-01-01')"
            )
        )

    _run_upgrade(engine)

    with engine.connect() as conn:
        cols = {c["name"]: c for c in sa.inspect(conn).get_columns("brief_items")}
        assert "client_confirmed" in cols
        assert cols["client_confirmed"]["nullable"] is False
        value = conn.execute(
            sa.text("SELECT client_confirmed FROM brief_items")
        ).scalar_one()
        assert value in (False, 0)


def test_upgrade_is_idempotent():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text(BASE_DDL))

    _run_upgrade(engine)
    _run_upgrade(engine)  # second run must not raise on the existing column

    with engine.connect() as conn:
        cols = [c["name"] for c in sa.inspect(conn).get_columns("brief_items")]
        assert cols.count("client_confirmed") == 1
