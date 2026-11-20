"""Regression tests for Sprint 2 booking and availability hardening."""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_calendar_client
from backend.app.core.config import Settings
from backend.app.main import app
from backend.app.models import Lead, Meeting, MeetingStatus, MeetingType
from backend.app.services import scheduling as scheduling_module
from backend.app.services.google_calendar import (
    CalendarAPIError,
    CalendarEvent,
    GoogleCalendarClient,
)
from backend.app.services.scheduling import book_discovery, studio_day_window


def _future_slot(settings: Settings) -> datetime:
    day = datetime.now(timezone.utc).astimezone(
        ZoneInfo(settings.STUDIO_TIMEZONE)
    ).date() + timedelta(days=7)
    window_start, _ = studio_day_window(day, settings)
    return window_start + timedelta(hours=1)


class _FailAfterReservationClient:
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


class _SuccessfulClient:
    def __init__(self) -> None:
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
        return CalendarEvent(
            event_id="evt-commit-failure",
            meet_link="https://meet.google.com/commit-failure",
        )

    async def delete_event(self, event_id: str) -> None:
        self.deleted_event_ids.append(event_id)


@pytest.mark.asyncio
async def test_google_failure_observes_then_compensates_reservation(
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    """The remote call happens after one local reservation, which is removed on failure."""
    calendar = _FailAfterReservationClient(db_session)

    with pytest.raises(CalendarAPIError):
        await book_discovery(
            db_session,
            sample_lead,
            _future_slot(calendar_settings),
            calendar,
            calendar_settings,
        )

    assert calendar.meeting_counts_at_create == [1]
    remaining = await db_session.scalar(select(func.count(Meeting.id)))
    assert remaining == 0


@pytest.mark.asyncio
async def test_confirmation_commit_failure_compensates_remote_and_local(
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    """A failed confirmation commit deletes both the remote event and reservation."""
    calendar = _SuccessfulClient()
    original_commit = db_session.commit
    commit_calls = 0

    async def fail_confirmation_commit():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == 2:
            raise RuntimeError("simulated confirmation commit failure")
        await original_commit()

    monkeypatch.setattr(db_session, "commit", fail_confirmation_commit)

    with pytest.raises(RuntimeError, match="simulated confirmation"):
        await book_discovery(
            db_session,
            sample_lead,
            _future_slot(calendar_settings),
            calendar,
            calendar_settings,
        )

    assert calendar.deleted_event_ids == ["evt-commit-failure"]
    remaining = await db_session.scalar(select(func.count(Meeting.id)))
    assert remaining == 0


def test_today_availability_excludes_elapsed_slots(
    client: TestClient,
    calendar_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
):
    """At 10:00, neither 09:00 nor the already-started 10:00 slot is returned."""
    tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    fixed_now = datetime(
        today.year, today.month, today.day, 10, 0, tzinfo=tz
    )

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tzinfo=None):
            if tzinfo is None:
                return fixed_now.replace(tzinfo=None)
            return fixed_now.astimezone(tzinfo)

    monkeypatch.setattr(scheduling_module, "datetime", FixedDateTime)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "test-token"})
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        return httpx.Response(404)

    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.get(f"/api/v1/leads/availability?date={today.isoformat()}")
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)

    assert response.status_code == 200
    starts = [
        datetime.fromisoformat(slot["start_time"])
        for slot in response.json()["slots"]
    ]
    assert all(start > fixed_now for start in starts)
    assert starts[0] == fixed_now + timedelta(minutes=30)


@pytest.mark.parametrize(
    "offset",
    [timedelta(seconds=30), timedelta(microseconds=1)],
    ids=["nonzero-seconds", "nonzero-microseconds"],
)
def test_book_rejects_subminute_misalignment_without_google_calls(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    offset: timedelta,
):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(500)

    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": (_future_slot(calendar_settings) + offset).isoformat()},
        )
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)

    assert response.status_code == 422
    assert requests == []


@pytest.mark.asyncio
async def test_scheduled_reservation_conflict_creates_no_google_event(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    """SCHEDULED reservations participate in the local final busy check."""
    slot = _future_slot(calendar_settings)
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            lead_id=sample_lead.id,
            start_time=slot.astimezone(timezone.utc),
            end_time=slot.astimezone(timezone.utc) + timedelta(minutes=30),
            meeting_type=MeetingType.DISCOVERY,
            status=MeetingStatus.SCHEDULED,
        )
    )
    await db_session.commit()
    event_create_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "test-token"})
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        if request.url.path == "/calendar/v3/calendars/primary/events":
            event_create_requests.append(request)
            return httpx.Response(500)
        return httpx.Response(404)

    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)

    assert response.status_code == 409
    assert event_create_requests == []


@pytest.mark.asyncio
async def test_missing_meet_link_returns_502_and_compensates_both_sides(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    """A provider event without Meet is deleted and leaves no reservation row."""
    delete_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "test-token"})
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        if request.method == "DELETE":
            delete_requests.append(request)
            return httpx.Response(204)
        if request.url.path == "/calendar/v3/calendars/primary/events":
            return httpx.Response(
                200,
                json={"id": "evt-no-meet", "conferenceData": {"entryPoints": []}},
            )
        return httpx.Response(404)

    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": _future_slot(calendar_settings).isoformat()},
        )
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)

    assert response.status_code == 502
    assert len(delete_requests) == 1
    assert delete_requests[0].url.path.endswith("/events/evt-no-meet")
    remaining = await db_session.scalar(select(func.count(Meeting.id)))
    assert remaining == 0
