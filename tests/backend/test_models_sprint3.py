"""Tests for Sprint 3 data models: brief items and moodboard items."""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from backend.app.core.security import get_password_hash
from backend.app.models import (
    Brief,
    BriefCategory,
    BriefItem,
    BriefItemStatus,
    BriefItemType,
    BriefStatus,
    Project,
    User,
    UserRole,
)


async def _create_user(db_session, email: str) -> User:
    """Create an inline active CLIENT user to satisfy FK columns."""
    user = User(
        id=uuid.uuid4(),
        email=email,
        hashed_password=get_password_hash("sprint3pass123"),
        full_name="Sprint 3 User",
        role=UserRole.CLIENT,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _create_project(db_session, user: User) -> Project:
    """Create an inline project owned by `user`."""
    project = Project(
        id=uuid.uuid4(),
        title="Sprint 3 Project",
        client_id=user.id,
    )
    db_session.add(project)
    await db_session.commit()
    return project


@pytest.mark.asyncio
async def test_brief_question_and_reference_rows_persist(db_session):
    user = await _create_user(db_session, "sprint3-client@example.com")
    project = await _create_project(db_session, user)

    question = BriefItem(
        id=uuid.uuid4(),
        project_id=project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.BRANDING,
        prompt="¿Cuál es el objetivo principal de la marca?",
        answer="Posicionar el estudio en el segmento premium.",
        note="Validado en la reunión inicial.",
        created_by=user.id,
    )
    reference = BriefItem(
        id=uuid.uuid4(),
        project_id=project.id,
        item_type=BriefItemType.REFERENCE,
        category=BriefCategory.INTERIOR,
        note="Referencia de paleta cálida.",
        file_name="palette.png",
        content_type="image/png",
        size_bytes=2048,
        storage_key="brief/palette.png",
        created_by=user.id,
    )
    db_session.add_all([question, reference])
    await db_session.commit()
    await db_session.refresh(question)
    await db_session.refresh(reference)

    assert question.item_type == BriefItemType.QUESTION
    assert question.category == BriefCategory.BRANDING
    assert question.prompt == "¿Cuál es el objetivo principal de la marca?"
    assert question.answer == "Posicionar el estudio en el segmento premium."
    assert question.note == "Validado en la reunión inicial."
    assert question.storage_key is None
    assert question.project_id == project.id
    assert question.created_by == user.id

    assert reference.item_type == BriefItemType.REFERENCE
    assert reference.category == BriefCategory.INTERIOR
    assert reference.note == "Referencia de paleta cálida."
    assert reference.file_name == "palette.png"
    assert reference.content_type == "image/png"
    assert reference.size_bytes == 2048
    assert reference.storage_key == "brief/palette.png"
    assert reference.prompt is None


@pytest.mark.asyncio
async def test_brief_item_shape_check_rejects_question_without_prompt(db_session):
    user = await _create_user(db_session, "sprint3-shape@example.com")
    project = await _create_project(db_session, user)

    db_session.add(
        BriefItem(
            id=uuid.uuid4(),
            project_id=project.id,
            item_type=BriefItemType.QUESTION,
            category=BriefCategory.GENERAL,
            created_by=user.id,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_enum_values_are_lowercase(db_session):
    user = await _create_user(db_session, "sprint3-enums@example.com")
    project = await _create_project(db_session, user)

    db_session.add(
        BriefItem(
            id=uuid.uuid4(),
            project_id=project.id,
            item_type=BriefItemType.QUESTION,
            category=BriefCategory.GENERAL,
            prompt="¿Objetivo del proyecto?",
            created_by=user.id,
        )
    )
    await db_session.commit()

    item_type = await db_session.execute(sa.text("SELECT item_type FROM brief_items"))
    assert item_type.scalar_one() == "question"

    category = await db_session.execute(sa.text("SELECT category FROM brief_items"))
    assert category.scalar_one() == "general"


@pytest.mark.asyncio
async def test_brief_multimodal_model_fields_and_status(db_session):
    """Verify Brief/BriefItem supports multimodal responses and PENDING, IN_PROGRESS, COMPLETED statuses."""
    user = await _create_user(db_session, "sprint3-multimodal@example.com")
    project = await _create_project(db_session, user)

    # 1. Brief alias works identically to BriefItem
    assert Brief is BriefItem
    assert BriefItemStatus is BriefStatus
    assert BriefStatus("PENDING") == BriefStatus.PENDING
    assert BriefStatus("in_progress") == BriefStatus.IN_PROGRESS
    assert BriefStatus("completed") == BriefStatus.COMPLETED

    # 2. Text question with PENDING status
    q1 = Brief(
        id=uuid.uuid4(),
        project_id=project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.BRANDING,
        prompt="¿Cuáles son tus valores de marca?",
        status=BriefStatus.PENDING,
        created_by=user.id,
    )
    # 3. Image response with IN_PROGRESS status
    q2 = BriefItem(
        id=uuid.uuid4(),
        project_id=project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.INTERIOR,
        prompt="Sube una foto de tu espacio actual.",
        status=BriefStatus.IN_PROGRESS,
        response_type="image",
        image_url="/api/v1/projects/brief/items/1/media",
        image_storage_key=f"{project.id}/space.jpg",
        created_by=user.id,
    )
    # 4. Audio response with transcription and COMPLETED status
    q3 = BriefItem(
        id=uuid.uuid4(),
        project_id=project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="Cuéntanos en una nota de voz tu visión general.",
        status=BriefStatus.COMPLETED,
        response_type="audio",
        audio_url="/api/v1/projects/brief/items/2/media",
        audio_storage_key=f"{project.id}/voice.mp3",
        audio_transcription="Queremos un diseño moderno y acogedor con iluminación cálida.",
        transcription="Queremos un diseño moderno y acogedor con iluminación cálida.",
        created_by=user.id,
    )

    db_session.add_all([q1, q2, q3])
    await db_session.commit()
    await db_session.refresh(q1)
    await db_session.refresh(q2)
    await db_session.refresh(q3)

    assert q1.status == BriefStatus.PENDING
    assert q2.status == BriefStatus.IN_PROGRESS
    assert q2.image_url == "/api/v1/projects/brief/items/1/media"
    assert q2.image_storage_key == f"{project.id}/space.jpg"

    assert q3.status == BriefStatus.COMPLETED
    assert q3.audio_url == "/api/v1/projects/brief/items/2/media"
    assert q3.audio_storage_key == f"{project.id}/voice.mp3"
    assert "iluminación cálida" in q3.audio_transcription
    assert q3.transcription == q3.audio_transcription

