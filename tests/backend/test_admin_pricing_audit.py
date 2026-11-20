"""Tests for SUPER_ADMIN pricing and audit log endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import User, AuditLog, PricingConfig


def test_super_admin_updates_pricing(
    client: TestClient, super_admin_token: str, db_session: AsyncSession
):
    response = client.put(
        "/api/v1/admin/pricing",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={
            "price_per_m2_base": "150.00",
            "branding_base_price": "5000.00",
            "integral_multiplier": "1.5",
            "default_change_rounds": 3,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["price_per_m2_base"] == "150.00"
    assert data["default_change_rounds"] == 3


@pytest.mark.asyncio
async def test_pricing_update_audit_log(
    client: TestClient, super_admin_token: str, db_session: AsyncSession
):
    response = client.put(
        "/api/v1/admin/pricing",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={
            "price_per_m2_base": "200.00",
            "branding_base_price": "6000.00",
            "integral_multiplier": "2.0",
            "default_change_rounds": 2,
        },
    )
    assert response.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "pricing.update")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1


def test_lead_designer_cannot_update_pricing(
    client: TestClient, collaborator_token: str
):
    # Collaborator is not SUPER_ADMIN.
    response = client.put(
        "/api/v1/admin/pricing",
        headers={"Authorization": f"Bearer {collaborator_token}"},
        json={
            "price_per_m2_base": "100.00",
            "branding_base_price": "3000.00",
            "integral_multiplier": "1.0",
            "default_change_rounds": 2,
        },
    )
    assert response.status_code == 403


def test_super_admin_reads_audit_logs(
    client: TestClient, super_admin_token: str
):
    response = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_client_cannot_read_audit_logs(client: TestClient, client_token: str):
    response = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403


def test_get_pricing_not_found(client: TestClient, super_admin_token: str):
    response = client.get(
        "/api/v1/admin/pricing",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    # No pricing config exists yet in this test's DB.
    assert response.status_code == 404
