"""Tests for project review/survey meetings booked via Google Calendar."""

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_calendar_client
from backend.app.core.config import Settings
from backend.app.core.security import create_access_token
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    Meeting,
    MeetingStatus,
    MeetingType,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStage,
    StageStatus,
    User,
)
from backend.app.services.google_calendar import (
    CalendarAPIError,
    CalendarEvent,
    GoogleCalendarClient,
)
from backend.app.services.scheduling import studio_day_window


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _future_slot(settings: Settings) -> datetime:
    """Return a valid slot one week out, aligned to the 60-minute grid."""
    day = datetime.now(timezone.utc).astimezone(
        ZoneInfo(settings.STUDIO_TIMEZONE)
    ).date() + timedelta(days=7)
    window_start, _ = studio_day_window(day, settings)
    return window_start + timedelta(hours=1)


class _RecordingClient:
    """Fake calendar client capturing payloads and always succeeding."""

    def __init__(self) -> None:
        self.summaries: list[str] = []
        self.attendees: list[str] = []
        self.deleted_event_ids: list[str] = []

    async def freebusy(self, start: datetime, end: datetime) -> list:
        return []

    async def create_meet_event(
        self,
        summary: str,
        start: datetime,
        end: datetime,
        attendee_email: str,
    ) -> CalendarEvent:
        self.summaries.append(summary)
        self.attendees.append(attendee_email)
        return CalendarEvent(
            event_id=f"evt-{len(self.summaries)}",
            meet_link="https://meet.google.com/project-meeting",
        )

    async def delete_event(self, event_id: str) -> None:
        self.deleted_event_ids.append(event_id)


class _FailAfterReservationClient:
    """Fake client failing create_meet_event after observing the reservation."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.meeting_counts_at_create: list[int] = []

    async def freebusy(self, start: datetime, end: datetime) -> list:
        return []

    async def create_meet_event(
        self,
        summary: str,
        start: datetime,
        end: datetime,
        attendee_email: str,
    ) -> CalendarEvent:
        count = await self.db.scalar(select(func.count(Meeting.id)))
        self.meeting_counts_at_create.append(count or 0)
        raise CalendarAPIError("simulated provider failure")


def _studio_today(settings: Settings) -> date:
    return datetime.now(timezone.utc).astimezone(
        ZoneInfo(settings.STUDIO_TIMEZONE)
    ).date()


@pytest.mark.asyncio
async def test_book_review_meeting_happy(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_user: User,
    client_token: str,
    db_session: AsyncSession,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "review", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["project_id"] == str(active_project.id)
        assert data["meeting_type"] == "review"
        assert data["status"] == "confirmed"
        assert data["meet_link"] == "https://meet.google.com/project-meeting"
        assert data["google_event_id"] == "evt-1"

        meeting = await db_session.get(Meeting, uuid.UUID(data["id"]))
        assert meeting is not None
        assert meeting.project_id == active_project.id
        assert meeting.lead_id is None

        # The project's client (not the booker) is the Meet attendee.
        assert calendar.attendees == [client_user.email]
        assert calendar.summaries == [f"Revisión de etapa — {active_project.title}"]

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "meeting.create",
                AuditLog.entity_id == meeting.id,
            )
        )
        log = result.scalar_one()
        assert log.actor_user_id == client_user.id
        assert log.entity_type == "meeting"
        assert log.metadata_json["project_id"] == str(active_project.id)
        assert log.metadata_json["meeting_type"] == "review"
        assert log.metadata_json["google_event_id"] == "evt-1"
        assert "start_time" in log.metadata_json
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_survey_meeting_happy(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_token: str,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "survey", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 201
        assert response.json()["meeting_type"] == "survey"
        assert response.json()["status"] == "confirmed"
        assert calendar.summaries == [f"Levantamiento — {active_project.title}"]
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_with_stage_id(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    other_project: Project,
    client_token: str,
    db_session: AsyncSession,
):
    stage = ProjectStage(
        id=uuid.uuid4(),
        project_id=active_project.id,
        name="Concepto",
        order_index=0,
        status=StageStatus.ACTIVE,
    )
    foreign = ProjectStage(
        id=uuid.uuid4(),
        project_id=other_project.id,
        name="Etapa ajena",
        order_index=0,
        status=StageStatus.ACTIVE,
    )
    db_session.add_all([stage, foreign])
    await db_session.commit()

    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={
                "meeting_type": "review",
                "start_time": slot.isoformat(),
                "stage_id": str(stage.id),
            },
            headers=auth(client_token),
        )
        assert response.status_code == 201
        meeting_id = uuid.UUID(response.json()["id"])
        assert calendar.summaries == [
            f"Revisión de etapa — {active_project.title} · {stage.name}"
        ]

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "meeting.create",
                AuditLog.entity_id == meeting_id,
            )
        )
        log = result.scalar_one()
        assert log.metadata_json["stage_id"] == str(stage.id)

        # A stage belonging to another project is indistinguishable from 404.
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={
                "meeting_type": "review",
                "start_time": (
                    slot + timedelta(minutes=60)
                ).isoformat(),
                "stage_id": str(foreign.id),
            },
            headers=auth(client_token),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Stage not found"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_availability_slots_60min_future_only(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_token: str,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        future_day = _studio_today(calendar_settings) + timedelta(days=7)
        response = client.get(
            f"/api/v1/projects/{active_project.id}/meetings/availability",
            params={"date": future_day.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["date"] == future_day.isoformat()

        tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)
        now_local = datetime.now(timezone.utc).astimezone(tz)
        slots = [
            (
                datetime.fromisoformat(s["start_time"]).astimezone(tz),
                datetime.fromisoformat(s["end_time"]).astimezone(tz),
            )
            for s in data["slots"]
        ]
        assert slots, "expected at least one slot"
        for start, end in slots:
            assert (end - start) == timedelta(minutes=60)
            assert start > now_local
        window_start, window_end = studio_day_window(future_day, calendar_settings)
        assert slots[0][0] == window_start
        assert slots[-1][1] == window_end
        assert len(slots) == 9  # 09:00–18:00 hourly

        past_day = _studio_today(calendar_settings) - timedelta(days=1)
        response = client.get(
            f"/api/v1/projects/{active_project.id}/meetings/availability",
            params={"date": past_day.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "Cannot check availability for a past date"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_overlap_conflict(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_token: str,
    db_session: AsyncSession,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        first = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "review", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert first.status_code == 201

        second = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "survey", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert second.status_code == 409
        assert second.json()["detail"] == "Slot no longer available"

        count = await db_session.scalar(select(func.count(Meeting.id)))
        assert count == 1
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_validation_errors(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_token: str,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        base = f"/api/v1/projects/{active_project.id}/meetings"
        tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)

        past = datetime.combine(
            _studio_today(calendar_settings) - timedelta(days=1),
            datetime.min.time(),
        ).replace(hour=10, minute=0, tzinfo=tz)
        response = client.post(
            base,
            json={"meeting_type": "review", "start_time": past.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "start_time is in the past"

        day = _studio_today(calendar_settings) + timedelta(days=7)
        window_start, _ = studio_day_window(day, calendar_settings)

        outside = window_start - timedelta(hours=2)  # 07:00
        response = client.post(
            base,
            json={"meeting_type": "review", "start_time": outside.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "start_time is outside business hours"

        misaligned = window_start + timedelta(hours=1, minutes=15)  # 10:15
        response = client.post(
            base,
            json={"meeting_type": "review", "start_time": misaligned.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "start_time is not aligned to slot grid"

        response = client.post(
            base,
            json={"meeting_type": "discovery", "start_time": misaligned.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert "meeting_type must be review or survey" in str(response.json()["detail"])

        naive = (window_start + timedelta(hours=1)).replace(tzinfo=None)
        response = client.post(
            base,
            json={"meeting_type": "review", "start_time": naive.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 422
        assert "start_time must be timezone-aware" in str(response.json()["detail"])

        assert calendar.summaries == []
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_rbac(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    other_client_token: str,
    client_token: str,
    collaborator_user: User,
    collaborator_token: str,
    inactive_user: User,
    db_session: AsyncSession,
):
    # A separate DRAFT project the collaborator can access (the shared
    # active_project fixture has already activated test_project).
    draft_project = Project(
        id=uuid.uuid4(),
        title="Borrador",
        client_id=None,
    )
    db_session.add(draft_project)
    db_session.add(
        ProjectMember(
            id=uuid.uuid4(),
            project_id=draft_project.id,
            user_id=collaborator_user.id,
            assigned_role=ProjectRole.COLLABORATOR,
        )
    )
    await db_session.commit()

    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    inactive_token = create_access_token({"sub": str(inactive_user.id)})
    try:
        base = f"/api/v1/projects/{active_project.id}/meetings"
        slot = _future_slot(calendar_settings)
        payload = {"meeting_type": "review", "start_time": slot.isoformat()}

        assert client.post(base, json=payload).status_code == 401
        response = client.post(base, json=payload, headers=auth(other_client_token))
        assert response.status_code == 403
        assert response.json()["detail"] == "No access to this project"

        response = client.post(base, json=payload, headers=auth(inactive_token))
        assert response.status_code == 403
        assert response.json()["detail"] == "Inactive user"

        response = client.get(
            f"{base}/availability",
            params={"date": (_studio_today(calendar_settings) + timedelta(days=7)).isoformat()},
            headers=auth(other_client_token),
        )
        assert response.status_code == 403

        # A DRAFT project refuses booking with 409.
        draft_payload = dict(
            payload, start_time=(slot + timedelta(days=1)).isoformat()
        )
        response = client.post(
            f"/api/v1/projects/{draft_project.id}/meetings",
            json=draft_payload,
            headers=auth(collaborator_token),
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Project is not active"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_calendar_not_connected_503(
    client: TestClient,
    active_project: Project,
    client_token: str,
):
    disconnected = GoogleCalendarClient(
        Settings(GOOGLE_REFRESH_TOKEN=""),
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
    )
    app.dependency_overrides[get_calendar_client] = lambda: disconnected
    try:
        slot = _future_slot(Settings(GOOGLE_REFRESH_TOKEN=""))
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "review", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 503
        assert response.json()["detail"] == "Calendar integration not connected"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_google_failure_compensates_reservation(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    client_token: str,
    db_session: AsyncSession,
):
    calendar = _FailAfterReservationClient(db_session)
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "review", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 502
        assert response.json()["detail"] == "Calendar provider unavailable"

        assert calendar.meeting_counts_at_create == [1]
        remaining = await db_session.scalar(select(func.count(Meeting.id)))
        assert remaining == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_list_meetings_scoped(
    client: TestClient,
    calendar_settings: Settings,
    active_project: Project,
    other_project: Project,
    client_token: str,
    db_session: AsyncSession,
):
    calendar = _RecordingClient()
    app.dependency_overrides[get_calendar_client] = lambda: calendar
    try:
        slot = _future_slot(calendar_settings)
        response = client.post(
            f"/api/v1/projects/{active_project.id}/meetings",
            json={"meeting_type": "review", "start_time": slot.isoformat()},
            headers=auth(client_token),
        )
        assert response.status_code == 201
        booked_id = response.json()["id"]

        slot_utc = slot.astimezone(timezone.utc)
        foreign = Meeting(
            id=uuid.uuid4(),
            project_id=other_project.id,
            lead_id=None,
            start_time=slot_utc + timedelta(days=1),
            end_time=slot_utc + timedelta(days=1, minutes=60),
            meeting_type=MeetingType.SURVEY,
            status=MeetingStatus.CONFIRMED,
        )
        db_session.add(foreign)
        await db_session.commit()

        response = client.get(
            f"/api/v1/projects/{active_project.id}/meetings",
            headers=auth(client_token),
        )
        assert response.status_code == 200
        meetings = response.json()
        assert [m["id"] for m in meetings] == [booked_id]
        assert all(m["project_id"] == str(active_project.id) for m in meetings)
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)
