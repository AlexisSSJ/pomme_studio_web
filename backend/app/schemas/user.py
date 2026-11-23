"""Pydantic schemas for users and authentication payloads."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..models.password_reset_request import PasswordResetRequestStatus
from ..models.user import UserRole


class UserBase(BaseModel):
    email: str = Field(..., max_length=320, description="Unique login email")
    full_name: str | None = Field(default=None, max_length=255)
    specialty: str | None = Field(default=None, max_length=255)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = UserRole.CLIENT


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    specialty: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: UserRole | None = None
    is_active: bool | None = None


class UserRead(UserBase):
    """Public representation of a user (never includes the password hash)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: UserRole
    is_active: bool
    must_change_password: bool = False
    created_at: datetime
    updated_at: datetime


class UserInDB(UserRead):
    hashed_password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class TokenPayload(BaseModel):
    sub: str | None = None
    exp: int | None = None


class PasswordResetRequestRead(BaseModel):
    """Admin-queue representation of a password reset request."""

    id: UUID
    user_id: UUID
    user_email: str
    status: PasswordResetRequestStatus
    requested_at: datetime
    resolved_at: datetime | None = None
    resolved_by: UUID | None = None


class TemporaryPasswordAssign(BaseModel):
    """Optional admin-chosen temporary password for an approved request."""

    temporary_password: str | None = Field(None, min_length=8, max_length=128)


class PasswordResetApproveResponse(BaseModel):
    """Approve result — the only place the temporary password is returned."""

    temporary_password: str
    user: UserRead
