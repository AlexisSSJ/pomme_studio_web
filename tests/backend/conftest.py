"""Shared pytest fixtures for backend tests with async SQLite."""

import asyncio
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.core.security import create_access_token, get_password_hash
from backend.app.db.base import Base
from backend.app.db.session import get_db
from backend.app.main import app
from backend.app.models import User, UserRole, Project, ProjectMember, ProjectRole


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def client(db_session: AsyncSession) -> TestClient:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def super_admin_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="admin@pomme.studio",
        hashed_password=get_password_hash("adminpass123"),
        full_name="Super Admin",
        role=UserRole.SUPER_ADMIN,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def client_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="client@example.com",
        hashed_password=get_password_hash("clientpass123"),
        full_name="Test Client",
        role=UserRole.CLIENT,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def collaborator_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="collab@pomme.studio",
        hashed_password=get_password_hash("collabpass123"),
        full_name="Test Collaborator",
        role=UserRole.COLLABORATOR,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def inactive_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="inactive@example.com",
        hashed_password=get_password_hash("inactive123"),
        full_name="Inactive User",
        role=UserRole.CLIENT,
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def super_admin_token(super_admin_user: User) -> str:
    return create_access_token({"sub": str(super_admin_user.id)})


@pytest.fixture
def client_token(client_user: User) -> str:
    return create_access_token({"sub": str(client_user.id)})


@pytest.fixture
def collaborator_token(collaborator_user: User) -> str:
    return create_access_token({"sub": str(collaborator_user.id)})


@pytest_asyncio.fixture
async def test_project(db_session: AsyncSession, client_user: User, collaborator_user: User) -> Project:
    project = Project(
        id=uuid.uuid4(),
        title="Test Project",
        client_id=client_user.id,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=collaborator_user.id,
        assigned_role=ProjectRole.COLLABORATOR,
    )
    db_session.add(member)
    await db_session.commit()
    return project
