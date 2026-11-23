"""Password reset requests — clients ask the studio for a temporary password.

The studio resolves each request manually (approve/reject) from the admin
queue; approving sets a temporary password on the user and flags it for a
mandatory change on next login.
"""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class PasswordResetRequestStatus(str, enum.Enum):
    """Lifecycle of an admin-mediated password reset request."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            val_lower = value.lower()
            for member in cls:
                if member.value == val_lower or member.name.lower() == val_lower:
                    return member
        return None


PENDING_UNIQUE_INDEX = "uq_password_reset_requests_pending_user"


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"
    # At most one PENDING request per user (generic 200 stays race-safe): the
    # partial unique index makes concurrent inserts collapse into one row, while
    # resolved requests never block a new one.
    __table_args__ = (
        Index(
            PENDING_UNIQUE_INDEX,
            "user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[PasswordResetRequestStatus] = mapped_column(
        SAEnum(
            PasswordResetRequestStatus,
            name="password_reset_request_status",
            native_enum=False,
            values_callable=lambda enum_cls: [m.value for m in enum_cls],
        ),
        default=PasswordResetRequestStatus.PENDING,
        server_default=PasswordResetRequestStatus.PENDING.value,
        nullable=False,
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<PasswordResetRequest user={self.user_id} status={self.status.value}>"
