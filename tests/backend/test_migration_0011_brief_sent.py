"""Tests for migration 0011's idempotent projects.brief_sent_at backfill.

Loads the migration module directly (the ``op`` proxy is only touched inside
``upgrade()``) and exercises it on an in-memory SQLite schema shaped like the
current projects/brief_items/brief_item_images tables. The inspector guard
makes ADD COLUMN idempotent and dialect-portable, and the backfill uses plain
portable SQL with EXISTS subqueries (SQLite and PostgreSQL).
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
    / "0011_project_brief_sent_at.py"
)

PROJECTS_DDL = """
CREATE TABLE projects (
    id CHAR(32) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL{extra}
)
"""

BRIEF_ITEMS_DDL = """
CREATE TABLE brief_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    answer TEXT,
    image_storage_key VARCHAR(500),
    audio_storage_key VARCHAR(500)
)
"""

BRIEF_ITEM_IMAGES_DDL = """
CREATE TABLE brief_item_images (
    id CHAR(32) PRIMARY KEY,
    item_id CHAR(32) NOT NULL
)
"""


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0011", MIGRATION_PATH)
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


def _create_schema(conn, *, with_column: bool = False) -> None:
    extra = ", brief_sent_at DATETIME" if with_column else ""
    conn.execute(sa.text(PROJECTS_DDL.format(extra=extra)))
    conn.execute(sa.text(BRIEF_ITEMS_DDL))
    conn.execute(sa.text(BRIEF_ITEM_IMAGES_DDL))


def _insert_project(conn, project_id: str, updated_at: str) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO projects (id, title, status, created_at, updated_at) "
            "VALUES (:id, :title, 'active', '2026-01-01 00:00:00', :updated_at)"
        ),
        {"id": project_id, "title": f"Project {project_id}", "updated_at": updated_at},
    )


def _insert_question(
    conn,
    item_id: str,
    project_id: str,
    *,
    item_type: str = "question",
    status: str = "pending",
    answer: str | None = None,
    image_storage_key: str | None = None,
    audio_storage_key: str | None = None,
) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO brief_items "
            "(id, project_id, item_type, status, answer, image_storage_key, audio_storage_key) "
            "VALUES (:id, :project_id, :item_type, :status, :answer, :image_key, :audio_key)"
        ),
        {
            "id": item_id,
            "project_id": project_id,
            "item_type": item_type,
            "status": status,
            "answer": answer,
            "image_key": image_storage_key,
            "audio_key": audio_storage_key,
        },
    )


def test_upgrade_adds_nullable_column_and_is_idempotent():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        _create_schema(conn)
        _insert_project(conn, "p1", "2026-01-02 03:04:05")
        _insert_question(conn, "q1", "p1")

    _run_upgrade(engine)
    _run_upgrade(engine)  # second run must not raise on the existing column

    with engine.connect() as conn:
        columns = {c["name"]: c for c in sa.inspect(conn).get_columns("projects")}
        assert list(columns).count("brief_sent_at") == 1
        assert columns["brief_sent_at"]["nullable"] is True
        row = conn.execute(
            sa.text("SELECT updated_at, brief_sent_at FROM projects WHERE id = 'p1'")
        ).one()
        # An unanswered project is not backfilled.
        assert row.brief_sent_at is None


def test_backfill_marks_answered_projects_and_leaves_unanswered_null():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        _create_schema(conn)
        for project_id in ("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"):
            _insert_project(conn, project_id, "2026-01-02 03:04:05")

        # p1: a question completed by status.
        _insert_question(conn, "q1", "p1", status="completed")
        # p2: free-text answer.
        _insert_question(conn, "q2", "p2", answer="Respuesta escrita")
        # p3: legacy single image key.
        _insert_question(conn, "q3", "p3", image_storage_key="p3/legacy.png")
        # p4: voice note key.
        _insert_question(conn, "q4", "p4", audio_storage_key="p4/note.mp3")
        # p5: an image row in the child table.
        _insert_question(conn, "q5", "p5")
        conn.execute(
            sa.text(
                "INSERT INTO brief_item_images (id, item_id) VALUES ('i5', 'q5')"
            )
        )
        # p6: an untouched question.
        _insert_question(conn, "q6", "p6")
        # p7: only a completed reference item (not a question).
        _insert_question(conn, "q7", "p7", item_type="reference", status="completed")
        # p8: no brief items at all.

    _run_upgrade(engine)

    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, updated_at, brief_sent_at FROM projects")
        ).all()
        by_id = {row.id: row for row in rows}

    for project_id in ("p1", "p2", "p3", "p4", "p5"):
        assert by_id[project_id].brief_sent_at == by_id[project_id].updated_at
        assert by_id[project_id].brief_sent_at is not None

    for project_id in ("p6", "p7", "p8"):
        assert by_id[project_id].brief_sent_at is None


def test_upgrade_keeps_a_pre_existing_column_and_value():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        _create_schema(conn, with_column=True)
        _insert_project(conn, "p1", "2026-01-02 03:04:05")
        conn.execute(
            sa.text("UPDATE projects SET brief_sent_at = '2025-05-05 00:00:00' WHERE id = 'p1'")
        )
        # A second project that still needs the backfill.
        _insert_project(conn, "p2", "2026-01-03 00:00:00")
        _insert_question(conn, "q2", "p2", status="completed")

    _run_upgrade(engine)
    _run_upgrade(engine)

    with engine.connect() as conn:
        columns = [c["name"] for c in sa.inspect(conn).get_columns("projects")]
        assert columns.count("brief_sent_at") == 1
        preserved = conn.execute(
            sa.text("SELECT brief_sent_at FROM projects WHERE id = 'p1'")
        ).scalar_one()
        assert preserved == "2025-05-05 00:00:00"
        backfilled = conn.execute(
            sa.text("SELECT brief_sent_at FROM projects WHERE id = 'p2'")
        ).scalar_one()
        assert backfilled == "2026-01-03 00:00:00"
