"""Declarative base shared by every ORM model.

Alembic's `env.py` (added with the first migration) will import this module —
and the models package — so that `Base.metadata` contains every table.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy 2.0 declarative models."""
