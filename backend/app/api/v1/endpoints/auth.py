"""Authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import get_current_active_user_allow_password_change
from ....core.security import (
    create_access_token,
    get_password_hash,
    verify_password,
)
from ....db.session import get_db
from ....models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from ....models.user import User
from ....schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    PasswordResetRequestCreate,
)
from ....schemas.user import Token, UserRead
from ....services.audit import log_audit

router = APIRouter()

PASSWORD_RESET_ACK = "Si la cuenta existe, tu solicitud fue enviada al estudio."


@router.post("/login", response_model=Token)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Token:
    """Authenticate with email/password and return a JWT access token."""
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    access_token = create_access_token({"sub": str(user.id)})
    return Token(
        access_token=access_token,
        must_change_password=user.must_change_password,
    )


@router.get("/me", response_model=UserRead)
async def me(
    current_user: User = Depends(get_current_active_user_allow_password_change),
) -> User:
    """Return the currently authenticated and active user."""
    return current_user


@router.post("/password-reset-request")
async def request_password_reset(
    payload: PasswordResetRequestCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Ask the studio for a temporary password.

    Public and enumeration-safe: the response is identical whether the email
    is unknown, belongs to an inactive account, or opens a new request.
    """
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is not None and user.is_active:
        # Legacy rows may predate the partial unique index, so the lookup must
        # tolerate duplicates instead of raising MultipleResultsFound (which
        # would turn this public endpoint into a 500).
        pending = await db.execute(
            select(PasswordResetRequest)
            .where(
                PasswordResetRequest.user_id == user.id,
                PasswordResetRequest.status == PasswordResetRequestStatus.PENDING,
            )
            .order_by(PasswordResetRequest.requested_at)
            .limit(1)
        )
        if pending.scalars().first() is None:
            db.add(
                PasswordResetRequest(
                    user_id=user.id,
                    status=PasswordResetRequestStatus.PENDING,
                )
            )
            try:
                await db.commit()
            except IntegrityError:
                # Concurrent request won the race: the partial unique index
                # rejected our duplicate pending row. Same generic 200.
                await db.rollback()

    return {"detail": PASSWORD_RESET_ACK}


@router.post("/change-password", response_model=UserRead)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_active_user_allow_password_change),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Change the caller's own password and clear the mandatory-change flag."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect current password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="New password must differ from the current password",
        )

    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    await db.commit()
    await db.refresh(current_user)

    await log_audit(
        db,
        actor_user_id=current_user.id,
        action="user.password_change",
        entity_type="user",
        entity_id=current_user.id,
        metadata={"email": current_user.email},
    )
    return current_user
