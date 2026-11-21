"""Idempotent production admin bootstrap.

Creates the SUPER_ADMIN account from ADMIN_EMAIL / ADMIN_PASSWORD environment
variables if it does not exist yet. Runs on every backend start (after
migrations); existing accounts are never modified.

    ADMIN_EMAIL=admin ADMIN_PASSWORD='...' python scripts/seed_admin.py
"""

import asyncio
import os
import sys
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user import User, UserRole


async def main() -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not email or not password:
        print("seed_admin: ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping.")
        return

    engine = create_async_engine(settings.DATABASE_URL)
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with session_factory() as db:
        result = await db.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none() is not None:
            print(f"seed_admin: {email} already exists — nothing to do.")
        else:
            db.add(
                User(
                    id=uuid.uuid4(),
                    email=email,
                    hashed_password=get_password_hash(password),
                    full_name="Administrador",
                    role=UserRole.SUPER_ADMIN,
                    is_active=True,
                )
            )
            await db.commit()
            print(f"seed_admin: created SUPER_ADMIN {email}.")
    await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
