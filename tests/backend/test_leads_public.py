"""Tests for public lead intake, availability and discovery-call booking."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_calendar_client
from backend.app.core.config import Settings
from backend.app.core.security import create_access_token, get_password_hash
from backend.app.main import app
from backend.app.models import (
    AuditLog,
    BudgetRange,
    Lead,
    LeadStatus,
    Meeting,
    MeetingStatus,
    MeetingType,
    ServiceType,
    SpaceType,
    User,
    UserRole,
)
from backend.app.services.google_calendar import GoogleCalendarClient
from backend.app.services.scheduling import studio_day_window


def _local_to_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def _handler_for_empty_freebusy_and_event(
    captured_event_body: list | None = None,
):
    """Return a MockTransport handler with freebusy empty and a Meet event."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "test-token", "expires_in": 3600},
            )
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        if request.url.path == "/calendar/v3/calendars/primary/events":
            body = None
            if request.content:
                body = httpx.Response(200, content=request.content).json()
            if captured_event_body is not None:
                captured_event_body.append(body)
            return httpx.Response(
                200,
                json={
                    "id": "google-event-123",
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
        return httpx.Response(404)

    return handler


def _handler_for_busy_interval(start_utc: datetime, end_utc: datetime):
    """Return a handler whose freebusy reports one busy interval (UTC)."""

    busy = [
        {
            "start": start_utc.isoformat().replace("+00:00", "Z"),
            "end": end_utc.isoformat().replace("+00:00", "Z"),
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "test-token", "expires_in": 3600},
            )
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(
                200, json={"calendars": {"primary": {"busy": busy}}}
            )
        if request.url.path == "/calendar/v3/calendars/primary/events":
            return httpx.Response(
                200,
                json={
                    "id": "google-event-456",
                    "conferenceData": {
                        "entryPoints": [
                            {
                                "entryPointType": "video",
                                "uri": "https://meet.google.com/zzz-yyyy-xxx",
                            }
                        ]
                    },
                },
            )
        return httpx.Response(404)

    return handler


def _handler_for_google_failure():
    """Return a handler where event creation returns HTTP 500."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "test-token", "expires_in": 3600},
            )
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        if request.url.path == "/calendar/v3/calendars/primary/events":
            return httpx.Response(500, json={"error": {"message": "boom"}})
        return httpx.Response(404)

    return handler


def _handler_with_request_counter():
    """Return a handler and a getter for the number of HTTP calls made."""
    count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "test-token", "expires_in": 3600},
            )
        if request.url.path == "/calendar/v3/freeBusy":
            return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})
        if request.url.path == "/calendar/v3/calendars/primary/events":
            return httpx.Response(
                200,
                json={
                    "id": "google-event-999",
                    "conferenceData": {
                        "entryPoints": [
                            {
                                "entryPointType": "video",
                                "uri": "https://meet.google.com/count",
                            }
                        ]
                    },
                },
            )
        return httpx.Response(404)

    return handler, lambda: count


@pytest.mark.asyncio
async def test_create_lead_ok(client: TestClient, db_session: AsyncSession):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "Ana Prueba",
            "email": "ana@example.com",
            "service_type": "interior",
            "space_type": "residential",
            "area_m2": "80.5",
            "budget_range": "25k_50k",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["contact_name"] == "Ana Prueba"
    assert data["email"] == "ana@example.com"
    assert data["service_type"] == "interior"
    assert data["space_type"] == "residential"
    assert data["area_m2"] == "80.50"
    assert data["budget_range"] == "25k_50k"
    assert data["status"] == "new"
    assert "id" in data
    assert "created_at" in data

    result = await db_session.execute(select(func.count(Lead.id)))
    assert result.scalar_one() == 1


@pytest.mark.asyncio
async def test_create_lead_audit(client: TestClient, db_session: AsyncSession):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "Ana Prueba",
            "email": "ana@example.com",
            "service_type": "interior",
            "space_type": "residential",
            "area_m2": "80.5",
            "budget_range": "25k_50k",
        },
    )
    assert response.status_code == 201

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "lead.create")
    )
    log = result.scalar_one()
    assert log.actor_user_id is None
    assert log.entity_type == "lead"
    assert log.metadata_json["service_type"] == "interior"
    assert log.metadata_json["email"] == "ana@example.com"


def test_create_lead_branding_without_area_ok(client: TestClient):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "Brand Client",
            "email": "brand@example.com",
            "service_type": "branding",
            "budget_range": "10k_25k",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["service_type"] == "branding"
    assert data["area_m2"] is None


def test_create_lead_invalid_email(client: TestClient):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "Bad Email",
            "email": "not-an-email",
            "service_type": "branding",
        },
    )
    assert response.status_code == 422


def test_create_lead_unknown_field(client: TestClient):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "Extra Field",
            "email": "extra@example.com",
            "service_type": "branding",
            "unknown_field": "surprise",
        },
    )
    assert response.status_code == 422


def test_create_lead_interior_without_area(client: TestClient):
    response = client.post(
        "/api/v1/leads",
        json={
            "contact_name": "No Area",
            "email": "noarea@example.com",
            "service_type": "interior",
            "space_type": "residential",
        },
    )
    assert response.status_code == 422


def test_availability_ok(client: TestClient, calendar_settings: Settings):
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(_handler_for_empty_freebusy_and_event()),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        response = client.get(f"/api/v1/leads/availability?date={test_day.isoformat()}")
        assert response.status_code == 200
        data = response.json()
        assert data["date"] == test_day.isoformat()
        assert len(data["slots"]) == 18
        tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)
        first = datetime.fromisoformat(data["slots"][0]["start_time"]).astimezone(tz)
        last = datetime.fromisoformat(data["slots"][-1]["end_time"]).astimezone(tz)
        assert first.hour == 9 and first.minute == 0
        assert last.hour == 18 and last.minute == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_availability_excludes_busy(client: TestClient, calendar_settings: Settings):
    test_day = date.today() + timedelta(days=7)
    window_start, _ = studio_day_window(test_day, calendar_settings)
    tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)
    busy_start = window_start + timedelta(hours=1)  # 10:00
    busy_end = busy_start + timedelta(hours=1)  # 11:00

    handler = _handler_for_busy_interval(
        _local_to_utc(busy_start), _local_to_utc(busy_end)
    )
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.get(f"/api/v1/leads/availability?date={test_day.isoformat()}")
        assert response.status_code == 200
        data = response.json()
        slots = [
            (
                datetime.fromisoformat(s["start_time"]).astimezone(tz),
                datetime.fromisoformat(s["end_time"]).astimezone(tz),
            )
            for s in data["slots"]
        ]
        for start, end in slots:
            assert not (start < busy_end and end > busy_start)
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_availability_not_connected(client: TestClient):
    disconnected_settings = Settings(GOOGLE_REFRESH_TOKEN="")
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        disconnected_settings,
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        response = client.get(f"/api/v1/leads/availability?date={test_day.isoformat()}")
        assert response.status_code == 503
        assert response.json()["detail"] == "Calendar integration not connected"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_availability_past_date(client: TestClient):
    past_day = date.today() - timedelta(days=1)
    response = client.get(f"/api/v1/leads/availability?date={past_day.isoformat()}")
    assert response.status_code == 422


def test_book_discovery_ok(
    client: TestClient, sample_lead: Lead, calendar_settings: Settings
):
    captured: list = []
    handler = _handler_for_empty_freebusy_and_event(captured)
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1)  # 10:00

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["lead_id"] == str(sample_lead.id)
        assert data["project_id"] is None
        assert data["meeting_type"] == "discovery"
        assert data["status"] == "confirmed"
        assert data["meet_link"] == "https://meet.google.com/abc-defg-hij"
        assert "google_event_id" not in data
        assert "id" in data

        assert len(captured) == 1
        event_body = captured[0]
        assert event_body["attendees"][0]["email"] == sample_lead.email
        assert event_body["summary"] == f"Discovery Call — {sample_lead.contact_name}"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_discovery_meeting_persisted(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    handler = _handler_for_empty_freebusy_and_event()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1)

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 201
        data = response.json()

        meeting = await db_session.get(Meeting, uuid.UUID(data["id"]))
        assert meeting is not None
        assert meeting.lead_id == sample_lead.id
        assert meeting.project_id is None
        assert meeting.meeting_type == MeetingType.DISCOVERY
        assert meeting.status == MeetingStatus.CONFIRMED
        assert meeting.google_event_id == "google-event-123"
        assert meeting.meet_link == "https://meet.google.com/abc-defg-hij"
        expected_start_utc = slot.astimezone(timezone.utc).replace(tzinfo=None)
        expected_end_utc = expected_start_utc + timedelta(minutes=30)
        stored_start = (
            meeting.start_time.replace(tzinfo=None)
            if meeting.start_time.tzinfo is not None
            else meeting.start_time
        )
        stored_end = (
            meeting.end_time.replace(tzinfo=None)
            if meeting.end_time.tzinfo is not None
            else meeting.end_time
        )
        assert stored_start == expected_start_utc
        assert stored_end == expected_end_utc

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "meeting.create",
                AuditLog.entity_id == meeting.id,
            )
        )
        log = result.scalar_one()
        assert log.actor_user_id is None
        assert log.metadata_json["lead_id"] == str(sample_lead.id)
        assert log.metadata_json["google_event_id"] == "google-event-123"
        assert "start_time" in log.metadata_json
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_discovery_conflict_freebusy(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    test_day = date.today() + timedelta(days=7)
    window_start, _ = studio_day_window(test_day, calendar_settings)
    slot = window_start + timedelta(hours=1)
    handler = _handler_for_busy_interval(
        _local_to_utc(slot), _local_to_utc(slot + timedelta(minutes=30))
    )
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Slot no longer available"

        count = await db_session.scalar(select(func.count(Meeting.id)))
        assert count == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_discovery_conflict_local(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    test_day = date.today() + timedelta(days=7)
    window_start, _ = studio_day_window(test_day, calendar_settings)
    slot = window_start + timedelta(hours=1)

    slot_utc = slot.astimezone(timezone.utc)
    existing = Meeting(
        id=uuid.uuid4(),
        lead_id=sample_lead.id,
        start_time=slot_utc,
        end_time=slot_utc + timedelta(minutes=30),
        meeting_type=MeetingType.DISCOVERY,
        status=MeetingStatus.CONFIRMED,
    )
    db_session.add(existing)
    await db_session.commit()

    handler = _handler_for_empty_freebusy_and_event()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Slot no longer available"

        count = await db_session.scalar(select(func.count(Meeting.id)))
        assert count == 1
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_book_discovery_misaligned(
    client: TestClient, sample_lead: Lead, calendar_settings: Settings
):
    handler, get_count = _handler_with_request_counter()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1, minutes=15)  # 10:15

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 422
        assert get_count() == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_book_discovery_outside_hours(
    client: TestClient, sample_lead: Lead, calendar_settings: Settings
):
    handler, get_count = _handler_with_request_counter()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start - timedelta(hours=2)  # 07:00

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 422
        assert get_count() == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_book_discovery_past(
    client: TestClient, sample_lead: Lead, calendar_settings: Settings
):
    handler, get_count = _handler_with_request_counter()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        tz = ZoneInfo(calendar_settings.STUDIO_TIMEZONE)
        past_day = date.today() - timedelta(days=1)
        slot = datetime.combine(past_day, datetime.min.time()).replace(
            hour=10, minute=0, tzinfo=tz
        )

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 422
        assert get_count() == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_book_discovery_google_failure(
    client: TestClient, sample_lead: Lead, calendar_settings: Settings
):
    handler = _handler_for_google_failure()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1)

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 502
        assert response.json()["detail"] == "Calendar provider unavailable"
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_book_discovery_google_failure_no_meeting(
    client: TestClient,
    sample_lead: Lead,
    calendar_settings: Settings,
    db_session: AsyncSession,
):
    handler = _handler_for_google_failure()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1)

        response = client.post(
            f"/api/v1/leads/{sample_lead.id}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 502
        count = await db_session.scalar(select(func.count(Meeting.id)))
        assert count == 0
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


def test_book_discovery_lead_not_found(client: TestClient, calendar_settings: Settings):
    handler = _handler_for_empty_freebusy_and_event()
    app.dependency_overrides[get_calendar_client] = lambda: GoogleCalendarClient(
        calendar_settings,
        transport=httpx.MockTransport(handler),
    )
    try:
        test_day = date.today() + timedelta(days=7)
        window_start, _ = studio_day_window(test_day, calendar_settings)
        slot = window_start + timedelta(hours=1)

        response = client.post(
            f"/api/v1/leads/{uuid.uuid4()}/meetings",
            json={"start_time": slot.isoformat()},
        )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(get_calendar_client, None)


@pytest.mark.asyncio
async def test_list_leads_rbac(
    client: TestClient,
    sample_lead: Lead,
    super_admin_token: str,
    lead_designer_token: str,
    client_token: str,
    collaborator_token: str,
    db_session: AsyncSession,
):
    # Create an inactive SUPER_ADMIN user for the 403 case.
    inactive_admin = User(
        id=uuid.uuid4(),
        email="inactiveadmin@pomme.studio",
        hashed_password=get_password_hash("inactivepass123"),
        full_name="Inactive Admin",
        role=UserRole.SUPER_ADMIN,
        is_active=False,
    )
    db_session.add(inactive_admin)
    await db_session.commit()
    inactive_admin_token = create_access_token({"sub": str(inactive_admin.id)})

    headers_admin = {"Authorization": f"Bearer {super_admin_token}"}
    headers_designer = {"Authorization": f"Bearer {lead_designer_token}"}
    headers_client = {"Authorization": f"Bearer {client_token}"}
    headers_collab = {"Authorization": f"Bearer {collaborator_token}"}
    headers_inactive = {"Authorization": f"Bearer {inactive_admin_token}"}

    assert client.get("/api/v1/leads", headers=headers_admin).status_code == 200
    assert client.get("/api/v1/leads", headers=headers_designer).status_code == 200
    assert client.get("/api/v1/leads", headers=headers_client).status_code == 403
    assert client.get("/api/v1/leads", headers=headers_collab).status_code == 403
    assert client.get("/api/v1/leads").status_code == 401
    assert (
        client.get("/api/v1/leads", headers=headers_inactive).status_code == 403
    )


def test_get_lead_detail(
    client: TestClient,
    sample_lead: Lead,
    super_admin_token: str,
    client_token: str,
):
    response = client.get(
        f"/api/v1/leads/{sample_lead.id}",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(sample_lead.id)
    assert data["email"] == sample_lead.email
    assert data["service_type"] == sample_lead.service_type.value
    assert data["status"] == sample_lead.status.value

    response = client.get(
        f"/api/v1/leads/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 404

    response = client.get(
        f"/api/v1/leads/{sample_lead.id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403
