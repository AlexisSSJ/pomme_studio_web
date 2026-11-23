"""TDD tests for migration 0007's idempotent brief_items column reconciliation.

Production applied the original 0004 migration *before* ``status`` and the
multimodal columns were appended to that file. Alembic never re-runs an
already-applied revision, so production's ``brief_items`` table is missing
``status`` plus the multimodal columns that the ORM model and the current 0004
file now declare. Read-only psql evidence showed 14 columns present (no status,
no multimodal columns), 0 rows: 0007's legacy-image copy failed with
"column brief_items.image_storage_key does not exist" and, after that was
patched, 0009 failed with "column status does not exist". Migration 0007 now
reconciles all missing columns idempotently before the copy loop.

These tests load the migration module directly (the ``op`` proxy is only
touched inside ``upgrade()``) and exercise the helper on a legacy-shaped
in-memory SQLite table, which is portable to PostgreSQL as well.
"""

import importlib.util
import pathlib
import uuid

import pytest
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

# Full set the helper must guarantee: `status` plus the 11 multimodal columns,
# in the exact order the helper returns them.
EXPECTED_COLUMNS = [
    "status",
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

# Core columns of the legacy/base table (no status, no multimodal columns).
CORE_COLUMNS = [
    "id",
    "project_id",
    "item_type",
    "category",
    "prompt",
    "answer",
    "storage_key",
    "created_by",
    "created_at",
    "updated_at",
]

# Legacy production shape: the core table as it existed before status and the
# multimodal columns were appended to 0004. Used as the maximal-drift fixture
# so every reconciled column is absent.
LEGACY_DDL = """
CREATE TABLE brief_items (
    id CHAR(32) PRIMARY KEY,
    project_id CHAR(32) NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    category VARCHAR(20) NOT NULL,
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


def test_reconcile_adds_status_and_missing_multimodal_columns():
    """A legacy table gets all 12 missing columns, core columns intact.

    ``status`` must be NOT NULL with DEFAULT 'pending': inserting a row without
    it must read back 'pending'. Also runs the real ``upgrade()`` (under a
    lightweight Alembic Operations context) after reconciliation to confirm the
    legacy-image copy still works end-to-end on the reconciled table.
    """
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        assert set(EXPECTED_COLUMNS).isdisjoint(_column_names(conn))

        added = module._reconcile_brief_item_columns(conn)

        assert added == EXPECTED_COLUMNS
        assert len(added) == 12
        assert "status" in added
        present = _column_names(conn)
        for name in EXPECTED_COLUMNS:
            assert name in present
        for name in CORE_COLUMNS:
            assert name in present

        # status was absent from the DDL; the inserted row omits it and must
        # read back the server default 'pending'.
        item_id = uuid.uuid4().hex
        conn.execute(
            sa.text(
                "INSERT INTO brief_items "
                "(id, project_id, item_type, category, created_by, "
                " created_at, updated_at, image_storage_key, content_type, size_bytes) "
                "VALUES (:id, :project_id, 'question', 'general', :created_by, "
                "        :created_at, :updated_at, :image_storage_key, "
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
            sa.text(
                "SELECT status, image_storage_key FROM brief_items WHERE id = :id"
            ),
            {"id": item_id},
        ).one()
        assert stored[0] == "pending"
        assert stored[1] == "brief/img.png"

        # The copy loop (inseparable from Alembic's `op`) is driven here via a
        # lightweight Operations context. Reconcile is a no-op on second call;
        # the legacy image must land in the child table as position 1.
        assert module._reconcile_brief_item_columns(conn) == []
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


def test_status_column_is_not_null():
    """The reconciled status column rejects explicit NULLs."""
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        module._reconcile_brief_item_columns(conn)

        status_column = next(
            column
            for column in sa.inspect(conn).get_columns("brief_items")
            if column["name"] == "status"
        )
        assert status_column["nullable"] is False
        assert status_column["default"] == "'pending'"

        # A SAVEPOINT keeps the failed insert from rolling back the DDL above.
        with conn.begin_nested():
            with pytest.raises(sa.exc.IntegrityError):
                conn.execute(
                    sa.text(
                        "INSERT INTO brief_items "
                        "(id, project_id, item_type, category, status, created_by, "
                        " created_at, updated_at) "
                        "VALUES (:id, :project_id, 'question', 'general', NULL, "
                        "        :created_by, :created_at, :updated_at)"
                    ),
                    {
                        "id": uuid.uuid4().hex,
                        "project_id": uuid.uuid4().hex,
                        "created_by": uuid.uuid4().hex,
                        "created_at": "2026-01-01 00:00:00",
                        "updated_at": "2026-01-01 00:00:00",
                    },
                )


def test_reconcile_partial_drift():
    """With only status + image_storage_key present, exactly 10 are added."""
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        conn.execute(
            sa.text(
                "ALTER TABLE brief_items "
                "ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending'"
            )
        )
        conn.execute(
            sa.text("ALTER TABLE brief_items ADD COLUMN image_storage_key VARCHAR(500)")
        )
        assert _column_names(conn) == set(CORE_COLUMNS) | {
            "status",
            "image_storage_key",
        }

        added = module._reconcile_brief_item_columns(conn)

        expected = [
            name
            for name in EXPECTED_COLUMNS
            if name not in {"status", "image_storage_key"}
        ]
        assert added == expected
        assert len(added) == 10
        assert _column_names(conn) == set(CORE_COLUMNS) | set(EXPECTED_COLUMNS)


def test_reconcile_idempotent_second_call_adds_nothing():
    """Re-running the helper on an already-reconciled table is a no-op."""
    module = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
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
    with engine.begin() as conn:
        conn.execute(sa.text(LEGACY_DDL))
        item_id = uuid.uuid4().hex
        conn.execute(
            sa.text(
                "INSERT INTO brief_items "
                "(id, project_id, item_type, category, prompt, answer, "
                " created_by, created_at, updated_at) "
                "VALUES (:id, :project_id, 'question', 'general', "
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
