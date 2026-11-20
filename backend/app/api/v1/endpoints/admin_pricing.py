"""SUPER_ADMIN pricing configuration endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import require_roles
from ....db.session import get_db
from ....models.pricing_config import PricingConfig
from ....models.user import User, UserRole
from ....schemas.pricing import PricingConfigRead, PricingConfigUpdate
from ....services.audit import log_audit

router = APIRouter()


@router.get("/pricing", response_model=PricingConfigRead)
async def get_pricing(
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PricingConfig:
    """Return the most recent pricing configuration."""
    result = await db.execute(
        select(PricingConfig).order_by(PricingConfig.updated_at.desc()).limit(1)
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pricing configuration found",
        )
    return config


@router.put("/pricing", response_model=PricingConfigRead)
async def update_pricing(
    payload: PricingConfigUpdate,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PricingConfig:
    """Create or update pricing configuration (SUPER_ADMIN only)."""
    config = PricingConfig(
        price_per_m2_base=payload.price_per_m2_base,
        branding_base_price=payload.branding_base_price,
        integral_multiplier=payload.integral_multiplier,
        default_change_rounds=payload.default_change_rounds,
        updated_by=current_user.id,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="pricing.update",
        entity_type="pricing_config",
        entity_id=config.id,
        metadata={
            "price_per_m2_base": str(payload.price_per_m2_base),
            "branding_base_price": str(payload.branding_base_price),
            "integral_multiplier": str(payload.integral_multiplier),
            "default_change_rounds": payload.default_change_rounds,
        },
    )
    return config
