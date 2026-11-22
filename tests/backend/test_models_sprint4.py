"""Tests for Sprint 4 data models: project stages, deliverables and pin comments."""

import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from backend.app.models import (
    Deliverable,
    DeliverableComment,
    DeliverableStatus,
    MeetingType,
    ProjectStage,
    StageStatus,
)


@pytest.mark.asyncio
async def test_stage_defaults(db_session, active_project):
    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=active_project.id,
        name="Concepto",
        order_index=0,
    )
    db_session.add(stage)
    await db_session.commit()
    await db_session.refresh(stage)

    assert stage.status == StageStatus.LOCKED
    assert stage.approved_by is None
    assert stage.approved_at is None

    raw_status = await db_session.execute(sa.text("SELECT status FROM project_stages"))
    assert raw_status.scalar_one() == "locked"


@pytest.mark.asyncio
async def test_stage_order_unique_per_project(db_session, active_project, other_project):
    # Plain locals: after rollback() the ORM instances are expired and must
    # not be touched again from the async session.
    project_id = active_project.id
    other_project_id = other_project.id

    db_session.add(
        ProjectStage(
            id=uuid.uuid4(),
            project_id=project_id,
            name="Concepto",
            order_index=0,
        )
    )
    await db_session.commit()

    db_session.add(
        ProjectStage(
            id=uuid.uuid4(),
            project_id=project_id,
            name="Diseño",
            order_index=0,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    # The same order_index is fine in a different project.
    db_session.add(
        ProjectStage(
            id=uuid.uuid4(),
            project_id=other_project_id,
            name="Concepto",
            order_index=0,
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_stage_approval_shape_constraint(db_session, active_project, client_user):
    project_id = active_project.id
    approver_id = client_user.id

    db_session.add(
        ProjectStage(
            id=uuid.uuid4(),
            project_id=project_id,
            name="Concepto",
            order_index=0,
            status=StageStatus.APPROVED,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    approved = ProjectStage(
        id=uuid.uuid4(),
        project_id=project_id,
        name="Diseño",
        order_index=1,
        status=StageStatus.APPROVED,
        approved_by=approver_id,
        approved_at=datetime.now(timezone.utc),
    )
    db_session.add(approved)
    await db_session.commit()
    await db_session.refresh(approved)

    assert approved.status == StageStatus.APPROVED
    assert approved.approved_by == approver_id
    assert approved.approved_at is not None


@pytest.mark.asyncio
async def test_deliverable_defaults_and_version_unique(db_session, active_project, client_user):
    project_id = active_project.id
    uploader_id = client_user.id

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

    assert deliverable.status == DeliverableStatus.IN_REVIEW

    db_session.add(
        Deliverable(
            id=uuid.uuid4(),
            project_id=project_id,
            stage_id=stage_id,
            title="Propuesta de marca v1 revisada",
            version=1,
            file_name="propuesta-revisada.pdf",
            content_type="application/pdf",
            size_bytes=4096,
            storage_key="deliverables/propuesta-v1-revisada.pdf",
            created_by=uploader_id,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_comment_defaults_and_pct_constraints(db_session, active_project, client_user):
    project_id = active_project.id
    commenter_id = client_user.id

    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=project_id,
        name="Concepto",
        order_index=0,
    )
    db_session.add(stage)
    await db_session.commit()

    deliverable = Deliverable(
        id=uuid.uuid4(),
        project_id=project_id,
        stage_id=stage.id,
        title="Render sala",
        version=1,
        file_name="render-sala.png",
        content_type="image/png",
        size_bytes=8192,
        storage_key="deliverables/render-sala.png",
        created_by=commenter_id,
    )
    db_session.add(deliverable)
    await db_session.commit()
    deliverable_id = deliverable.id

    comment = DeliverableComment(
        id=uuid.uuid4(),
        deliverable_id=deliverable_id,
        created_by=commenter_id,
        x_pct=10.5,
        y_pct=90.0,
        body="Ajustar muro",
    )
    db_session.add(comment)
    await db_session.commit()
    await db_session.refresh(comment)

    assert comment.page_or_frame == 1
    assert comment.round_number == 1
    assert comment.consumes_round is False

    for bad_kwargs in (
        {"x_pct": 101.0},
        {"y_pct": -1.0},
        {"page_or_frame": 0},
        {"body": "   "},
    ):
        db_session.add(
            DeliverableComment(
                **{
                    "id": uuid.uuid4(),
                    "deliverable_id": deliverable_id,
                    "created_by": commenter_id,
                    "x_pct": 50.0,
                    "y_pct": 50.0,
                    "body": "Revisión",
                    **bad_kwargs,
                }
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.commit()
        await db_session.rollback()


def test_meeting_type_survey_exists():
    assert MeetingType("survey") is MeetingType.SURVEY
