"""SUPER_ADMIN user management endpoints."""

import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import require_roles
from ....core.security import get_password_hash
from ....db.session import get_db
from ....models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from ....models.user import User, UserRole
from ....schemas.user import (
    PasswordResetApproveResponse,
    PasswordResetRequestRead,
    TemporaryPasswordAssign,
    UserCreate,
    UserRead,
)
from ....services.audit import log_audit

router = APIRouter()


class RoleUpdate(BaseModel):
    role: UserRole


class StatusUpdate(BaseModel):
    is_active: bool


def _reset_request_read(
    reset_request: PasswordResetRequest, user_email: str
) -> PasswordResetRequestRead:
    return PasswordResetRequestRead(
        id=reset_request.id,
        user_id=reset_request.user_id,
        user_email=user_email,
        status=reset_request.status,
        requested_at=reset_request.requested_at,
        resolved_at=reset_request.resolved_at,
        resolved_by=reset_request.resolved_by,
    )


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Create a new user (SUPER_ADMIN only)."""
    # Check for duplicate email.
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=payload.email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        specialty=payload.specialty,
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email, "role": user.role.value},
    )
    return user


@router.get("/users", response_model=list[UserRead])
async def list_users(
    role: UserRole | None = None,
    is_active: bool | None = None,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    """List users with optional filters (SUPER_ADMIN only)."""
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    result = await db.execute(query.order_by(User.created_at.desc()))
    return list(result.scalars().all())


@router.patch("/users/{user_id}/role", response_model=UserRead)
async def change_role(
    user_id: UUID,
    payload: RoleUpdate,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Change a user's role (SUPER_ADMIN only)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    old_role = user.role
    user.role = payload.role
    await db.commit()
    await db.refresh(user)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="user.role_change",
        entity_type="user",
        entity_id=user.id,
        metadata={"old_role": old_role.value, "new_role": payload.role.value},
    )
    return user


@router.patch("/users/{user_id}/status", response_model=UserRead)
async def change_status(
    user_id: UUID,
    payload: StatusUpdate,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Activate or deactivate a user (SUPER_ADMIN only)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)

    action = "user.activate" if payload.is_active else "user.deactivate"
    await log_audit(
        db,
        actor_user_id=current_user.id,
        action=action,
        entity_type="user",
        entity_id=user.id,
        metadata={"is_active": payload.is_active},
    )
    return user


@router.get(
    "/password-reset-requests",
    response_model=list[PasswordResetRequestRead],
)
async def list_password_reset_requests(
    status_filter: PasswordResetRequestStatus | None = Query(
        default=None, alias="status"
    ),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[PasswordResetRequestRead]:
    """List password reset requests, newest first (SUPER_ADMIN only)."""
    query = (
        select(PasswordResetRequest, User.email)
        .join(User, User.id == PasswordResetRequest.user_id)
        .order_by(PasswordResetRequest.requested_at.desc())
    )
    if status_filter is not None:
        query = query.where(PasswordResetRequest.status == status_filter)
    result = await db.execute(query)
    return [
        _reset_request_read(reset_request, email)
        for reset_request, email in result.all()
    ]


@router.post(
    "/password-reset-requests/{request_id}/approve",
    response_model=PasswordResetApproveResponse,
)
async def approve_password_reset_request(
    request_id: UUID,
    payload: TemporaryPasswordAssign | None = None,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PasswordResetApproveResponse:
    """Approve a request, assigning a temporary password (SUPER_ADMIN only).

    The generated plaintext password is returned exactly once, in this
    response body; it is never written to the audit log.
    """
    reset_request = await db.get(PasswordResetRequest, request_id)
    if reset_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password reset request not found",
        )
    if reset_request.status != PasswordResetRequestStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Password reset request is not pending",
        )

    user = await db.get(User, reset_request.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    temporary_password = (
        payload.temporary_password
        if payload is not None and payload.temporary_password
        else secrets.token_urlsafe(12)
    )
    user.hashed_password = get_password_hash(temporary_password)
    user.must_change_password = True
    reset_request.status = PasswordResetRequestStatus.APPROVED
    reset_request.resolved_at = datetime.now(timezone.utc)
    reset_request.resolved_by = current_user.id
    await db.commit()
    await db.refresh(user)
    await db.refresh(reset_request)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="user.password_reset_approve",
        entity_type="user",
        entity_id=user.id,
        metadata={
            "email": user.email,
            "request_id": str(reset_request.id),
        },
    )
    return PasswordResetApproveResponse(
        temporary_password=temporary_password,
        user=UserRead.model_validate(user),
    )


@router.post(
    "/password-reset-requests/{request_id}/reject",
    response_model=PasswordResetRequestRead,
)
async def reject_password_reset_request(
    request_id: UUID,
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> PasswordResetRequestRead:
    """Reject a pending request without touching the account (SUPER_ADMIN only)."""
    reset_request = await db.get(PasswordResetRequest, request_id)
    if reset_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password reset request not found",
        )
    if reset_request.status != PasswordResetRequestStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Password reset request is not pending",
        )

    user = await db.get(User, reset_request.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    reset_request.status = PasswordResetRequestStatus.REJECTED
    reset_request.resolved_at = datetime.now(timezone.utc)
    reset_request.resolved_by = current_user.id
    await db.commit()
    await db.refresh(reset_request)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="user.password_reset_reject",
        entity_type="user",
        entity_id=user.id,
        metadata={
            "email": user.email,
            "request_id": str(reset_request.id),
        },
    )
    return _reset_request_read(reset_request, user.email)
