"""Pure-calculation tests for the quotation engine."""

from decimal import Decimal

import pytest

from backend.app.models import PricingConfig, ServiceType
from backend.app.services.quotation import QuoteLine, calculate_quote


def _config(**kwargs) -> PricingConfig:
    defaults = {
        "price_per_m2_base": Decimal("150.00"),
        "branding_base_price": Decimal("5000.00"),
        "integral_multiplier": Decimal("1.50"),
        "default_change_rounds": 3,
    }
    defaults.update(kwargs)
    return PricingConfig(**defaults)


def test_branding_quote():
    config = _config()
    quote = calculate_quote(ServiceType.BRANDING, Decimal("999"), config)

    assert quote.service_type == ServiceType.BRANDING
    assert quote.area_m2 == Decimal("999")
    assert quote.lines == [QuoteLine("Branding base", Decimal("5000.00"))]
    assert quote.multiplier == Decimal("1.00")
    assert quote.total == Decimal("5000.00")
    assert quote.change_rounds == 3


def test_interior_quote():
    config = _config()
    quote = calculate_quote(ServiceType.INTERIOR, Decimal("80"), config)

    assert quote.service_type == ServiceType.INTERIOR
    assert quote.lines == [QuoteLine("Diseño interior por m²", Decimal("12000.00"))]
    assert quote.multiplier == Decimal("1.00")
    assert quote.total == Decimal("12000.00")
    assert quote.change_rounds == 3


def test_integral_quote():
    config = _config()
    quote = calculate_quote(ServiceType.INTEGRAL, Decimal("80"), config)

    assert quote.service_type == ServiceType.INTEGRAL
    assert quote.lines == [
        QuoteLine("Branding base", Decimal("5000.00")),
        QuoteLine("Diseño interior por m²", Decimal("12000.00")),
    ]
    assert quote.multiplier == Decimal("1.50")
    assert quote.total == Decimal("25500.00")
    assert quote.change_rounds == 3


def test_integral_rounding_half_up():
    config = _config(
        branding_base_price=Decimal("5000.00"),
        price_per_m2_base=Decimal("150.00"),
        integral_multiplier=Decimal("1.113"),
    )
    quote = calculate_quote(ServiceType.INTEGRAL, Decimal("10.05"), config)

    assert quote.lines[0].amount == Decimal("5000.00")
    assert quote.lines[1].amount == Decimal("1507.50")
    assert quote.total == Decimal("7242.85")


def test_interior_requires_area():
    config = _config()
    with pytest.raises(ValueError):
        calculate_quote(ServiceType.INTERIOR, None, config)
    with pytest.raises(ValueError):
        calculate_quote(ServiceType.INTERIOR, Decimal("0"), config)


def test_change_rounds_from_config():
    config = _config(default_change_rounds=5)
    quote = calculate_quote(ServiceType.BRANDING, None, config)
    assert quote.change_rounds == 5
