"""Tests for the admin-mediated password reset flow.

Covers the public enumeration-safe request endpoint, the SUPER_ADMIN
approve/reject queue, the temporary-password login flag and the
`password_change_required` guard plus the self-service change-password
endpoint that clears it.
"""

import json
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import verify_password
from backend.app.models import (
    AuditLog,
    PasswordResetRequest,
    PasswordResetRequestStatus,
    User,
)

REQUEST_URL = "/api/v1/auth/password-reset-request"
QUEUE_URL = "/api/v1/admin/password-reset-requests"
SAFE_DETAIL = "Si la cuenta existe, tu solicitud fue enviada al estudio."


async def _create_pending_request(
    db_session: AsyncSession, user: User
) -> PasswordResetRequest:
    request = PasswordResetRequest(
        id=uuid.uuid4(),
        user_id=user.id,
        status=PasswordResetRequestStatus.PENDING,
        requested_at=datetime.now(timezone.utc),
    )
    db_session.add(request)
    await db_session.commit()
    await db_session.refresh(request)
    return request


@pytest_asyncio.fixture
async def pending_reset_request(
    db_session: AsyncSession, client_user: User
) -> PasswordResetRequest:
    return await _create_pending_request(db_session, client_user)


async def _request_rows(db_session: AsyncSession) -> list[PasswordResetRequest]:
    result = await db_session.execute(select(PasswordResetRequest))
    return list(result.scalars().all())


def _approve(client: TestClient, token: str, request_id, body: dict | None = None):
    return client.post(
        f"{QUEUE_URL}/{request_id}/approve",
        headers={"Authorization": f"Bearer {token}"},
        json=body if body is not None else {},
    )


def _reject(client: TestClient, token: str, request_id):
    return client.post(
        f"{QUEUE_URL}/{request_id}/reject",
        headers={"Authorization": f"Bearer {token}"},
    )


# --- public request endpoint -------------------------------------------------


@pytest.mark.asyncio
async def test_request_creates_pending_row(
    client: TestClient,
    db_session: AsyncSession,
    client_user: User,
):
    response = client.post(REQUEST_URL, json={"email": client_user.email})

    assert response.status_code == 200
    assert response.json() == {"detail": SAFE_DETAIL}

    rows = await _request_rows(db_session)
    assert len(rows) == 1
    assert rows[0].user_id == client_user.id
    assert rows[0].status == PasswordResetRequestStatus.PENDING
    assert rows[0].resolved_at is None
    assert rows[0].resolved_by is None


@pytest.mark.asyncio
async def test_request_dedupes_pending_requests(
    client: TestClient,
    db_session: AsyncSession,
    client_user: User,
):
    first = client.post(REQUEST_URL, json={"email": client_user.email})
    second = client.post(REQUEST_URL, json={"email": client_user.email})

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"detail": SAFE_DETAIL}

    rows = await _request_rows(db_session)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_request_is_enumeration_safe_for_unknown_and_inactive(
    client: TestClient,
    db_session: AsyncSession,
    client_user: User,
    inactive_user: User,
):
    known = client.post(REQUEST_URL, json={"email": client_user.email})
    unknown = client.post(REQUEST_URL, json={"email": "nobody@example.com"})
    inactive = client.post(REQUEST_URL, json={"email": inactive_user.email})

    assert known.status_code == unknown.status_code == inactive.status_code == 200
    assert known.json() == unknown.json() == inactive.json() == {"detail": SAFE_DETAIL}

    # Only the active, known account gets a row; the other two are silent no-ops.
    rows = await _request_rows(db_session)
    assert len(rows) == 1
    assert rows[0].user_id == client_user.id


# --- admin queue -------------------------------------------------------------


def test_client_cannot_list_requests(client: TestClient, client_token: str):
    response = client.get(
        QUEUE_URL,
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403


def test_client_cannot_approve_request(
    client: TestClient,
    client_token: str,
    pending_reset_request: PasswordResetRequest,
):
    response = _approve(client, client_token, pending_reset_request.id)
    assert response.status_code == 403


def test_client_cannot_reject_request(
    client: TestClient,
    client_token: str,
    pending_reset_request: PasswordResetRequest,
):
    response = _reject(client, client_token, pending_reset_request.id)
    assert response.status_code == 403


def test_admin_list_includes_user_email_and_status_filter(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
):
    response = client.get(
        QUEUE_URL,
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["user_id"] == str(client_user.id)
    assert data[0]["user_email"] == client_user.email
    assert data[0]["status"] == "pending"
    assert data[0]["resolved_at"] is None
    assert data[0]["resolved_by"] is None

    filtered = client.get(
        f"{QUEUE_URL}?status=approved",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert filtered.status_code == 200
    assert filtered.json() == []


@pytest.mark.asyncio
async def test_approve_generates_temporary_password_and_audits_without_it(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
    db_session: AsyncSession,
):
    response = _approve(client, super_admin_token, pending_reset_request.id)

    assert response.status_code == 200
    data = response.json()
    temporary_password = data["temporary_password"]
    assert len(temporary_password) >= 8
    assert data["user"]["id"] == str(client_user.id)
    assert data["user"]["must_change_password"] is True

    await db_session.refresh(client_user)
    assert client_user.must_change_password is True
    assert verify_password(temporary_password, client_user.hashed_password) is True

    await db_session.refresh(pending_reset_request)
    assert pending_reset_request.status == PasswordResetRequestStatus.APPROVED
    assert pending_reset_request.resolved_by == super_admin_user.id
    assert pending_reset_request.resolved_at is not None

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.password_reset_approve")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1
    metadata = json.dumps(logs[-1].metadata_json)
    assert temporary_password not in metadata
    assert "password" not in metadata.lower()


@pytest.mark.asyncio
async def test_approve_with_custom_temporary_password(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
    db_session: AsyncSession,
):
    response = _approve(
        client,
        super_admin_token,
        pending_reset_request.id,
        {"temporary_password": "TempPass123"},
    )

    assert response.status_code == 200
    assert response.json()["temporary_password"] == "TempPass123"

    await db_session.refresh(client_user)
    assert verify_password("TempPass123", client_user.hashed_password) is True
    assert client_user.must_change_password is True


def test_approve_rejects_too_short_custom_password(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
):
    response = _approve(
        client,
        super_admin_token,
        pending_reset_request.id,
        {"temporary_password": "short"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_approve_non_pending_request_conflicts(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    db_session: AsyncSession,
):
    pending_reset_request.status = PasswordResetRequestStatus.APPROVED
    await db_session.commit()

    response = _approve(client, super_admin_token, pending_reset_request.id)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_reject_non_pending_request_conflicts(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    db_session: AsyncSession,
):
    pending_reset_request.status = PasswordResetRequestStatus.REJECTED
    await db_session.commit()

    response = _reject(client, super_admin_token, pending_reset_request.id)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_reject_marks_rejected_and_audits(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
    db_session: AsyncSession,
):
    response = _reject(client, super_admin_token, pending_reset_request.id)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "rejected"
    assert data["user_email"] == client_user.email
    assert data["resolved_by"] == str(super_admin_user.id)
    assert data["resolved_at"] is not None

    await db_session.refresh(pending_reset_request)
    assert pending_reset_request.status == PasswordResetRequestStatus.REJECTED

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.password_reset_reject")
    )
    assert result.scalars().all()


# --- login flag, guard and change-password -----------------------------------


@pytest.mark.asyncio
async def test_login_with_temporary_password_returns_flag(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
):
    approved = _approve(client, super_admin_token, pending_reset_request.id)
    assert approved.status_code == 200
    temporary_password = approved.json()["temporary_password"]

    response = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": temporary_password},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["must_change_password"] is True
    assert data["token_type"] == "bearer"
    assert data["access_token"]


@pytest.mark.asyncio
async def test_flagged_user_is_blocked_on_strict_endpoints_but_me_works(
    client: TestClient,
    super_admin_token: str,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
):
    approved = _approve(client, super_admin_token, pending_reset_request.id)
    temporary_password = approved.json()["temporary_password"]

    login = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": temporary_password},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # require_roles endpoint: the flag wins over the role check.
    blocked = client.get("/api/v1/admin/users", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "password_change_required"

    # Plain get_current_active_user endpoint.
    notifications = client.get("/api/v1/notifications", headers=headers)
    assert notifications.status_code == 403
    assert notifications.json()["detail"] == "password_change_required"

    # /auth/me stays reachable so the client can read the flag.
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True


@pytest.mark.asyncio
async def test_change_password_clears_flag_and_restores_access(
    client: TestClient,
    super_admin_token: str,
    super_admin_user: User,
    pending_reset_request: PasswordResetRequest,
    client_user: User,
    db_session: AsyncSession,
):
    approved = _approve(client, super_admin_token, pending_reset_request.id)
    temporary_password = approved.json()["temporary_password"]

    login = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": temporary_password},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    wrong_current = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": "definitely-wrong", "new_password": "BrandNewPass123"},
    )
    assert wrong_current.status_code == 401

    same_password = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": temporary_password,
            "new_password": temporary_password,
        },
    )
    assert same_password.status_code == 422

    changed = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": temporary_password, "new_password": "BrandNewPass123"},
    )
    assert changed.status_code == 200
    assert changed.json()["must_change_password"] is False

    await db_session.refresh(client_user)
    assert client_user.must_change_password is False
    assert verify_password("BrandNewPass123", client_user.hashed_password) is True

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.password_change")
    )
    logs = result.scalars().all()
    assert len(logs) >= 1
    assert logs[-1].entity_id == client_user.id
    assert "BrandNewPass123" not in json.dumps(logs[-1].metadata_json)

    # The temporary password no longer works; the new one logs in unflagged.
    old_login = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": temporary_password},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": client_user.email, "password": "BrandNewPass123"},
    )
    assert new_login.status_code == 200
    assert new_login.json()["must_change_password"] is False

    # Normal role-based access is restored (CLIENT is still denied admin).
    restored = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {new_login.json()['access_token']}"},
    )
    assert restored.status_code == 403
    assert restored.json()["detail"] == "Insufficient permissions"
