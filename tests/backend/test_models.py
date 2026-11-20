"""Tests for Sprint 1 data models and metadata."""

from backend.app.db.base import Base
from backend.app.models.user import User
from backend.app.models.project import Project
from backend.app.models.project_member import ProjectMember
from backend.app.models.pricing_config import PricingConfig
from backend.app.models.audit_log import AuditLog


def test_metadata_contains_sprint1_tables():
    tables = Base.metadata.tables
    assert "users" in tables
    assert "projects" in tables
    assert "project_members" in tables
    assert "pricing_config" in tables
    assert "audit_logs" in tables


def test_user_has_specialty_column():
    assert hasattr(User, "specialty")
    assert "specialty" in User.__table__.columns


def test_project_member_unique_constraint():
    constraints = ProjectMember.__table__.constraints
    unique_constraints = [
        c for c in constraints
        if c.__class__.__name__ == "UniqueConstraint"
    ]
    assert len(unique_constraints) >= 1
    # The unique constraint should cover project_id and user_id
    cols = set()
    for c in unique_constraints:
        cols.update(col.name for col in c.columns)
    assert "project_id" in cols
    assert "user_id" in cols


def test_pricing_config_defaults():
    table = PricingConfig.__table__
    assert table.columns["integral_multiplier"].default is not None
    assert table.columns["default_change_rounds"].default is not None


def test_audit_log_indexes():
    table = AuditLog.__table__
    indexed_cols = {col.name for col in table.columns if col.index}
    assert "actor_user_id" in indexed_cols or any(
        idx.columns.get("actor_user_id") is not None for idx in table.indexes
    )
