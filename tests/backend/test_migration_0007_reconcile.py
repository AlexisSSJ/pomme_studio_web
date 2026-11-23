"""TDD tests for migration 0007's idempotent brief_items column reconciliation.

Production applied the original 0004 migration before the multimodal columns
were added to that file, so Alembic never re-ran it and production's
``brief_items`` table is missing those columns. Migration 0007 reads
``image_storage_key`` in its legacy-image copy and therefore failed with
"column brief_items.image_storage_key does not exist". The migration now
reconciles the missing columns idempotently before the copy loop.

These tests load the migration module directly (the ``op`` proxy is only
touched inside ``upgrade()``) and exercise the helper on a legacy-shaped
in-memory SQLite table, which is portable to PostgreSQL as well.
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
    / "0007_brief_item_images.py"
)

# Exact multimodal column set and order from app.models.brief_item.
EXPECTED_COLUMNS = [
    "note",
    "file_name",
    "content_type",
    "size_bytes",
    "response_type",
    "image_url",
    "image_storage_key",
    "audio_url",
    "audio_storage_key",
    "audio_transcription",
    "transcription",
]

# Core columns present since the original table creation.
CORE_COLUMNS = [
    "id",
    "project_id",
    "item_type",
    "category",
    "status",
    "prompt",
    "answer",
    "storage_key",
    "created_by",
    "created_at",
    "updated_at",
]

LEGACY_DDL = """
CREATE TABLE brief_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    category VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    prompt VARCHAR(500),
    answer TEXT,
    storage_key VARCHAR(500),
    created_by CHAR(32) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""


def _load_migration_module():
    """Load 0007 by path so no Alembic op context is needed at import time."""
    spec = importlib.util.spec_from_file_location("migration_0007", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _column_names(conn) -> set[str]:
    return {column["name"] for column in sa.inspect(conn).get_columns("brief_items")}


def test_reconcile_adds_missing_multimodal_columns():
    """A legacy table gets exactly the 11 missing columns, core columns intact.

    Also runs the real ``upgrade()`` (under a lightweight Alembic Operations
    context) after reconciliation to confirm the legacy-image copy still works
    end-to-end on the reconciled table.
    """
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        assert set(EXPECTED_COLUMNS).isdisjoint(_column_names(conn))

        added = module._reconcile_brief_item_columns(conn)

        assert added == EXPECTED_COLUMNS
        present = _column_names(conn)
        for name in EXPECTED_COLUMNS:
            assert name in present
        for name in CORE_COLUMNS:
            assert name in present

        # The formerly-missing column is now writable/readable.
        item_id = uuid.uuid4().hex
        conn.execute(
            sa.text(
                "INSERT INTO brief_items "
                "(id, project_id, item_type, category, status, created_by, "
                " created_at, updated_at, image_storage_key, content_type, size_bytes) "
                "VALUES (:id, :project_id, 'question', 'general', 'pending', "
                "        :created_by, :created_at, :updated_at, :image_storage_key, "
                "        :content_type, :size_bytes)"
            ),
            {
                "id": item_id,
                "project_id": uuid.uuid4().hex,
                "created_by": uuid.uuid4().hex,
                "created_at": "2026-01-01 00:00:00",
                "updated_at": "2026-01-01 00:00:00",
                "image_storage_key": "brief/img.png",
                "content_type": "image/png",
                "size_bytes": 123,
            },
        )
        stored = conn.execute(
            sa.text("SELECT image_storage_key FROM brief_items WHERE id = :id"),
            {"id": item_id},
        ).scalar_one()
        assert stored == "brief/img.png"

        # The copy loop (inseparable from Alembic's `op`) is driven here via a
        # lightweight Operations context. Reconcile is a no-op on second call;
        # the legacy image must land in the child table as position 1.
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()

        copied = conn.execute(
            sa.text(
                "SELECT item_id, storage_key, content_type, size_bytes, position "
                "FROM brief_item_images"
            )
        ).fetchall()
        assert len(copied) == 1
        assert str(copied[0][0]) == item_id
        assert copied[0][1] == "brief/img.png"
        assert copied[0][2] == "image/png"
        assert copied[0][3] == 123
        assert copied[0][4] == 1


def test_reconcile_idempotent_second_call_adds_nothing():
    """Re-running the helper on an already-reconciled table is a no-op."""
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(sa.text(LEGACY_DDL))

        first = module._reconcile_brief_item_columns(conn)
        second = module._reconcile_brief_item_columns(conn)

        assert first == EXPECTED_COLUMNS
        assert second == []
        assert _column_names(conn) == set(CORE_COLUMNS + EXPECTED_COLUMNS)


def test_reconcile_preserves_existing_data():
    """Reconciliation is additive: pre-existing legacy rows are untouched."""
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        item_id = uuid.uuid4().hex
        conn.execute(
            sa.text(
                "INSERT INTO brief_items "
                "(id, project_id, item_type, category, status, prompt, answer, "
                " created_by, created_at, updated_at) "
                "VALUES (:id, :project_id, 'question', 'general', 'pending', "
                "        'Legacy prompt', 'Legacy answer text', :created_by, "
                "        :created_at, :updated_at)"
            ),
            {
                "id": item_id,
                "project_id": uuid.uuid4().hex,
                "created_by": uuid.uuid4().hex,
                "created_at": "2026-01-01 00:00:00",
                "updated_at": "2026-01-01 00:00:00",
            },
        )

        before = conn.execute(
            sa.text("SELECT answer FROM brief_items WHERE id = :id"),
            {"id": item_id},
        ).scalar_one()
        assert before == "Legacy answer text"

        module._reconcile_brief_item_columns(conn)

        after = conn.execute(
            sa.text("SELECT answer FROM brief_items WHERE id = :id"),
            {"id": item_id},
        ).scalar_one()
        assert after == "Legacy answer text"
