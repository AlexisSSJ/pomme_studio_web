"""Admin/lead-designer endpoints for lead quotation, proposals and conversion."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import require_roles
from ....db.session import get_db
from ....models.lead import Lead, LeadStatus
from ....models.pricing_config import PricingConfig
from ....models.project import Project
from ....models.user import User, UserRole
from ....schemas.project import ProjectRead
from ....schemas.quotation import ConvertRequest, ProposalRead, QuoteLineRead, QuoteRead
from ....services.audit import log_audit
from ....services.quotation import calculate_quote

router = APIRouter()


async def _latest_config(db: AsyncSession) -> PricingConfig | None:
    result = await db.execute(
        select(PricingConfig).order_by(PricingConfig.updated_at.desc()).limit(1)
    )
    return result.scalar_one_or_none()


def _quote_read(quote) -> QuoteRead:
    return QuoteRead(
        service_type=quote.service_type,
        area_m2=quote.area_m2,
        lines=[QuoteLineRead(concept=line.concept, amount=line.amount) for line in quote.lines],
        multiplier=quote.multiplier,
        total=quote.total,
        change_rounds=quote.change_rounds,
    )


def _area_decimal(area_m2) -> Decimal | None:
    if area_m2 is None:
        return None
    return Decimal(str(area_m2))


@router.get("/leads/{lead_id}/quote", response_model=QuoteRead)
async def get_quote(
    lead_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> QuoteRead:
    """Return a quote for a lead using the latest pricing configuration."""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found",
        )

    config = await _latest_config(db)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pricing configuration found",
        )

    try:
        quote = calculate_quote(
            lead.service_type,
            _area_decimal(lead.area_m2),
            config,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _quote_read(quote)


@router.post("/leads/{lead_id}/proposal", response_model=ProposalRead)
async def create_proposal(
    lead_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> ProposalRead:
    """Generate a proposal for a lead and mark it as PROPOSAL_SENT."""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found",
        )

    if lead.status in (LeadStatus.CONVERTED, LeadStatus.DISCARDED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lead already converted or discarded",
        )

    config = await _latest_config(db)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pricing configuration found",
        )

    try:
        quote = calculate_quote(
            lead.service_type,
            _area_decimal(lead.area_m2),
            config,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    generated_at = datetime.now(timezone.utc)
    lead.status = LeadStatus.PROPOSAL_SENT
    await db.commit()
    await db.refresh(lead)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="lead.proposal",
        entity_type="lead",
        entity_id=lead.id,
        metadata={
            "service_type": quote.service_type.value,
            "area_m2": str(quote.area_m2) if quote.area_m2 is not None else None,
            "lines": [
                {"concept": line.concept, "amount": str(line.amount)}
                for line in quote.lines
            ],
            "multiplier": str(quote.multiplier),
            "total": str(quote.total),
            "change_rounds": quote.change_rounds,
            "pricing_config_id": str(config.id),
            "generated_at": generated_at.isoformat(),
        },
    )

    read = _quote_read(quote)
    return ProposalRead(
        **read.model_dump(),
        lead_id=lead.id,
        generated_at=generated_at,
    )


@router.post("/leads/{lead_id}/convert", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def convert_lead(
    lead_id: UUID,
    payload: ConvertRequest,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.LEAD_DESIGNER)),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Convert a qualified lead into a project."""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found",
        )

    if lead.status == LeadStatus.CONVERTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lead already converted",
        )

    config = await _latest_config(db)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No pricing configuration found",
        )

    if payload.client_id is not None:
        client_user = await db.get(User, payload.client_id)
        if client_user is None or client_user.role != UserRole.CLIENT or not client_user.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Invalid client",
            )

    try:
        quote = calculate_quote(
            lead.service_type,
            _area_decimal(lead.area_m2),
            config,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    lead_designer_id = (
        current_user.id if current_user.role == UserRole.LEAD_DESIGNER else None
    )

    project = Project(
        title=payload.title,
        lead_id=lead.id,
        client_id=payload.client_id,
        scope_type=lead.service_type,
        included_rounds=config.default_change_rounds,
        remaining_rounds=config.default_change_rounds,
        balance_paid=False,
        lead_designer_id=lead_designer_id,
    )
    db.add(project)
    lead.status = LeadStatus.CONVERTED
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lead already converted",
        ) from exc
    await db.refresh(project)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="lead.convert",
        entity_type="lead",
        entity_id=lead.id,
        metadata={
            "project_id": str(project.id),
            "title": project.title,
            "included_rounds": project.included_rounds,
            "quote_total": str(quote.total),
        },
    )

    return project
