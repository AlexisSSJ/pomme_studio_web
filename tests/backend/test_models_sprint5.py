"""Tests for Sprint 5 data models: deliverable visibility/handover flags and project specifications."""

import uuid
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from backend.app.models import (
    Deliverable,
    ProjectStage,
    ProjectSpecification,
    SpecificationCategory,
)


@pytest.mark.asyncio
async def test_deliverable_visibility_defaults(db_session, active_project, collaborator_user):
    project_id = active_project.id
    user_id = collaborator_user.id

    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=project_id,
        name="Ejecutiva",
        order_index=0,
    )
    db_session.add(stage)
    await db_session.commit()

    deliverable = Deliverable(
        id=uuid.uuid4(),
        project_id=project_id,
        stage_id=stage.id,
        title="Planos ejecutivos",
        version=1,
        file_name="planos.pdf",
        content_type="application/pdf",
        size_bytes=4096,
        storage_key="deliverables/planos.pdf",
        created_by=user_id,
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
    project_id = active_project.id
    user_id = collaborator_user.id

    spec = ProjectSpecification(
        id=uuid.uuid4(),
        project_id=project_id,
        category=SpecificationCategory.FURNITURE,
        name="Silla Eames",
        code="SE-01",
        manufacturer="Herman Miller",
        finish="Nogal",
        dimensions="60x60x80cm",
        supplier="Design Store",
        reference_url="https://example.com/silla",
        location="Comedor",
        notes="Silla icónica",
        created_by=user_id,
    )
    db_session.add(spec)
    await db_session.commit()
    await db_session.refresh(spec)

    assert spec.category == SpecificationCategory.FURNITURE
    assert spec.name == "Silla Eames"

    raw_category = await db_session.execute(
        sa.text("SELECT category FROM project_specifications")
    )
    assert raw_category.scalar_one() == "furniture"


@pytest.mark.asyncio
async def test_specification_name_not_blank(db_session, active_project, collaborator_user):
    project_id = active_project.id
    user_id = collaborator_user.id

    spec = ProjectSpecification(
        id=uuid.uuid4(),
        project_id=project_id,
        category=SpecificationCategory.LIGHTING,
        name="   ",
        created_by=user_id,
    )
    db_session.add(spec)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


def test_specification_has_no_commerce_columns():
    table_columns = ProjectSpecification.__table__.columns.keys()
    assert "quantity" not in table_columns
    assert "price" not in table_columns
    assert "stock" not in table_columns
    assert "cost" not in table_columns
    assert "purchased" not in table_columns
