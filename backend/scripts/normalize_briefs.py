"""Idempotent production repair for legacy brief rows.

Reports anomalies before and after running the same portable statements and
Python helpers as the 0009 migration, in a single transaction. Safe to re-run.

    railway run python scripts/normalize_briefs.py

Run it from the backend/ directory (where alembic.ini lives).
"""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.core.config import settings
from app.services.brief_normalization import (
    NORMALIZATION_STATEMENTS,
    copy_legacy_images,
    rewrite_legacy_image_urls,
)

_ANOMALY_QUERIES: dict[str, str] = {
    "invalid_status": (
        "SELECT COUNT(*) FROM brief_items WHERE status IS NULL "
        "OR status NOT IN ('pending', 'in_progress', 'completed')"
    ),
    "missing_prompt": (
        "SELECT COUNT(*) FROM brief_items WHERE lower(item_type) = 'question' "
        "AND (prompt IS NULL OR trim(prompt) = '')"
    ),
    "missing_response_type_with_media": (
        "SELECT COUNT(*) FROM brief_items "
        "WHERE (response_type IS NULL OR response_type = '') "
        "AND (audio_storage_key IS NOT NULL OR image_storage_key IS NOT NULL "
        "OR (answer IS NOT NULL AND answer <> ''))"
    ),
    "unsynced_transcriptions": (
        "SELECT COUNT(*) FROM brief_items "
        "WHERE (transcription IS NULL) <> (audio_transcription IS NULL)"
    ),
    "legacy_images_without_child": (
        "SELECT COUNT(*) FROM brief_items WHERE image_storage_key IS NOT NULL "
        "AND lower(item_type) = 'question' AND NOT EXISTS "
        "(SELECT 1 FROM brief_item_images bi WHERE bi.item_id = brief_items.id)"
    ),
}


async def _counts(connection: AsyncConnection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name, query in _ANOMALY_QUERIES.items():
        result = await connection.execute(text(query))
        counts[name] = result.scalar_one()
    return counts


def _print_counts(label: str, counts: dict[str, int]) -> None:
    detail = " ".join(f"{name}={value}" for name, value in counts.items())
    print(f"normalize_briefs: {label} {detail}")


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.begin() as connection:
            before = await _counts(connection)
            _print_counts("BEFORE", before)

            def repair(sync_connection):
                for statement in NORMALIZATION_STATEMENTS:
                    sync_connection.execute(text(statement))
                copied = copy_legacy_images(sync_connection)
                rewritten = rewrite_legacy_image_urls(sync_connection)
                return copied, rewritten

            copied, rewritten = await connection.run_sync(repair)
            print(
                f"normalize_briefs: REPAIRED images_copied={copied} "
                f"image_urls_rewritten={rewritten}"
            )

            _print_counts("AFTER", await _counts(connection))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
