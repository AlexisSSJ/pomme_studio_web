"""Tests for Sprint 3 data models: brief items, moodboard items and reactions."""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from backend.app.core.security import get_password_hash
from backend.app.models import (
    BriefCategory,
    BriefItem,
    BriefItemType,
    MoodboardItem,
    MoodboardReaction,
    Project,
    ReactionType,
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


async def _create_moodboard_item(db_session, project: Project, user: User) -> MoodboardItem:
    """Create an inline moodboard item uploaded by `user`."""
    item = MoodboardItem(
        id=uuid.uuid4(),
        project_id=project.id,
        title="Paleta cálida",
        description="Referencia de tonos tierra",
        file_name="palette.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
        storage_key="moodboard/palette.jpg",
        created_by=user.id,
    )
    db_session.add(item)
    await db_session.commit()
    return item


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
async def test_moodboard_reaction_unique_per_user(db_session):
    user = await _create_user(db_session, "sprint3-reactor@example.com")
    project = await _create_project(db_session, user)
    item = await _create_moodboard_item(db_session, project, user)

    db_session.add(
        MoodboardReaction(
            id=uuid.uuid4(),
            moodboard_item_id=item.id,
            user_id=user.id,
            reaction=ReactionType.LIKE,
        )
    )
    await db_session.commit()

    db_session.add(
        MoodboardReaction(
            id=uuid.uuid4(),
            moodboard_item_id=item.id,
            user_id=user.id,
            reaction=ReactionType.LIKE,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_comment_reaction_requires_text(db_session):
    user = await _create_user(db_session, "sprint3-commenter@example.com")
    project = await _create_project(db_session, user)
    item = await _create_moodboard_item(db_session, project, user)

    # Plain locals: after rollback() the ORM instances are expired and must
    # not be touched again from the async session.
    item_id = item.id
    user_id = user.id

    db_session.add(
        MoodboardReaction(
            id=uuid.uuid4(),
            moodboard_item_id=item_id,
            user_id=user_id,
            reaction=ReactionType.COMMENT,
            comment=None,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    db_session.add(
        MoodboardReaction(
            id=uuid.uuid4(),
            moodboard_item_id=item_id,
            user_id=user_id,
            reaction=ReactionType.COMMENT,
            comment="  ",
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
    item = await _create_moodboard_item(db_session, project, user)
    db_session.add(
        MoodboardReaction(
            id=uuid.uuid4(),
            moodboard_item_id=item.id,
            user_id=user.id,
            reaction=ReactionType.LIKE,
        )
    )
    await db_session.commit()

    item_type = await db_session.execute(sa.text("SELECT item_type FROM brief_items"))
    assert item_type.scalar_one() == "question"

    category = await db_session.execute(sa.text("SELECT category FROM brief_items"))
    assert category.scalar_one() == "general"

    reaction = await db_session.execute(sa.text("SELECT reaction FROM moodboard_reactions"))
    assert reaction.scalar_one() == "like"
