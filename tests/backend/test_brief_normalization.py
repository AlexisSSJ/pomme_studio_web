"""Tests for idempotent normalization of legacy brief data.

SQLite cannot replay the full Alembic chain (0002 uses PostgreSQL-specific SQL),
so these tests insert legacy rows with raw SQL directly into the ORM tables and
execute the portable statements/helpers. The 0009 migration is verified
separately in offline mode (see the task report).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import BriefCategory, BriefItemType, BriefStatus, Project, User
from backend.app.services.brief_normalization import (
    NORMALIZATION_STATEMENTS,
    copy_legacy_images,
    rewrite_legacy_image_urls,
)

PLACEHOLDER_PROMPT = "[Pregunta pendiente de configurar]"


async def _insert_legacy_item(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    created_by: uuid.UUID,
    **fields,
) -> uuid.UUID:
    """Insert a brief item with raw SQL, bypassing the ORM and its CHECK constraint."""
    await db_session.execute(text("PRAGMA ignore_check_constraints = ON"))
    item_id = uuid.uuid4()
    values = {
        "id": item_id.hex,
        "project_id": project_id.hex,
        "created_by": created_by.hex,
        "item_type": "question",
        "category": "general",
        "status": "pending",
        "prompt": "Pregunta legacy",
        "created_at": "2026-01-01 00:00:00",
        "updated_at": "2026-01-01 00:00:00",
    }
    values.update(fields)
    for key in ("id", "project_id", "created_by"):
        if isinstance(values[key], uuid.UUID):
            values[key] = values[key].hex

    columns = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    await db_session.execute(
        text(f"INSERT INTO brief_items ({columns}) VALUES ({params})"), values
    )
    await db_session.commit()
    return item_id


async def _fetch_item(db_session: AsyncSession, item_id: uuid.UUID) -> dict:
    result = await db_session.execute(
        text("SELECT * FROM brief_items WHERE id = :id"), {"id": item_id.hex}
    )
    return dict(result.mappings().one())


async def _count_images(db_session: AsyncSession, item_id: uuid.UUID) -> int:
    result = await db_session.execute(
        text("SELECT COUNT(*) AS n FROM brief_item_images WHERE item_id = :id"),
        {"id": item_id.hex},
    )
    return result.scalar_one()


async def _normalize(db_session: AsyncSession) -> tuple[int, int]:
    """Run the same statements/helpers the 0009 migration and CLI script use."""
    for statement in NORMALIZATION_STATEMENTS:
        await db_session.execute(text(statement))
    copied, rewritten = await db_session.run_sync(
        lambda session: (
            copy_legacy_images(session.connection()),
            rewrite_legacy_image_urls(session.connection()),
        )
    )
    await db_session.commit()
    return copied, rewritten


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_uppercase_status_normalized(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    client_token: str,
):
    item_id = await _insert_legacy_item(
        db_session, active_project.id, client_user.id, status="COMPLETED"
    )

    await _normalize(db_session)

    assert (await _fetch_item(db_session, item_id))["status"] == "completed"
    response = client.get(
        f"/api/v1/projects/{active_project.id}/brief", headers=_auth(client_token)
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_null_prompt_repaired_preserving_answer(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        prompt=None,
        answer="mi respuesta",
    )

    await _normalize(db_session)

    row = await _fetch_item(db_session, item_id)
    assert row["prompt"] == PLACEHOLDER_PROMPT
    assert row["answer"] == "mi respuesta"


@pytest.mark.asyncio
async def test_null_response_type_derived(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        audio_storage_key="project/legacy/audio.mp3",
        response_type=None,
    )

    await _normalize(db_session)

    assert (await _fetch_item(db_session, item_id))["response_type"] == "audio"


@pytest.mark.asyncio
async def test_legacy_image_copied_to_images_table(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        image_storage_key="project/legacy/image.png",
        content_type="image/png",
    )

    copied, _ = await _normalize(db_session)

    assert copied == 1
    assert await _count_images(db_session, item_id) == 1
    result = await db_session.execute(
        text(
            "SELECT storage_key, position FROM brief_item_images "
            "WHERE item_id = :id ORDER BY position"
        ),
        {"id": item_id.hex},
    )
    row = dict(result.mappings().one())
    assert row["storage_key"] == "project/legacy/image.png"
    assert row["position"] == 1


@pytest.mark.asyncio
async def test_normalization_idempotent_twice(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        status="COMPLETED",
        category="INTERIOR",
        prompt=None,
        answer="respuesta",
        image_storage_key="project/legacy/image.png",
    )

    await _normalize(db_session)
    first = await _fetch_item(db_session, item_id)
    first_images = await _count_images(db_session, item_id)

    second_copied, second_rewritten = await _normalize(db_session)

    assert second_copied == 0
    assert second_rewritten == 0
    assert await _fetch_item(db_session, item_id) == first
    assert await _count_images(db_session, item_id) == first_images == 1


@pytest.mark.asyncio
async def test_legacy_row_listed_without_500(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    client_token: str,
):
    await _insert_legacy_item(
        db_session, active_project.id, client_user.id, category="INTERIOR"
    )

    # The tolerant enums accept legacy casing at the schema/value layer.
    assert BriefCategory("INTERIOR") is BriefCategory.INTERIOR
    assert BriefItemType("QUESTION") is BriefItemType.QUESTION
    assert BriefStatus("COMPLETED") is BriefStatus.COMPLETED

    await _normalize(db_session)

    after = client.get(
        f"/api/v1/projects/{active_project.id}/brief", headers=_auth(client_token)
    )
    assert after.status_code == 200
    assert after.json()[0]["category"] == "interior"


@pytest.mark.asyncio
async def test_pending_endpoint_tolerates_legacy_rows(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    client_token: str,
):
    await _insert_legacy_item(
        db_session, active_project.id, client_user.id, status="COMPLETED", category="BRANDING"
    )
    url = f"/api/v1/projects/{active_project.id}/brief/pending"

    await _normalize(db_session)

    response = client.get(url, headers=_auth(client_token))
    assert response.status_code == 200
    assert response.json()["total_questions"] == 1


@pytest.mark.asyncio
async def test_autosave_tolerates_repaired_legacy_row(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
    client_token: str,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        prompt=None,
        answer=None,
        status="UNKNOWN",
    )

    await _normalize(db_session)

    response = client.patch(
        f"/api/v1/projects/{active_project.id}/brief/autosave",
        json={"item_id": str(item_id), "answer": "respuesta"},
        headers=_auth(client_token),
    )
    assert response.status_code == 200
    assert response.json()["answered_questions"] == 1


@pytest.mark.asyncio
async def test_legacy_image_url_rewritten_to_per_image(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        image_storage_key="project/legacy/image.png",
        image_url="/api/v1/projects/legacy/brief/items/legacy/media",
    )

    await _normalize(db_session)

    result = await db_session.execute(
        text("SELECT id FROM brief_item_images WHERE item_id = :id"),
        {"id": item_id.hex},
    )
    image_id = str(uuid.UUID(result.scalar_one()))
    expected = (
        f"/api/v1/projects/{active_project.id}/brief/items/{item_id}/"
        f"images/{image_id}/media"
    )
    assert (await _fetch_item(db_session, item_id))["image_url"] == expected
    assert "-" in image_id  # dashed UUID, consistent with the API-generated URLs


@pytest.mark.asyncio
async def test_rewrite_idempotent(
    db_session: AsyncSession,
    active_project: Project,
    client_user: User,
):
    item_id = await _insert_legacy_item(
        db_session,
        active_project.id,
        client_user.id,
        image_storage_key="project/legacy/image.png",
        image_url="/legacy/media",
    )

    await _normalize(db_session)
    first_url = (await _fetch_item(db_session, item_id))["image_url"]

    rewritten = await db_session.run_sync(
        lambda session: rewrite_legacy_image_urls(session.connection())
    )
    await db_session.commit()

    assert rewritten == 0
    assert (await _fetch_item(db_session, item_id))["image_url"] == first_url
