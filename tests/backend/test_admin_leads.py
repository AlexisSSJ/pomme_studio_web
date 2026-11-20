"""Tests for admin/lead-designer lead quotation, proposal and conversion endpoints."""

import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import create_access_token, get_password_hash
from backend.app.models import AuditLog, Lead, LeadStatus, PricingConfig, Project, ServiceType, User, UserRole


class TestQuote:
    def test_quote_ok(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
    ):
        response = client.get(
            f"/api/v1/admin/leads/{sample_lead.id}/quote",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["service_type"] == "interior"
        assert data["total"] == "12000.00"
        assert data["change_rounds"] == 3
        assert data["multiplier"] == "1.00"
        assert len(data["lines"]) == 1
        assert data["lines"][0]["concept"] == "Diseño interior por m²"
        assert data["lines"][0]["amount"] == "12000.00"

    def test_quote_no_config(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
    ):
        response = client.get(
            f"/api/v1/admin/leads/{sample_lead.id}/quote",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "No pricing configuration found"

    def test_quote_lead_not_found(
        self,
        client: TestClient,
        super_admin_token: str,
        pricing_config: PricingConfig,
    ):
        response = client.get(
            f"/api/v1/admin/leads/{uuid.uuid4()}/quote",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_quote_rbac(
        self,
        client: TestClient,
        lead_designer_token: str,
        client_token: str,
        collaborator_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
    ):
        # Lead designer is allowed.
        response = client.get(
            f"/api/v1/admin/leads/{sample_lead.id}/quote",
            headers={"Authorization": f"Bearer {lead_designer_token}"},
        )
        assert response.status_code == 200

        # Client and collaborator are forbidden.
        for token in (client_token, collaborator_token):
            response = client.get(
                f"/api/v1/admin/leads/{sample_lead.id}/quote",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert response.status_code == 403

        # No token → 401.
        response = client.get(f"/api/v1/admin/leads/{sample_lead.id}/quote")
        assert response.status_code == 401

        # Inactive admin → 403.
        inactive_admin = User(
            id=uuid.uuid4(),
            email="inactive-admin@pomme.studio",
            hashed_password=get_password_hash("adminpass123"),
            full_name="Inactive Admin",
            role=UserRole.SUPER_ADMIN,
            is_active=False,
        )
        db_session.add(inactive_admin)
        await db_session.commit()
        token = create_access_token({"sub": str(inactive_admin.id)})

        response = client.get(
            f"/api/v1/admin/leads/{sample_lead.id}/quote",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403


class TestProposal:
    @pytest.mark.asyncio
    async def test_proposal_sets_status_and_audit(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/proposal",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lead_id"] == str(sample_lead.id)
        assert data["total"] == "12000.00"
        assert "generated_at" in data

        lead = await db_session.get(Lead, sample_lead.id)
        assert lead.status == LeadStatus.PROPOSAL_SENT

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "lead.proposal",
                AuditLog.entity_id == sample_lead.id,
            )
        )
        log = result.scalar_one()
        assert log.metadata_json["total"] == "12000.00"
        assert log.metadata_json["service_type"] == "interior"

    @pytest.mark.asyncio
    async def test_proposal_converted_lead(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
    ):
        sample_lead.status = LeadStatus.CONVERTED
        await db_session.commit()

        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/proposal",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_proposal_audit_contains_reconstructable_quote(
        self,
        client: TestClient,
        super_admin_token: str,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
    ):
        lead = Lead(
            id=uuid.uuid4(),
            contact_name="Integral Audit",
            email="integral-audit@example.com",
            service_type=ServiceType.INTEGRAL,
            area_m2=Decimal("80.00"),
            status=LeadStatus.NEW,
        )
        db_session.add(lead)
        await db_session.commit()

        response = client.post(
            f"/api/v1/admin/leads/{lead.id}/proposal",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 200

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "lead.proposal",
                AuditLog.entity_id == lead.id,
            )
        )
        metadata = result.scalar_one().metadata_json
        assert metadata["service_type"] == "integral"
        assert metadata["area_m2"] == "80.00"
        assert metadata["lines"] == [
            {"concept": "Branding base", "amount": "5000.00"},
            {"concept": "Diseño interior por m²", "amount": "12000.00"},
        ]
        assert metadata["multiplier"] == "1.50"
        assert metadata["total"] == "25500.00"
        assert metadata["change_rounds"] == 3
        assert datetime.fromisoformat(metadata["generated_at"]) == datetime.fromisoformat(
            response.json()["generated_at"]
        )

        subtotal = sum(Decimal(line["amount"]) for line in metadata["lines"])
        reconstructed_total = (subtotal * Decimal(metadata["multiplier"])).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        assert reconstructed_total == Decimal(metadata["total"])

        stored_config = await db_session.get(
            PricingConfig, uuid.UUID(metadata["pricing_config_id"])
        )
        assert stored_config is not None
        assert stored_config.id == pricing_config.id


class TestConvert:
    @pytest.mark.asyncio
    async def test_convert_ok(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Proyecto Loft Centro"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Proyecto Loft Centro"
        assert data["status"] == "draft"
        assert data["scope_type"] == "interior"
        assert data["included_rounds"] == 3
        assert data["remaining_rounds"] == 3
        assert data["balance_paid"] is False
        assert data["lead_id"] == str(sample_lead.id)
        assert data["client_id"] is None
        assert data["lead_designer_id"] is None

        project_id = uuid.UUID(data["id"])
        project = await db_session.get(Project, project_id)
        assert project is not None
        assert project.included_rounds == 3
        assert project.remaining_rounds == 3
        assert project.scope_type == ServiceType.INTERIOR
        assert project.lead_id == sample_lead.id

        lead = await db_session.get(Lead, sample_lead.id)
        assert lead.status == LeadStatus.CONVERTED

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "lead.convert",
                AuditLog.entity_id == sample_lead.id,
            )
        )
        log = result.scalar_one()
        assert uuid.UUID(log.metadata_json["project_id"]) == project_id
        assert log.metadata_json["title"] == "Proyecto Loft Centro"
        assert log.metadata_json["included_rounds"] == 3
        assert log.metadata_json["quote_total"] == "12000.00"

    def test_convert_with_client(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        client_user: User,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Proyecto con Cliente", "client_id": str(client_user.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["client_id"] == str(client_user.id)

    def test_convert_invalid_client(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Proyecto Invalid", "client_id": str(uuid.uuid4())},
        )
        assert response.status_code == 422

    def test_convert_collaborator_as_client(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        collaborator_user: User,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Proyecto Invalid", "client_id": str(collaborator_user.id)},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_convert_twice(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Primera Conversión"},
        )
        assert response.status_code == 201

        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Segunda Conversión"},
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_convert_no_config(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        db_session: AsyncSession,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Proyecto Sin Config"},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "No pricing configuration found"

        lead = await db_session.get(Lead, sample_lead.id)
        assert lead.status == LeadStatus.NEW

        result = await db_session.execute(
            select(Project).where(Project.lead_id == sample_lead.id)
        )
        assert result.scalar_one_or_none() is None

    def test_convert_by_designer_sets_lead_designer_id(
        self,
        client: TestClient,
        lead_designer_token: str,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        lead_designer_user: User,
    ):
        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {lead_designer_token}"},
            json={"title": "Proyecto Designer"},
        )
        assert response.status_code == 201
        assert response.json()["lead_designer_id"] == str(lead_designer_user.id)

    def test_convert_rbac(
        self,
        client: TestClient,
        client_token: str,
        collaborator_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
    ):
        for token in (client_token, collaborator_token):
            response = client.post(
                f"/api/v1/admin/leads/{sample_lead.id}/convert",
                headers={"Authorization": f"Bearer {token}"},
                json={"title": "Proyecto RBAC"},
            )
            assert response.status_code == 403

        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            json={"title": "Proyecto RBAC"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_convert_integrity_conflict_returns_409(
        self,
        client: TestClient,
        super_admin_token: str,
        sample_lead: Lead,
        pricing_config: PricingConfig,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """The unique lead constraint surfaces as a graceful conversion conflict."""
        async def fail_with_integrity_error():
            raise IntegrityError("INSERT projects", {}, Exception("duplicate lead_id"))

        monkeypatch.setattr(db_session, "commit", fail_with_integrity_error)
        client.raise_server_exceptions = False

        response = client.post(
            f"/api/v1/admin/leads/{sample_lead.id}/convert",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json={"title": "Concurrent conversion"},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == "Lead already converted"
        await db_session.rollback()
