"""Studio scheduling helpers for discovery calls and availability windows."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import Settings
from ..models.lead import Lead
from ..models.meeting import Meeting, MeetingStatus, MeetingType
from ..services.audit import log_audit
from ..services.google_calendar import (
    BusyInterval,
    GoogleCalendarClient,
    compute_available_slots,
)


class SlotUnavailableError(Exception):
    """Raised when the requested slot overlaps an existing booking."""


def studio_day_window(day: date, settings: Settings) -> tuple[datetime, datetime]:
    """Return the studio business window for `day` as aware datetimes."""
    tz = ZoneInfo(settings.STUDIO_TIMEZONE)
    start_local_time = datetime.strptime(
        settings.STUDIO_BUSINESS_START, "%H:%M"
    ).time()
    end_local_time = datetime.strptime(settings.STUDIO_BUSINESS_END, "%H:%M").time()
    window_start = datetime.combine(day, start_local_time).replace(tzinfo=tz)
    window_end = datetime.combine(day, end_local_time).replace(tzinfo=tz)
    return window_start, window_end


async def _local_busy(
    db: AsyncSession,
    start: datetime,
    end: datetime,
) -> list[BusyInterval]:
    """Return non-cancelled meetings overlapping [start, end) as busy intervals.

    Meeting times are persisted in UTC and bound as aware UTC datetimes. This
    avoids asyncpg interpreting a naive ``timestamptz`` bind in the process
    local timezone on PostgreSQL. SQLite in-memory tests store datetimes as
    wall-clock strings and continue to compare correctly because both sides use
    the same UTC wall-clock representation.
    """
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)

    result = await db.execute(
        select(Meeting).where(
            Meeting.start_time < end_utc,
            Meeting.end_time > start_utc,
            Meeting.status != MeetingStatus.CANCELLED,
        )
    )
    meetings = result.scalars().all()

    busy: list[BusyInterval] = []
    for m in meetings:
        meeting_start = m.start_time
        meeting_end = m.end_time
        if meeting_start.tzinfo is None:
            meeting_start = meeting_start.replace(tzinfo=timezone.utc)
        if meeting_end.tzinfo is None:
            meeting_end = meeting_end.replace(tzinfo=timezone.utc)
        busy.append(BusyInterval(start=meeting_start, end=meeting_end))
    return busy


async def list_discovery_slots(
    db: AsyncSession,
    client: GoogleCalendarClient,
    day: date,
    settings: Settings,
) -> list[tuple[datetime, datetime]]:
    """Return available discovery-call slots for `day`."""
    window_start, window_end = studio_day_window(day, settings)
    duration = timedelta(minutes=settings.DISCOVERY_CALL_MINUTES)

    google_busy = await client.freebusy(window_start, window_end)
    local_busy = await _local_busy(db, window_start, window_end)

    slots = compute_available_slots(
        google_busy + local_busy,
        window_start,
        window_end,
        duration,
    )
    now_local = datetime.now(timezone.utc).astimezone(
        ZoneInfo(settings.STUDIO_TIMEZONE)
    )
    return [(start, end) for start, end in slots if start > now_local]


async def book_discovery(
    db: AsyncSession,
    lead: Lead,
    start_time: datetime,
    client: GoogleCalendarClient,
    settings: Settings,
) -> Meeting:
    """Book a discovery call for a lead after validating the slot."""
    if start_time.tzinfo is None:
        raise ValueError("start_time must be timezone-aware")

    tz = ZoneInfo(settings.STUDIO_TIMEZONE)
    local_start = start_time.astimezone(tz)
    now_local = datetime.now(timezone.utc).astimezone(tz)

    if local_start < now_local:
        raise ValueError("start_time is in the past")

    day = local_start.date()
    window_start, window_end = studio_day_window(day, settings)
    duration = timedelta(minutes=settings.DISCOVERY_CALL_MINUTES)
    local_end = local_start + duration

    if local_start < window_start or local_start >= window_end:
        raise ValueError("start_time is outside business hours")
    if local_end > window_end:
        raise ValueError("start_time is outside business hours")

    if local_start.second or local_start.microsecond:
        raise ValueError("start_time is not aligned to slot grid")
    elapsed_since_open = local_start - window_start
    if elapsed_since_open % duration != timedelta(0):
        raise ValueError("start_time is not aligned to slot grid")

    google_busy = await client.freebusy(local_start, local_end)
    local_busy = await _local_busy(db, local_start, local_end)

    for interval in google_busy + local_busy:
        if local_start < interval.end and local_end > interval.start:
            raise SlotUnavailableError("slot overlaps an existing booking")

    meeting = Meeting(
        lead_id=lead.id,
        project_id=None,
        google_event_id=None,
        meet_link=None,
        start_time=local_start.astimezone(timezone.utc),
        end_time=local_end.astimezone(timezone.utc),
        meeting_type=MeetingType.DISCOVERY,
        status=MeetingStatus.SCHEDULED,
    )
    db.add(meeting)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise SlotUnavailableError("slot overlaps an existing booking") from exc
    await db.refresh(meeting)

    try:
        event = await client.create_meet_event(
            summary=f"Discovery Call — {lead.contact_name}",
            start=local_start,
            end=local_end,
            attendee_email=lead.email,
        )
    except Exception:
        try:
            await db.delete(meeting)
            await db.commit()
        except Exception:
            await db.rollback()
        raise

    meeting.google_event_id = event.event_id
    meeting.meet_link = event.meet_link
    meeting.status = MeetingStatus.CONFIRMED
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await client.delete_event(event.event_id)
        except Exception:
            pass
        try:
            await db.delete(meeting)
            await db.commit()
        except Exception:
            await db.rollback()
        raise
    await db.refresh(meeting)

    await log_audit(
        db,
        actor_user_id=None,
        action="meeting.create",
        entity_type="meeting",
        entity_id=meeting.id,
        metadata={
            "lead_id": str(lead.id),
            "google_event_id": event.event_id,
            "start_time": meeting.start_time.isoformat(),
        },
    )
    return meeting
