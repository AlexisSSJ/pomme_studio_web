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

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Execute one HTTP request with a normalized transport failure boundary."""
        try:
            async with httpx.AsyncClient(
                transport=self._transport,
                timeout=10.0,
            ) as client:
                return await client.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            raise CalendarAPIError("Google Calendar transport failure") from exc

    @staticmethod
    def _json_object(response: httpx.Response, message: str) -> dict:
        """Decode a provider response and require a JSON object payload."""
        try:
            data = response.json()
        except ValueError as exc:
            raise CalendarAPIError(message) from exc
        if not isinstance(data, dict):
            raise CalendarAPIError(message)
        return data

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
        response = await self._request("POST", self._TOKEN_URL, data=payload)

        if response.status_code >= 400:
            raise CalendarAPIError("Failed to refresh Google access token")

        data = self._json_object(response, "Invalid token response from Google")
        try:
            access_token = data["access_token"]
            if not isinstance(access_token, str) or not access_token:
                raise ValueError("invalid access token")
        except (KeyError, TypeError, ValueError) as exc:
            raise CalendarAPIError("Invalid token response from Google") from exc

        return access_token

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
        response = await self._request(
            "POST",
            self._FREEBUSY_URL,
            json=body,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if response.status_code >= 400:
            raise CalendarAPIError("Google Calendar API request failed")

        data = self._json_object(response, "Unexpected freebusy response format")
        try:
            busy_items = data["calendars"][calendar_id]["busy"]
            if not isinstance(busy_items, list):
                raise TypeError("busy must be a list")

            intervals = []
            for item in busy_items:
                if not isinstance(item, dict):
                    raise TypeError("busy entries must be objects")
                start_value = item["start"]
                end_value = item["end"]
                if not isinstance(start_value, str) or not isinstance(end_value, str):
                    raise TypeError("busy start/end must be strings")
                intervals.append(
                    BusyInterval(
                        start=_parse_utc_iso(start_value),
                        end=_parse_utc_iso(end_value),
                    )
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise CalendarAPIError("Unexpected freebusy response format") from exc

        return intervals

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
        response = await self._request(
            "POST",
            url,
            params={"conferenceDataVersion": "1"},
            json=body,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if response.status_code >= 400:
            raise CalendarAPIError("Google Calendar API request failed")

        data = self._json_object(response, "Unexpected event response format")
        try:
            event_id = data["id"]
            if not isinstance(event_id, str) or not event_id:
                raise ValueError("invalid event id")
        except (KeyError, TypeError, ValueError) as exc:
            raise CalendarAPIError("Missing event id in Google response") from exc

        meet_link = _extract_meet_link(data)
        if not meet_link:
            try:
                await self.delete_event(event_id)
            except (CalendarAPIError, CalendarNotConnectedError):
                pass
            raise CalendarAPIError("Missing Google Meet link in event response")

        return CalendarEvent(event_id=event_id, meet_link=meet_link)

    async def delete_event(self, event_id: str) -> None:
        """Delete a Calendar event; already-absent events are treated as deleted."""
        access_token = await self._get_access_token()
        calendar_id = self._settings.GOOGLE_CALENDAR_ID
        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/"
            f"{calendar_id}/events/{event_id}"
        )
        response = await self._request(
            "DELETE",
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if response.status_code in (404, 410):
            return
        if response.status_code >= 400:
            raise CalendarAPIError("Google Calendar API request failed")


def _parse_utc_iso(value: str) -> datetime:
    """Parse an ISO-8601 string and return an aware UTC datetime."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("expected timezone-aware datetime")
    return parsed.astimezone(timezone.utc)


def _extract_meet_link(data: dict) -> str | None:
    """Return the URI of the first video entryPoint, if any."""
    conference_data = data.get("conferenceData")
    if not isinstance(conference_data, dict):
        return None
    entry_points = conference_data.get("entryPoints")
    if not isinstance(entry_points, list):
        return None
    for entry in entry_points:
        if not isinstance(entry, dict):
            continue
        if entry.get("entryPointType") == "video":
            uri = entry.get("uri")
            return uri if isinstance(uri, str) and uri else None
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
