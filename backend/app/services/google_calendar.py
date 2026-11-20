"""Google Calendar API client for availability checks and Meet events."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from ..core.config import Settings


class CalendarNotConnectedError(Exception):
    """Raised when the integration has no refresh token configured."""


class CalendarAPIError(Exception):
    """Raised when Google's Calendar/OAuth API returns an error response."""


@dataclass(frozen=True)
class BusyInterval:
    """A period marked as busy on the studio calendar."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class CalendarEvent:
    """A created calendar event with its Google Meet link."""

    event_id: str
    meet_link: str


class GoogleCalendarClient:
    """Async client wrapping Google Calendar freebusy and event creation."""

    _TOKEN_URL = "https://oauth2.googleapis.com/token"
    _FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    def _require_utc(self, value: datetime, name: str) -> datetime:
        """Return an aware UTC datetime, rejecting naive inputs."""
        if value.tzinfo is None:
            raise ValueError(f"{name} must be timezone-aware")
        return value.astimezone(timezone.utc)

    async def _get_access_token(self) -> str:
        """Refresh the OAuth access token using the configured refresh token."""
        refresh_token = self._settings.GOOGLE_REFRESH_TOKEN
        if not refresh_token:
            raise CalendarNotConnectedError("Google Calendar is not connected")

        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self._settings.GOOGLE_CLIENT_ID,
            "client_secret": self._settings.GOOGLE_CLIENT_SECRET,
        }

        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=10.0,
        ) as client:
            response = await client.post(self._TOKEN_URL, data=payload)

        if response.status_code >= 400:
            raise CalendarAPIError("Failed to refresh Google access token")

        data = response.json()
        access_token = data.get("access_token")
        if not access_token:
            raise CalendarAPIError("Invalid token response from Google")

        return str(access_token)

    async def freebusy(self, start: datetime, end: datetime) -> list[BusyInterval]:
        """Query busy intervals on the configured calendar inside [start, end)."""
        start_utc = self._require_utc(start, "start")
        end_utc = self._require_utc(end, "end")
        access_token = await self._get_access_token()
        calendar_id = self._settings.GOOGLE_CALENDAR_ID

        body = {
            "timeMin": start_utc.isoformat(),
            "timeMax": end_utc.isoformat(),
            "timeZone": "UTC",
            "items": [{"id": calendar_id}],
        }

        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=10.0,
        ) as client:
            response = await client.post(
                self._FREEBUSY_URL,
                json=body,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if response.status_code >= 400:
            raise CalendarAPIError("Google Calendar API request failed")

        data = response.json()
        try:
            busy_items = data["calendars"][calendar_id]["busy"]
        except KeyError as exc:
            raise CalendarAPIError("Unexpected freebusy response format") from exc

        return [
            BusyInterval(
                start=_parse_utc_iso(item["start"]),
                end=_parse_utc_iso(item["end"]),
            )
            for item in busy_items
        ]

    async def create_meet_event(
        self,
        summary: str,
        start: datetime,
        end: datetime,
        attendee_email: str,
    ) -> CalendarEvent:
        """Create a Calendar event with a Google Meet conference."""
        start_utc = self._require_utc(start, "start")
        end_utc = self._require_utc(end, "end")
        access_token = await self._get_access_token()
        calendar_id = self._settings.GOOGLE_CALENDAR_ID

        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
        )
        body = {
            "summary": summary,
            "start": {"dateTime": start_utc.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_utc.isoformat(), "timeZone": "UTC"},
            "attendees": [{"email": attendee_email}],
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }

        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=10.0,
        ) as client:
            response = await client.post(
                url,
                params={"conferenceDataVersion": "1"},
                json=body,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if response.status_code >= 400:
            raise CalendarAPIError("Google Calendar API request failed")

        data = response.json()
        event_id = data.get("id")
        if not event_id:
            raise CalendarAPIError("Missing event id in Google response")

        meet_link = _extract_meet_link(data)
        if not meet_link:
            raise CalendarAPIError("Missing Google Meet link in event response")

        return CalendarEvent(event_id=event_id, meet_link=meet_link)


def _parse_utc_iso(value: str) -> datetime:
    """Parse an ISO-8601 string and return an aware UTC datetime."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("expected timezone-aware datetime")
    return parsed.astimezone(timezone.utc)


def _extract_meet_link(data: dict) -> str | None:
    """Return the URI of the first video entryPoint, if any."""
    for entry in data.get("conferenceData", {}).get("entryPoints", []):
        if entry.get("entryPointType") == "video":
            return entry.get("uri")
    return None


def compute_available_slots(
    busy: list[BusyInterval],
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    step: timedelta | None = None,
) -> list[tuple[datetime, datetime]]:
    """Return candidate slots inside the window that do not overlap busy intervals."""
    if step is None:
        step = duration

    window_start = _ensure_utc(window_start)
    window_end = _ensure_utc(window_end)

    slots: list[tuple[datetime, datetime]] = []
    candidate = window_start
    while candidate + duration <= window_end:
        slot_end = candidate + duration
        if not _overlaps_busy(candidate, slot_end, busy):
            slots.append((candidate, slot_end))
        candidate += step

    return slots


def _ensure_utc(value: datetime) -> datetime:
    """Return the datetime in UTC, rejecting naive values."""
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(timezone.utc)


def _overlaps_busy(
    start: datetime,
    end: datetime,
    busy: list[BusyInterval],
) -> bool:
    """Return True when [start, end) strictly overlaps any busy interval."""
    for interval in busy:
        if start < interval.end and end > interval.start:
            return True
    return False
