"""Public lead intake and discovery-call scheduling endpoints."""

from datetime import date, datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import get_calendar_client, get_db, require_roles
from ....core.config import settings
from ....models.lead import Lead, LeadStatus
from ....models.user import User, UserRole
from ....schemas.lead import (
    AvailabilityRead,
    LeadCreate,
    LeadRead,
    MeetingCreate,
    MeetingRead,
)
from ....services.audit import log_audit
from ....services.google_calendar import (
    CalendarAPIError,
    CalendarNotConnectedError,
    GoogleCalendarClient,
)
from ....services.scheduling import (
    SlotUnavailableError,
    book_discovery,
    list_discovery_slots,
)

router = APIRouter()


@router.post("", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def create_lead(payload: LeadCreate, db: AsyncSession = Depends(get_db)) -> Lead:
    """Create a new inbound lead (public endpoint)."""
    lead = Lead(
        contact_name=payload.contact_name,
        email=payload.email,
        service_type=payload.service_type,
        space_type=payload.space_type,
        area_m2=payload.area_m2,
        budget_range=payload.budget_range,
        status=LeadStatus.NEW,
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)

    await log_audit(
        db,
        actor_user_id=None,
        action="lead.create",
        entity_type="lead",
        metadata={
            "service_type": lead.service_type.value,
            "email": lead.email,
        },
    )
    return lead


@router.get("/availability", response_model=AvailabilityRead)
async def get_availability(
    day: date = Query(..., alias="date"),
    db: AsyncSession = Depends(get_db),
    client: GoogleCalendarClient = Depends(get_calendar_client),
) -> AvailabilityRead:
    """Return available discovery-call slots for a given date (public endpoint)."""
    tz = ZoneInfo(settings.STUDIO_TIMEZONE)
    now_local = datetime.now(timezone.utc).astimezone(tz)
    if day < now_local.date():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot check availability for a past date",
        )

    try:
        slots = await list_discovery_slots(db, client, day, settings)
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


@router.post("/{lead_id}/meetings", response_model=MeetingRead, status_code=status.HTTP_201_CREATED)
async def book_meeting(
    lead_id: UUID,
    payload: MeetingCreate,
    db: AsyncSession = Depends(get_db),
    client: GoogleCalendarClient = Depends(get_calendar_client),
) -> Meeting:
    """Book a discovery call for an existing lead (public endpoint)."""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found",
        )

    try:
        meeting = await book_discovery(db, lead, payload.start_time, client, settings)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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


@router.get("", response_model=list[LeadRead])
async def list_leads(
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> list[Lead]:
    """List all leads ordered by most recent first."""
    result = await db.execute(select(Lead).order_by(desc(Lead.created_at)))
    return list(result.scalars().all())


@router.get("/{lead_id}", response_model=LeadRead)
async def get_lead(
    lead_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> Lead:
    """Return a single lead by ID."""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found",
        )
    return lead
