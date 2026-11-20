"""Quotation engine — pure calculation rules for Pomme Studio proposals."""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from ..models.lead import ServiceType
from ..models.pricing_config import PricingConfig

_CENTS = Decimal("0.01")


@dataclass(frozen=True)
class QuoteLine:
    concept: str
    amount: Decimal


@dataclass(frozen=True)
class Quote:
    service_type: ServiceType
    area_m2: Decimal | None
    lines: list[QuoteLine]
    multiplier: Decimal
    total: Decimal
    change_rounds: int


def _as_decimal(value: Decimal | float | int | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _quantize(amount: Decimal) -> Decimal:
    return amount.quantize(_CENTS, rounding=ROUND_HALF_UP)


def calculate_quote(
    service_type: ServiceType,
    area_m2: Decimal | None,
    config: PricingConfig,
) -> Quote:
    """Return a quote for the given service type and area using `config`."""
    if service_type == ServiceType.BRANDING:
        lines = [QuoteLine("Branding base", _quantize(config.branding_base_price))]
        return Quote(
            service_type=service_type,
            area_m2=area_m2,
            lines=lines,
            multiplier=Decimal("1.00"),
            total=lines[0].amount,
            change_rounds=config.default_change_rounds,
        )

    if service_type in (ServiceType.INTERIOR, ServiceType.INTEGRAL):
        if area_m2 is None or area_m2 <= 0:
            raise ValueError("area_m2 is required for interior or integral services")

        area = _as_decimal(area_m2)
        interior_amount = _quantize(config.price_per_m2_base * area)

        if service_type == ServiceType.INTERIOR:
            lines = [QuoteLine("Diseño interior por m²", interior_amount)]
            return Quote(
                service_type=service_type,
                area_m2=area,
                lines=lines,
                multiplier=Decimal("1.00"),
                total=lines[0].amount,
                change_rounds=config.default_change_rounds,
            )

        # INTEGRAL: branding + interior, then apply multiplier.
        branding_amount = _quantize(config.branding_base_price)
        lines = [
            QuoteLine("Branding base", branding_amount),
            QuoteLine("Diseño interior por m²", interior_amount),
        ]
        subtotal = branding_amount + interior_amount
        total = _quantize(subtotal * config.integral_multiplier)
        return Quote(
            service_type=service_type,
            area_m2=area,
            lines=lines,
            multiplier=config.integral_multiplier,
            total=total,
            change_rounds=config.default_change_rounds,
        )

    raise ValueError(f"Unsupported service type: {service_type}")
