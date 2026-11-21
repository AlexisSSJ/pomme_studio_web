"""Project meeting endpoints: review/survey bookings via Google Calendar."""

from datetime import date, datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import (
    get_calendar_client,
    get_stage_or_404,
    require_active_project,
    require_project_access_from_path,
)
from ....core.config import settings
from ....db.session import get_db
from ....models.meeting import Meeting
from ....models.user import User
from ....schemas.lead import AvailabilityRead
from ....schemas.meeting import ProjectMeetingCreate, ProjectMeetingRead
from ....services.google_calendar import (
    CalendarAPIError,
    CalendarNotConnectedError,
    GoogleCalendarClient,
)
from ....services.scheduling import (
    SlotUnavailableError,
    book_project_meeting,
    list_project_meeting_slots,
)

router = APIRouter()


@router.get("", response_model=list[ProjectMeetingRead])
async def list_meetings(
    project_id: UUID,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
) -> list[Meeting]:
    """List the project's meetings ordered by start time (any member, any status)."""
    result = await db.execute(
        select(Meeting)
        .where(Meeting.project_id == project_id)
        .order_by(Meeting.start_time.asc())
    )
    return list(result.scalars().all())


@router.get("/availability", response_model=AvailabilityRead)
async def get_availability(
    project_id: UUID,
    day: date = Query(..., alias="date"),
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    client: GoogleCalendarClient = Depends(get_calendar_client),
) -> AvailabilityRead:
    """Return available review/survey slots for a given date (any member)."""
    tz = ZoneInfo(settings.STUDIO_TIMEZONE)
    now_local = datetime.now(timezone.utc).astimezone(tz)
    if day < now_local.date():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cannot check availability for a past date",
        )

    try:
        slots = await list_project_meeting_slots(db, client, day, settings)
    except CalendarNotConnectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Calendar integration not connected",
        ) from exc
    except CalendarAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Calendar provider unavailable",
        ) from exc

    return AvailabilityRead(
        date=day,
        slots=[{"start_time": s[0], "end_time": s[1]} for s in slots],
    )


@router.post(
    "",
    response_model=ProjectMeetingRead,
    status_code=status.HTTP_201_CREATED,
)
async def book_meeting(
    project_id: UUID,
    payload: ProjectMeetingCreate,
    current_user: User = Depends(require_project_access_from_path),
    db: AsyncSession = Depends(get_db),
    client: GoogleCalendarClient = Depends(get_calendar_client),
) -> Meeting:
    """Book a review or survey meeting for the project (any member, ACTIVE only).

    The Meet attendee is the project's client user when the project has one,
    falling back to the booking user's own email.
    """
    project = await require_active_project(project_id, db)

    stage = None
    if payload.stage_id is not None:
        stage = await get_stage_or_404(db, project_id, payload.stage_id)

    attendee_email = current_user.email
    if project.client_id is not None:
        client_user = await db.get(User, project.client_id)
        if client_user is not None:
            attendee_email = client_user.email

    try:
        meeting = await book_project_meeting(
            db,
            project,
            payload.meeting_type,
            payload.start_time,
            client,
            settings,
            actor_user_id=current_user.id,
            attendee_email=attendee_email,
            stage_id=stage.id if stage is not None else None,
            stage_name=stage.name if stage is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except SlotUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Slot no longer available",
        ) from exc
    except CalendarNotConnectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Calendar integration not connected",
        ) from exc
    except CalendarAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Calendar provider unavailable",
        ) from exc

    return meeting
