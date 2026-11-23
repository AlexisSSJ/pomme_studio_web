"""Tests for migration 0014: comment threads replace moodboard reactions.

Loads the migration module directly (the ``op`` proxy is only touched inside
``upgrade()``/``downgrade()``) and exercises it on in-memory SQLite tables
shaped like post-0013 ``moodboard_items`` and ``moodboard_reactions``. The
inspector guards keep every step idempotent and dialect-portable, so the same
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
    / "0014_moodboard_comments.py"
)

PROJECT_ONE = uuid.uuid4()
USER_ONE = uuid.uuid4()
USER_TWO = uuid.uuid4()
ITEM_ONE = uuid.uuid4()
ITEM_TWO = uuid.uuid4()

REACTION_ONE = uuid.uuid4()
REACTION_TWO = uuid.uuid4()
REACTION_THREE = uuid.uuid4()
REACTION_LIKE = uuid.uuid4()

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

MOODBOARD_ITEMS_DDL = """
CREATE TABLE moodboard_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    moodboard_id CHAR(32),
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

MOODBOARD_REACTIONS_DDL = """
CREATE TABLE moodboard_reactions (
    id CHAR(32) PRIMARY KEY,
    moodboard_item_id CHAR(32) NOT NULL,
    user_id CHAR(32) NOT NULL,
    reaction VARCHAR(7) NOT NULL,
    comment TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT uq_moodboard_reaction_user UNIQUE (moodboard_item_id, user_id),
    CONSTRAINT ck_reaction_comment_required CHECK (
        (reaction <> 'comment')
        OR (comment IS NOT NULL AND length(trim(comment)) > 0)
    )
)
"""

REACTION_INDEX_DDL = [
    "CREATE INDEX ix_moodboard_reactions_moodboard_item_id "
    "ON moodboard_reactions (moodboard_item_id)",
    "CREATE INDEX ix_moodboard_reactions_user_id "
    "ON moodboard_reactions (user_id)",
]


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0014", MIGRATION_PATH)
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


def _insert_item(conn, item_id: uuid.UUID, created_by: uuid.UUID) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO moodboard_items "
            "(id, project_id, moodboard_id, title, file_name, content_type, "
            "size_bytes, storage_key, sort_order, created_by, created_at, updated_at) "
            "VALUES (:id, :project_id, NULL, 'Pieza', 'pin.png', 'image/png', "
            "16, :storage_key, 0, :created_by, '2026-01-01 00:00:00', "
            "'2026-01-01 00:00:00')"
        ),
        {
            "id": item_id.hex,
            "project_id": PROJECT_ONE.hex,
            "storage_key": f"{PROJECT_ONE}/{item_id.hex}.png",
            "created_by": created_by.hex,
        },
    )


def _insert_reaction(
    conn,
    reaction_id: uuid.UUID,
    item_id: uuid.UUID,
    user_id: uuid.UUID,
    reaction: str,
    comment: str | None,
    created_at: str,
) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO moodboard_reactions "
            "(id, moodboard_item_id, user_id, reaction, comment, created_at, updated_at) "
            "VALUES (:id, :item_id, :user_id, :reaction, :comment, :created_at, :created_at)"
        ),
        {
            "id": reaction_id.hex,
            "item_id": item_id.hex,
            "user_id": user_id.hex,
            "reaction": reaction,
            "comment": comment,
            "created_at": created_at,
        },
    )


def _seed_engine() -> sa.Engine:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text(USERS_DDL))
        conn.execute(sa.text(PROJECTS_DDL))
        conn.execute(sa.text(MOODBOARD_ITEMS_DDL))
        conn.execute(sa.text(MOODBOARD_REACTIONS_DDL))
        for statement in REACTION_INDEX_DDL:
            conn.execute(sa.text(statement))
        conn.execute(
            sa.text("INSERT INTO users (id) VALUES (:id)"), {"id": USER_ONE.hex}
        )
        conn.execute(
            sa.text("INSERT INTO users (id) VALUES (:id)"), {"id": USER_TWO.hex}
        )
        conn.execute(
            sa.text("INSERT INTO projects (id) VALUES (:id)"),
            {"id": PROJECT_ONE.hex},
        )
        _insert_item(conn, ITEM_ONE, USER_ONE)
        _insert_item(conn, ITEM_TWO, USER_ONE)

        # Two comment threads and a like; one pair per (item, user).
        _insert_reaction(
            conn,
            REACTION_ONE,
            ITEM_ONE,
            USER_ONE,
            "comment",
            "Primera nota",
            "2026-01-01 10:00:00",
        )
        _insert_reaction(
            conn,
            REACTION_TWO,
            ITEM_ONE,
            USER_TWO,
            "comment",
            "Nota de dos",
            "2026-01-02 10:00:00",
        )
        _insert_reaction(
            conn,
            REACTION_THREE,
            ITEM_TWO,
            USER_ONE,
            "comment",
            "Segunda nota",
            "2026-01-03 10:00:00",
        )
        _insert_reaction(
            conn,
            REACTION_LIKE,
            ITEM_TWO,
            USER_TWO,
            "like",
            None,
            "2026-01-04 10:00:00",
        )
    return engine


def _comments_for(conn, comment_id: uuid.UUID):
    return conn.execute(
        sa.text("SELECT * FROM moodboard_comments WHERE id = :id"),
        {"id": comment_id.hex},
    ).mappings().first()


def test_upgrade_creates_comments_and_backfills_comment_reactions():
    engine = _seed_engine()

    _run(engine, "upgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert inspector.has_table("moodboard_comments")
        assert not inspector.has_table("moodboard_reactions")

        comment_columns = {
            column["name"] for column in inspector.get_columns("moodboard_comments")
        }
        assert comment_columns == {
            "id",
            "moodboard_item_id",
            "user_id",
            "comment",
            "created_at",
            "updated_at",
        }
        comment_indexes = {
            index["name"] for index in inspector.get_indexes("moodboard_comments")
        }
        assert comment_indexes == {
            "ix_moodboard_comments_moodboard_item_id",
            "ix_moodboard_comments_user_id",
        }

        assert (
            conn.execute(sa.text("SELECT count(*) FROM moodboard_comments")).scalar_one()
            == 3
        )

        # Every comment reaction survives verbatim, id included.
        row = _comments_for(conn, REACTION_ONE)
        assert row["moodboard_item_id"] == ITEM_ONE.hex
        assert row["user_id"] == USER_ONE.hex
        assert row["comment"] == "Primera nota"
        assert row["created_at"] == "2026-01-01 10:00:00"
        assert row["updated_at"] == "2026-01-01 10:00:00"

        row = _comments_for(conn, REACTION_TWO)
        assert row["user_id"] == USER_TWO.hex
        assert row["comment"] == "Nota de dos"

        row = _comments_for(conn, REACTION_THREE)
        assert row["moodboard_item_id"] == ITEM_TWO.hex
        assert row["comment"] == "Segunda nota"

        # Likes are discarded with the table.
        assert _comments_for(conn, REACTION_LIKE) is None


def test_upgrade_is_idempotent():
    engine = _seed_engine()

    _run(engine, "upgrade")
    _run(engine, "upgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert inspector.has_table("moodboard_comments")
        assert not inspector.has_table("moodboard_reactions")
        assert (
            conn.execute(sa.text("SELECT count(*) FROM moodboard_comments")).scalar_one()
            == 3
        )
        columns = [c["name"] for c in inspector.get_columns("moodboard_comments")]
        assert columns.count("comment") == 1


def test_downgrade_recreates_reactions_with_first_comment_per_pair():
    engine = _seed_engine()
    _run(engine, "upgrade")

    # A second comment from the same author on the same piece (a thread).
    later_comment = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO moodboard_comments "
                "(id, moodboard_item_id, user_id, comment, created_at, updated_at) "
                "VALUES (:id, :item_id, :user_id, 'Nota posterior', "
                "'2026-03-01 10:00:00', '2026-03-01 10:00:00')"
            ),
            {
                "id": later_comment.hex,
                "item_id": ITEM_ONE.hex,
                "user_id": USER_ONE.hex,
            },
        )

    _run(engine, "downgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert inspector.has_table("moodboard_reactions")
        assert not inspector.has_table("moodboard_comments")
        assert (
            inspector.get_unique_constraints("moodboard_reactions")[0]["name"]
            == "uq_moodboard_reaction_user"
        )
        check_names = {
            constraint["name"]
            for constraint in inspector.get_check_constraints("moodboard_reactions")
        }
        assert "ck_reaction_comment_required" in check_names
        index_names = {
            index["name"] for index in inspector.get_indexes("moodboard_reactions")
        }
        assert index_names == {
            "ix_moodboard_reactions_moodboard_item_id",
            "ix_moodboard_reactions_user_id",
        }

        rows = conn.execute(sa.text("SELECT * FROM moodboard_reactions")).mappings().all()
        assert len(rows) == 3
        assert {row["reaction"] for row in rows} == {"comment"}

        by_pair = {
            (row["moodboard_item_id"], row["user_id"]): row for row in rows
        }
        first = by_pair[(ITEM_ONE.hex, USER_ONE.hex)]
        assert first["id"] == REACTION_ONE.hex
        assert first["comment"] == "Primera nota"
        assert first["created_at"].startswith("2026-01-01 10:00:00")
        assert by_pair[(ITEM_ONE.hex, USER_TWO.hex)]["comment"] == "Nota de dos"
        assert by_pair[(ITEM_TWO.hex, USER_ONE.hex)]["comment"] == "Segunda nota"


def test_downgrade_is_idempotent():
    engine = _seed_engine()
    _run(engine, "upgrade")

    _run(engine, "downgrade")
    _run(engine, "downgrade")

    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        assert inspector.has_table("moodboard_reactions")
        assert not inspector.has_table("moodboard_comments")
        assert (
            conn.execute(sa.text("SELECT count(*) FROM moodboard_reactions")).scalar_one()
            == 3
        )
