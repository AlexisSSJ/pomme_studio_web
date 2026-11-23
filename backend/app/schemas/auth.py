"""Authentication request/response schemas."""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., min_length=1, max_length=128)


class PasswordResetRequestCreate(BaseModel):
    """Public "I forgot my password" request; the email is never echoed back."""

    email: str = Field(..., max_length=320)


class ChangePasswordRequest(BaseModel):
    """Self-service password change used to clear the mandatory-change flag."""

    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)
