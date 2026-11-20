"""Tests for the Google Calendar service client."""

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
import pytest

from backend.app.core.config import Settings
from backend.app.services.google_calendar import (
    BusyInterval,
    CalendarAPIError,
    CalendarEvent,
    CalendarNotConnectedError,
    GoogleCalendarClient,
    compute_available_slots,
)


def _utc(*args, **kwargs):
    return datetime(*args, **kwargs, tzinfo=timezone.utc)


def _test_settings() -> Settings:
    return Settings(
        GOOGLE_REFRESH_TOKEN="test-refresh-token",
        GOOGLE_CLIENT_ID="cid",
        GOOGLE_CLIENT_SECRET="csecret",
        GOOGLE_CALENDAR_ID="primary",
    )


def test_settings_defaults():
    """The five new settings exist with the exact defaults from the brief."""
    settings = Settings()
    assert settings.GOOGLE_REFRESH_TOKEN == ""
    assert settings.STUDIO_TIMEZONE == "America/Mexico_City"
    assert settings.STUDIO_BUSINESS_START == "09:00"
    assert settings.STUDIO_BUSINESS_END == "18:00"
    assert settings.DISCOVERY_CALL_MINUTES == 30


@pytest.mark.asyncio
async def test_not_connected_raises():
    """An empty refresh token raises CalendarNotConnectedError without HTTP."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(500)

    settings = Settings(GOOGLE_REFRESH_TOKEN="", GOOGLE_CALENDAR_ID="primary")
    client = GoogleCalendarClient(settings, transport=httpx.MockTransport(handler))

    with pytest.raises(CalendarNotConnectedError):
        await client.freebusy(
            _utc(2026, 11, 20, 9, 0),
            _utc(2026, 11, 20, 18, 0),
        )

    assert calls == []


@pytest.mark.asyncio
async def test_token_refresh_request_shape():
    """The refresh-token request uses the expected form body."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            captured["form"] = dict(httpx.QueryParams(request.content.decode()))
            return httpx.Response(200, json={"access_token": "at-123"})
        return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})

    client = GoogleCalendarClient(_test_settings(), transport=httpx.MockTransport(handler))
    await client.freebusy(_utc(2026, 11, 20, 9, 0), _utc(2026, 11, 20, 18, 0))

    form = captured["form"]
    assert form["grant_type"] == "refresh_token"
    assert form["refresh_token"] == "test-refresh-token"
    assert form["client_id"] == "cid"
    assert form["client_secret"] == "csecret"


@pytest.mark.asyncio
async def test_freebusy_parses_busy():
    """freebusy returns BusyInterval instances parsed from Google's response."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at-123"})
        captured["request"] = request
        return httpx.Response(
            200,
            json={
                "calendars": {
                    "primary": {
                        "busy": [
                            {
                                "start": "2026-11-20T10:00:00Z",
                                "end": "2026-11-20T11:00:00Z",
                            }
                        ]
                    }
                }
            },
        )

    client = GoogleCalendarClient(_test_settings(), transport=httpx.MockTransport(handler))
    result = await client.freebusy(_utc(2026, 11, 20, 9, 0), _utc(2026, 11, 20, 18, 0))

    assert result == [
        BusyInterval(
            start=_utc(2026, 11, 20, 10, 0),
            end=_utc(2026, 11, 20, 11, 0),
        )
    ]

    req = captured["request"]
    body = json.loads(req.content)
    assert body["timeMin"] == "2026-11-20T09:00:00+00:00"
    assert body["timeMax"] == "2026-11-20T18:00:00+00:00"
    assert body["timeZone"] == "UTC"
    assert body["items"] == [{"id": "primary"}]
    assert req.headers["Authorization"] == "Bearer at-123"


@pytest.mark.asyncio
async def test_create_meet_event():
    """create_meet_event builds the correct request and parses the response."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at-123"})
        captured["request"] = request
        return httpx.Response(
            200,
            json={
                "id": "evt-1",
                "conferenceData": {
                    "entryPoints": [
                        {
                            "entryPointType": "video",
                            "uri": "https://meet.google.com/abc-defg-hij",
                        }
                    ]
                },
            },
        )

    client = GoogleCalendarClient(_test_settings(), transport=httpx.MockTransport(handler))
    event = await client.create_meet_event(
        summary="Discovery call",
        start=_utc(2026, 11, 20, 15, 0),
        end=_utc(2026, 11, 20, 15, 30),
        attendee_email="client@example.com",
    )

    assert event == CalendarEvent(event_id="evt-1", meet_link="https://meet.google.com/abc-defg-hij")

    req = captured["request"]
    assert "conferenceDataVersion=1" in str(req.url)
    body = json.loads(req.content)
    assert body["summary"] == "Discovery call"
    assert body["start"] == {"dateTime": "2026-11-20T15:00:00+00:00", "timeZone": "UTC"}
    assert body["end"] == {"dateTime": "2026-11-20T15:30:00+00:00", "timeZone": "UTC"}
    assert body["attendees"] == [{"email": "client@example.com"}]
    assert body["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"] == "hangoutsMeet"
    UUID(body["conferenceData"]["createRequest"]["requestId"])  # valid UUID4


@pytest.mark.asyncio
async def test_create_event_without_meet_link_raises():
    """A missing video entryPoint results in CalendarAPIError."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at-123"})
        return httpx.Response(200, json={"id": "evt-2", "conferenceData": {"entryPoints": []}})

    client = GoogleCalendarClient(_test_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(CalendarAPIError):
        await client.create_meet_event(
            summary="No meet",
            start=_utc(2026, 11, 20, 15, 0),
            end=_utc(2026, 11, 20, 15, 30),
            attendee_email="client@example.com",
        )


@pytest.mark.asyncio
async def test_api_error_on_http_500():
    """An HTTP 500 from Google is surfaced as CalendarAPIError without secrets."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at-123"})
        return httpx.Response(500, text="Internal Server Error")

    client = GoogleCalendarClient(_test_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(CalendarAPIError) as exc_info:
        await client.freebusy(_utc(2026, 11, 20, 9, 0), _utc(2026, 11, 20, 18, 0))

    assert "test-refresh-token" not in str(exc_info.value)


def test_compute_slots_empty_busy():
    """A clear 9-18 day yields 18 consecutive 30-minute slots."""
    start = _utc(2026, 11, 20, 9, 0)
    end = _utc(2026, 11, 20, 18, 0)
    slots = compute_available_slots([], start, end, timedelta(minutes=30))

    assert len(slots) == 18
    assert slots[0] == (start, start + timedelta(minutes=30))
    assert slots[-1] == (end - timedelta(minutes=30), end)


def test_compute_slots_skips_busy():
    """Busy 10-11 blocks overlapping slots; 11:00-11:30 adjacent slot is kept."""
    start = _utc(2026, 11, 20, 9, 0)
    end = _utc(2026, 11, 20, 12, 0)
    busy = [BusyInterval(start=_utc(2026, 11, 20, 10, 0), end=_utc(2026, 11, 20, 11, 0))]
    slots = compute_available_slots(busy, start, end, timedelta(minutes=30))

    assert (_utc(2026, 11, 20, 10, 0), _utc(2026, 11, 20, 10, 30)) not in slots
    assert (_utc(2026, 11, 20, 10, 30), _utc(2026, 11, 20, 11, 0)) not in slots
    assert (_utc(2026, 11, 20, 11, 0), _utc(2026, 11, 20, 11, 30)) in slots


def test_compute_slots_respects_window_end():
    """Only candidates fully inside the window are emitted."""
    start = _utc(2026, 11, 20, 9, 0)
    end = _utc(2026, 11, 20, 10, 0)
    slots = compute_available_slots(
        [], start, end, timedelta(minutes=45), step=timedelta(minutes=30)
    )

    assert slots == [(start, start + timedelta(minutes=45))]
