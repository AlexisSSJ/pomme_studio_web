"""Tests for migration 0013: moodboards table, moodboard_id and backfill.

Loads the migration module directly (the ``op`` proxy is only touched inside
``upgrade()``/``downgrade()``) and exercises it on in-memory SQLite tables
shaped like post-0012 ``moodboard_items``. The inspector guards keep the
CREATE TABLE and ADD COLUMN idempotent and dialect-portable, so the same
logic is safe on PostgreSQL.
"""

import importlib.util
import pathlib
import uuid

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "backend"
    / "alembic"
    / "versions"
    / "0013_moodboard_boards.py"
)

PROJECT_ONE = uuid.uuid4()
PROJECT_TWO = uuid.uuid4()
PROJECT_EMPTY = uuid.uuid4()
USER_ONE = uuid.uuid4()
USER_TWO = uuid.uuid4()

USERS_DDL = """
CREATE TABLE users (
    id CHAR(32) PRIMARY KEY
)
"""

PROJECTS_DDL = """
CREATE TABLE projects (
    id CHAR(32) PRIMARY KEY
)
"""

# Post-0012 moodboard_items: no moodboard_id yet.
MOODBOARD_ITEMS_DDL = """
CREATE TABLE moodboard_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by CHAR(32) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0013", MIGRATION_PATH)
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


def _insert_legacy_item(
    conn,
    project_id: uuid.UUID,
    created_by: uuid.UUID,
    created_at: str,
) -> uuid.UUID:
    """Insert a piece into the pre-0013 table (no moodboard_id column)."""
    item_id = uuid.uuid4()
    conn.execute(
        sa.text(
            "INSERT INTO moodboard_items "
            "(id, project_id, title, file_name, content_type, size_bytes, "
            "storage_key, sort_order, created_by, created_at, updated_at) "
            "VALUES (:id, :project_id, 'Pieza', 'pin.png', 'image/png', "
            "16, :storage_key, 0, :created_by, :created_at, :created_at)"
        ),
        {
            "id": item_id.hex,
            "project_id": project_id.hex,
            "storage_key": f"{project_id}/{item_id.hex}.png",
            "created_by": created_by.hex,
            "created_at": created_at,
        },
    )
    return item_id


def _insert_item(
    conn,
    project_id: uuid.UUID,
    created_by: uuid.UUID,
    created_at: str,
) -> uuid.UUID:
    """Insert a post-0013 piece with no board assigned."""
    item_id = uuid.uuid4()
    conn.execute(
        sa.text(
            "INSERT INTO moodboard_items "
            "(id, project_id, moodboard_id, title, file_name, content_type, "
            "size_bytes, storage_key, sort_order, created_by, created_at, updated_at) "
            "VALUES (:id, :project_id, NULL, 'Pieza', 'pin.png', 'image/png', "
            "16, :storage_key, 0, :created_by, :created_at, :created_at)"
        ),
        {
            "id": item_id.hex,
            "project_id": project_id.hex,
            "storage_key": f"{project_id}/{item_id.hex}.png",
            "created_by": created_by.hex,
            "created_at": created_at,
        },
    )
    return item_id


def _seed_engine() -> sa.Engine:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text(USERS_DDL))
        conn.execute(sa.text(PROJECTS_DDL))
        conn.execute(sa.text(MOODBOARD_ITEMS_DDL))
        conn.execute(
            sa.text("INSERT INTO users (id) VALUES (:id)"),
            {"id": USER_ONE.hex},
        )
        conn.execute(
            sa.text("INSERT INTO users (id) VALUES (:id)"),
            {"id": USER_TWO.hex},
        )
        for project_id in (PROJECT_ONE, PROJECT_TWO, PROJECT_EMPTY):
            conn.execute(
                sa.text("INSERT INTO projects (id) VALUES (:id)"),
                {"id": project_id.hex},
            )
        # Project one: two pieces; USER_ONE uploaded the oldest one.
        _insert_legacy_item(conn, PROJECT_ONE, USER_ONE, "2026-01-01 00:00:00")
        _insert_legacy_item(conn, PROJECT_ONE, USER_TWO, "2026-01-02 00:00:00")
        # Project two: a single piece by USER_TWO.
        _insert_legacy_item(conn, PROJECT_TWO, USER_TWO, "2026-01-03 00:00:00")
    return engine


def _board_for(conn, project_id: uuid.UUID):
    return conn.execute(
        sa.text("SELECT * FROM moodboards WHERE project_id = :project_id"),
        {"project_id": project_id.hex},
    ).mappings().all()


def test_upgrade_creates_table_column_and_backfills():
    engine = _seed_engine()

    _run(engine, "upgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert inspector.has_table("moodboards")
        board_columns = {c["name"] for c in inspector.get_columns("moodboards")}
        assert board_columns == {
            "id",
            "project_id",
            "title",
            "curatorial_note",
            "layout_variant",
            "position",
            "created_by",
            "created_at",
            "updated_at",
        }
        index_names = {
            index["name"] for index in inspector.get_indexes("moodboards")
        }
        assert "ix_moodboards_project_id" in index_names

        item_columns = {
            c["name"]: c for c in inspector.get_columns("moodboard_items")
        }
        assert "moodboard_id" in item_columns
        assert item_columns["moodboard_id"]["nullable"] is True
        item_indexes = {
            index["name"] for index in inspector.get_indexes("moodboard_items")
        }
        assert "ix_moodboard_items_moodboard_id" in item_indexes

        # One "Moodboard 01" per project that had pieces (the empty one gets none).
        assert conn.execute(sa.text("SELECT count(*) FROM moodboards")).scalar_one() == 2
        assert _board_for(conn, PROJECT_EMPTY) == []

        board_one = _board_for(conn, PROJECT_ONE)
        assert len(board_one) == 1
        assert board_one[0]["title"] == "Moodboard 01"
        assert board_one[0]["layout_variant"] == "editorial_collage"
        assert board_one[0]["curatorial_note"] is None
        assert board_one[0]["position"] == 0
        assert board_one[0]["created_by"] == USER_ONE.hex

        board_two = _board_for(conn, PROJECT_TWO)
        assert len(board_two) == 1
        assert board_two[0]["created_by"] == USER_TWO.hex

        # Every legacy piece is linked to its project's board.
        unlinked = conn.execute(
            sa.text(
                "SELECT count(*) FROM moodboard_items WHERE moodboard_id IS NULL"
            )
        ).scalar_one()
        assert unlinked == 0
        for project_id, board in ((PROJECT_ONE, board_one[0]), (PROJECT_TWO, board_two[0])):
            linked = conn.execute(
                sa.text(
                    "SELECT count(*) FROM moodboard_items "
                    "WHERE project_id = :project_id AND moodboard_id = :board_id"
                ),
                {"project_id": project_id.hex, "board_id": board["id"]},
            ).scalar_one()
            expected = 2 if project_id == PROJECT_ONE else 1
            assert linked == expected


def test_upgrade_is_idempotent():
    engine = _seed_engine()

    _run(engine, "upgrade")
    _run(engine, "upgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        board_columns = [c["name"] for c in inspector.get_columns("moodboards")]
        assert board_columns.count("project_id") == 1
        item_columns = [c["name"] for c in inspector.get_columns("moodboard_items")]
        assert item_columns.count("moodboard_id") == 1
        assert conn.execute(sa.text("SELECT count(*) FROM moodboards")).scalar_one() == 2


def test_backfill_reuses_existing_board():
    engine = _seed_engine()
    _run(engine, "upgrade")

    # A piece added after the first run with no board (legacy/partial state).
    with engine.begin() as conn:
        _insert_item(conn, PROJECT_ONE, USER_TWO, "2026-02-01 00:00:00")

    _run(engine, "upgrade")

    with engine.connect() as conn:
        boards = _board_for(conn, PROJECT_ONE)
        assert len(boards) == 1
        assert conn.execute(
            sa.text("SELECT count(*) FROM moodboards")
        ).scalar_one() == 2
        linked = conn.execute(
            sa.text(
                "SELECT count(*) FROM moodboard_items "
                "WHERE project_id = :project_id AND moodboard_id = :board_id"
            ),
            {"project_id": PROJECT_ONE.hex, "board_id": boards[0]["id"]},
        ).scalar_one()
        assert linked == 3


def test_downgrade_removes_column_and_table():
    engine = _seed_engine()
    _run(engine, "upgrade")

    _run(engine, "downgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert not inspector.has_table("moodboards")
        item_columns = [c["name"] for c in inspector.get_columns("moodboard_items")]
        assert "moodboard_id" not in item_columns
