"""Tests for Sprint 2 data models: leads, meetings, and project extensions."""

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.db.base import Base
from backend.app.models import (
    BudgetRange,
    Lead,
    LeadStatus,
    Meeting,
    MeetingStatus,
    MeetingType,
    Project,
    ProjectStatus,
    ServiceType,
    SpaceType,
)


def test_metadata_contains_sprint2_tables():
    tables = Base.metadata.tables
    assert "leads" in tables
    assert "meetings" in tables


def test_lead_columns():
    columns = {col.name for col in Lead.__table__.columns}
    assert columns == {
        "id",
        "contact_name",
        "email",
        "service_type",
        "space_type",
        "area_m2",
        "budget_range",
        "status",
        "created_at",
        "updated_at",
    }


def test_project_sprint2_columns():
    columns = {col.name for col in Project.__table__.columns}
    assert "title" in columns
    assert "lead_id" in columns
    assert "scope_type" in columns
    assert "status" in columns
    assert "included_rounds" in columns
    assert "remaining_rounds" in columns
    assert "balance_paid" in columns
    assert "name" not in columns


def test_meeting_check_constraints():
    constraint_names = {
        c.name for c in Meeting.__table__.constraints if c.name is not None
    }
    assert "ck_meeting_time_order" in constraint_names
    assert "ck_meeting_single_parent" in constraint_names


def test_meeting_indexes():
    indexed_cols = set()
    for idx in Meeting.__table__.indexes:
        indexed_cols.update(col.name for col in idx.columns)
    assert "lead_id" in indexed_cols
    assert "project_id" in indexed_cols
    assert "start_time" in indexed_cols


def test_enum_values():
    assert ServiceType.BRANDING.value == "branding"
    assert ServiceType.INTERIOR.value == "interior"
    assert ServiceType.INTEGRAL.value == "integral"

    assert SpaceType.RESIDENTIAL.value == "residential"
    assert SpaceType.COMMERCIAL.value == "commercial"
    assert SpaceType.HOSPITALITY.value == "hospitality"
    assert SpaceType.OFFICE.value == "office"

    assert BudgetRange.UNDER_10K.value == "under_10k"
    assert BudgetRange.FROM_10K_TO_25K.value == "10k_25k"
    assert BudgetRange.FROM_25K_TO_50K.value == "25k_50k"
    assert BudgetRange.FROM_50K_TO_100K.value == "50k_100k"
    assert BudgetRange.OVER_100K.value == "over_100k"

    assert LeadStatus.NEW.value == "new"
    assert LeadStatus.CONTACTED.value == "contacted"
    assert LeadStatus.QUALIFIED.value == "qualified"
    assert LeadStatus.PROPOSAL_SENT.value == "proposal_sent"
    assert LeadStatus.CONVERTED.value == "converted"
    assert LeadStatus.DISCARDED.value == "discarded"

    assert ProjectStatus.DRAFT.value == "draft"
    assert ProjectStatus.ACTIVE.value == "active"
    assert ProjectStatus.ON_HOLD.value == "on_hold"
    assert ProjectStatus.COMPLETED.value == "completed"
    assert ProjectStatus.CANCELLED.value == "cancelled"

    assert MeetingType.DISCOVERY.value == "discovery"
    assert MeetingType.PROPOSAL.value == "proposal"
    assert MeetingType.REVIEW.value == "review"
    assert MeetingType.FOLLOW_UP.value == "follow_up"

    assert MeetingStatus.SCHEDULED.value == "scheduled"
    assert MeetingStatus.CONFIRMED.value == "confirmed"
    assert MeetingStatus.CANCELLED.value == "cancelled"
    assert MeetingStatus.COMPLETED.value == "completed"
    assert MeetingStatus.NO_SHOW.value == "no_show"


@pytest.mark.asyncio
async def test_lead_meeting_roundtrip(db_session):
    lead = Lead(
        contact_name="Ada Lovelace",
        email="ada@example.com",
        service_type=ServiceType.INTEGRAL,
    )
    db_session.add(lead)
    await db_session.commit()
    await db_session.refresh(lead)

    assert lead.status == LeadStatus.NEW

    start = datetime.now(timezone.utc) + timedelta(days=1)
    end = start + timedelta(hours=1)
    meeting = Meeting(
        lead_id=lead.id,
        start_time=start,
        end_time=end,
        meeting_type=MeetingType.DISCOVERY,
    )
    db_session.add(meeting)
    await db_session.commit()
    await db_session.refresh(meeting)

    assert meeting.status == MeetingStatus.SCHEDULED
    assert meeting.lead_id == lead.id
