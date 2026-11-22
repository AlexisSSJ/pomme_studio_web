"""Tests for Sprint 5 data models: deliverable visibility flags and FF&E specifications."""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from backend.app.models import (
    Deliverable,
    ProjectSpecification,
    ProjectStage,
    SpecificationCategory,
)


@pytest.mark.asyncio
async def test_deliverable_visibility_defaults(db_session, active_project, collaborator_user):
    project_id = active_project.id
    uploader_id = collaborator_user.id

    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=project_id,
        name="Concepto",
        order_index=0,
    )
    db_session.add(stage)
    await db_session.commit()
    stage_id = stage.id

    deliverable = Deliverable(
        id=uuid.uuid4(),
        project_id=project_id,
        stage_id=stage_id,
        title="Propuesta de marca v1",
        version=1,
        file_name="propuesta.pdf",
        content_type="application/pdf",
        size_bytes=2048,
        storage_key="deliverables/propuesta-v1.pdf",
        created_by=uploader_id,
    )
    db_session.add(deliverable)
    await db_session.commit()
    await db_session.refresh(deliverable)

    assert deliverable.is_client_visible is False
    assert deliverable.is_final_handover is False
    assert deliverable.published_at is None
    assert deliverable.published_by is None


@pytest.mark.asyncio
async def test_specification_defaults_and_category(db_session, active_project, collaborator_user):
    spec = ProjectSpecification(
        id=uuid.uuid4(),
        project_id=active_project.id,
        category=SpecificationCategory.FURNITURE,
        name="Silla",
        created_by=collaborator_user.id,
    )
    db_session.add(spec)
    await db_session.commit()
    await db_session.refresh(spec)

    assert spec.category == SpecificationCategory.FURNITURE
    assert spec.created_at is not None
    assert spec.updated_at is not None

    raw_category = await db_session.execute(
        sa.text("SELECT category FROM project_specifications")
    )
    assert raw_category.scalar_one() == "furniture"


@pytest.mark.asyncio
async def test_specification_name_not_blank(db_session, active_project, collaborator_user):
    spec = ProjectSpecification(
        id=uuid.uuid4(),
        project_id=active_project.id,
        category=SpecificationCategory.LIGHTING,
        name="   ",
        created_by=collaborator_user.id,
    )
    db_session.add(spec)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


def test_specification_has_no_commerce_columns():
    columns = ProjectSpecification.__table__.columns
    assert "quantity" not in columns
    assert "price" not in columns
    assert "stock" not in columns
    assert "purchase" not in columns
