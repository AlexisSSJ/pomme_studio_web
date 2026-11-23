"""Idempotent repair of legacy brief rows.

The pure-SQL statements are portable across PostgreSQL and SQLite so they can
run both in the 0009 Alembic migration and in the CLI repair script. The two
Python helpers handle the work that cannot be expressed portably in plain SQL
(generating UUIDs and formatting per-image URLs), mirroring migration 0007.

Importing this module has no side effects: nothing connects to a database here.

Enum-tolerance caveat (documentation only): the ``_missing_`` hooks defined in
``app.models.brief_item`` protect Pydantic validation and incoming payloads, but
they are not consulted by SQLAlchemy's ``SAEnum`` on ORM reads (it uses its own
``_object_lookup`` and rejects raw uppercase values). The raw values that would
break those reads are repaired in the database by migration 0009 on every
deploy, which is exactly why all statements and helpers here are idempotent.
"""

import uuid
from typing import Any

import sqlalchemy as sa

# Placeholder for questions that lost their prompt in legacy data. Keeps the
# ck_brief_item_shape constraint satisfied without discarding their answers.
LEGACY_PROMPT_PLACEHOLDER = "[Pregunta pendiente de configurar]"

_VALID_ITEM_TYPES = ("question", "reference")
_VALID_CATEGORIES = ("branding", "interior", "general")
_VALID_STATUSES = ("pending", "in_progress", "completed")


def _in_clause(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


# Step 1: lowercase enum values that become valid when lowercased.
_LOWER_ITEM_TYPE = (
    "UPDATE brief_items SET item_type = lower(item_type) "
    f"WHERE lower(item_type) IN ({_in_clause(_VALID_ITEM_TYPES)}) "
    f"AND item_type NOT IN ({_in_clause(_VALID_ITEM_TYPES)})"
)
_LOWER_CATEGORY = (
    "UPDATE brief_items SET category = lower(category) "
    f"WHERE lower(category) IN ({_in_clause(_VALID_CATEGORIES)}) "
    f"AND category NOT IN ({_in_clause(_VALID_CATEGORIES)})"
)
_LOWER_STATUS = (
    "UPDATE brief_items SET status = lower(status) "
    f"WHERE lower(status) IN ({_in_clause(_VALID_STATUSES)}) "
    f"AND status NOT IN ({_in_clause(_VALID_STATUSES)})"
)

# Step 2: derive a status from the answer/media actually present.
_DERIVE_STATUS = (
    "UPDATE brief_items SET status = CASE WHEN "
    "(answer IS NOT NULL AND answer <> '') "
    "OR image_storage_key IS NOT NULL "
    "OR audio_storage_key IS NOT NULL "
    "OR COALESCE(transcription, audio_transcription, '') <> '' "
    "THEN 'completed' ELSE 'pending' END "
    f"WHERE status IS NULL OR lower(status) NOT IN ({_in_clause(_VALID_STATUSES)})"
)

# Step 3: fallbacks for out-of-catalog category / item_type.
_FALLBACK_CATEGORY = (
    "UPDATE brief_items SET category = 'general' "
    f"WHERE category IS NULL OR lower(category) NOT IN ({_in_clause(_VALID_CATEGORIES)})"
)
_FALLBACK_ITEM_TYPE = (
    "UPDATE brief_items SET item_type = CASE "
    "WHEN prompt IS NOT NULL AND trim(prompt) <> '' THEN 'question' "
    "WHEN storage_key IS NOT NULL THEN 'reference' "
    "ELSE 'question' END "
    f"WHERE item_type IS NULL OR lower(item_type) NOT IN ({_in_clause(_VALID_ITEM_TYPES)})"
)

# Step 4: a question without a prompt would violate ck_brief_item_shape.
_REPAIR_PROMPT = (
    f"UPDATE brief_items SET prompt = '{LEGACY_PROMPT_PLACEHOLDER}' "
    "WHERE item_type = 'question' AND (prompt IS NULL OR trim(prompt) = '')"
)

# Step 5: derive response_type from the media actually present.
_DERIVE_RESPONSE_TYPE = (
    "UPDATE brief_items SET response_type = CASE "
    "WHEN audio_storage_key IS NOT NULL THEN 'audio' "
    "WHEN image_storage_key IS NOT NULL THEN 'image' "
    "WHEN answer IS NOT NULL AND answer <> '' THEN 'text' "
    "ELSE NULL END "
    "WHERE response_type IS NULL OR response_type = ''"
)

# Step 6: keep both transcription columns in sync.
_SYNC_TRANSCRIPTION_FORWARD = (
    "UPDATE brief_items SET transcription = audio_transcription "
    "WHERE transcription IS NULL AND audio_transcription IS NOT NULL"
)
_SYNC_TRANSCRIPTION_BACKWARD = (
    "UPDATE brief_items SET audio_transcription = transcription "
    "WHERE audio_transcription IS NULL AND transcription IS NOT NULL"
)

NORMALIZATION_STATEMENTS: list[str] = [
    _LOWER_ITEM_TYPE,
    _LOWER_CATEGORY,
    _LOWER_STATUS,
    _DERIVE_STATUS,
    _FALLBACK_CATEGORY,
    _FALLBACK_ITEM_TYPE,
    _REPAIR_PROMPT,
    _DERIVE_RESPONSE_TYPE,
    _SYNC_TRANSCRIPTION_FORWARD,
    _SYNC_TRANSCRIPTION_BACKWARD,
]

# Typed Core tables keep UUID binding portable across PostgreSQL and SQLite,
# exactly like migration 0007.
_brief_items = sa.table(
    "brief_items",
    sa.column("id", sa.Uuid(as_uuid=True)),
    sa.column("project_id", sa.Uuid(as_uuid=True)),
    sa.column("item_type", sa.String()),
    sa.column("prompt", sa.String()),
    sa.column("storage_key", sa.String()),
    sa.column("image_url", sa.String()),
    sa.column("image_storage_key", sa.String()),
    sa.column("content_type", sa.String()),
    sa.column("size_bytes", sa.Integer()),
    sa.column("created_at", sa.DateTime(timezone=True)),
)
_brief_item_images = sa.table(
    "brief_item_images",
    sa.column("id", sa.Uuid(as_uuid=True)),
    sa.column("item_id", sa.Uuid(as_uuid=True)),
    sa.column("storage_key", sa.String()),
    sa.column("content_type", sa.String()),
    sa.column("size_bytes", sa.Integer()),
    sa.column("position", sa.Integer()),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def _as_uuid(value: Any) -> uuid.UUID:
    """Normalize a UUID coming back from either dialect to a dashed UUID."""
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def copy_legacy_images(connection) -> int:
    """Reinforce 0007: copy legacy image keys into brief_item_images at position 1.

    Returns the number of child rows inserted. The NOT EXISTS guard makes the
    helper idempotent; UUIDs are generated in Python for portability.
    """
    rows = connection.execute(
        sa.select(
            _brief_items.c.id,
            _brief_items.c.image_storage_key,
            _brief_items.c.content_type,
            _brief_items.c.size_bytes,
            _brief_items.c.created_at,
        ).where(
            _brief_items.c.image_storage_key.is_not(None),
            _brief_items.c.item_type == "question",
            ~sa.exists().where(
                _brief_item_images.c.item_id == _brief_items.c.id
            ),
        )
    ).fetchall()

    for row in rows:
        connection.execute(
            _brief_item_images.insert().values(
                id=uuid.uuid4(),
                item_id=row.id,
                storage_key=row.image_storage_key,
                content_type=row.content_type,
                size_bytes=row.size_bytes,
                position=1,
                created_at=row.created_at,
            )
        )
    return len(rows)


def rewrite_legacy_image_urls(connection) -> int:
    """Point question image_url at the per-image media endpoint of child row 1.

    Legacy dual-media rows kept an image_url ending in '/media', which now
    serves audio first. Returns the number of URLs changed.
    """
    rows = connection.execute(
        sa.select(
            _brief_items.c.id,
            _brief_items.c.project_id,
            _brief_items.c.image_url,
            _brief_item_images.c.id.label("image_id"),
        )
        .join(
            _brief_item_images,
            _brief_item_images.c.item_id == _brief_items.c.id,
        )
        .where(
            _brief_items.c.item_type == "question",
            _brief_item_images.c.position == 1,
        )
    ).fetchall()

    rewritten = 0
    for row in rows:
        expected = (
            f"/api/v1/projects/{_as_uuid(row.project_id)}/brief/items/"
            f"{_as_uuid(row.id)}/images/{_as_uuid(row.image_id)}/media"
        )
        if row.image_url == expected:
            continue
        connection.execute(
            _brief_items.update()
            .where(_brief_items.c.id == row.id)
            .values(image_url=expected)
        )
        rewritten += 1
    return rewritten
