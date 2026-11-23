"""Seed local demo data for Sprint 3 (brief + moodboard + client portal).

Run from the repository root AFTER applying migrations:

    DATABASE_URL="sqlite+aiosqlite:////workspaces/pomme_studio_web/local_demo.db" \
        backend/.venv/bin/python scripts/seed_demo.py

Idempotent: exits early if the demo admin already exists. Creates demo users,
one ACTIVE interior project (with brief questions/answers, a reference file,
moodboard pieces and a comment thread) and one DRAFT branding project to show
the ACTIVE-only write gate. All passwords are demo-only.
"""

import asyncio
import sys
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from backend.app.core.config import settings  # noqa: E402
from backend.app.core.security import get_password_hash  # noqa: E402
from backend.app.models import (  # noqa: E402
    BriefCategory,
    BriefItem,
    BriefItemType,
    MoodboardComment,
    MoodboardItem,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ServiceType,
    User,
    UserRole,
)
from backend.app.services.storage import (  # noqa: E402
    BRIEF_REFERENCE_CONTENT_TYPES,
    MOODBOARD_CONTENT_TYPES,
    LocalStorage,
)

DEMO_PASSWORDS = {
    "admin@pomme.studio": "admin123",
    "designer@pomme.studio": "designer123",
    "collab@pomme.studio": "collab123",
    "cliente@pomme.studio": "cliente123",
}


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    storage = LocalStorage(Path(settings.MEDIA_ROOT))
    icon_bytes = (ROOT_DIR / "frontend/public/icons/icon-192x192.png").read_bytes()

    async with session_factory() as db:
        existing = await db.execute(
            select(User).where(User.email == "admin@pomme.studio")
        )
        if existing.scalar_one_or_none() is not None:
            print("Demo data already seeded — nothing to do.")
            await engine.dispose()
            return

        users: dict[str, User] = {}
        for email, role in [
            ("admin@pomme.studio", UserRole.SUPER_ADMIN),
            ("designer@pomme.studio", UserRole.LEAD_DESIGNER),
            ("collab@pomme.studio", UserRole.COLLABORATOR),
            ("cliente@pomme.studio", UserRole.CLIENT),
        ]:
            user = User(
                id=uuid.uuid4(),
                email=email,
                hashed_password=get_password_hash(DEMO_PASSWORDS[email]),
                full_name=email.split("@")[0].capitalize(),
                role=role,
                is_active=True,
            )
            db.add(user)
            users[email] = user

        active = Project(
            id=uuid.uuid4(),
            title="Residencia Condesa — Interiorismo",
            client_id=users["cliente@pomme.studio"].id,
            lead_designer_id=users["designer@pomme.studio"].id,
            scope_type=ServiceType.INTERIOR,
            status=ProjectStatus.ACTIVE,
            included_rounds=2,
            remaining_rounds=2,
            balance_paid=True,
        )
        draft = Project(
            id=uuid.uuid4(),
            title="Café Roma — Branding",
            client_id=users["cliente@pomme.studio"].id,
            scope_type=ServiceType.BRANDING,
            status=ProjectStatus.DRAFT,
        )
        db.add_all([active, draft])

        for project, email, role in [
            (active, "cliente@pomme.studio", ProjectRole.CLIENT),
            (active, "designer@pomme.studio", ProjectRole.LEAD_DESIGNER),
            (active, "collab@pomme.studio", ProjectRole.COLLABORATOR),
            (draft, "cliente@pomme.studio", ProjectRole.CLIENT),
        ]:
            db.add(
                ProjectMember(
                    id=uuid.uuid4(),
                    project_id=project.id,
                    user_id=users[email].id,
                    assigned_role=role,
                )
            )

        questions = [
            (BriefCategory.INTERIOR, "¿Qué ambientes debemos priorizar y cómo los usas hoy?"),
            (BriefCategory.INTERIOR, "¿Qué materiales, texturas o paletas te atraen o rechazas?"),
            (BriefCategory.BRANDING, "Si el espacio fuera una marca, ¿qué tres palabras lo definirían?"),
            (BriefCategory.GENERAL, "¿Cuál es el presupuesto objetivo y la fecha límite ideal?"),
        ]
        for category, prompt in questions:
            db.add(
                BriefItem(
                    id=uuid.uuid4(),
                    project_id=active.id,
                    item_type=BriefItemType.QUESTION,
                    category=category,
                    prompt=prompt,
                    created_by=users["designer@pomme.studio"].id,
                )
            )
        # One pre-answered question so the portal shows a saved answer.
        db.add(
            BriefItem(
                id=uuid.uuid4(),
                project_id=active.id,
                item_type=BriefItemType.QUESTION,
                category=BriefCategory.GENERAL,
                prompt="¿Hay restricciones del inmueble (muros, instalaciones, reglamento)?",
                answer="No podemos tocar muros estructurales; el reglamento prohíbe obra en fachada.",
                created_by=users["designer@pomme.studio"].id,
            )
        )

        reference_key = await storage.save(
            active.id, icon_bytes, "image/png", BRIEF_REFERENCE_CONTENT_TYPES
        )
        db.add(
            BriefItem(
                id=uuid.uuid4(),
                project_id=active.id,
                item_type=BriefItemType.REFERENCE,
                category=BriefCategory.INTERIOR,
                note="Referencia de atmósfera que me gusta (placeholder de demo).",
                file_name="referencia-atmosfera.png",
                content_type="image/png",
                size_bytes=len(icon_bytes),
                storage_key=reference_key,
                created_by=users["cliente@pomme.studio"].id,
            )
        )

        pieces = [
            ("Sala — paleta cálida", "Tonos arena y madera clara; luz indirecta.", 0),
            ("Cocina — minimalismo brutalista", "Superficies continuas, herrajes ocultos.", 1),
            ("Estudio — acento editorial", "Retícula suiza, tinta sobre fondo hueso.", 2),
        ]
        first_item: MoodboardItem | None = None
        for title, description, sort_order in pieces:
            key = await storage.save(
                active.id, icon_bytes, "image/png", MOODBOARD_CONTENT_TYPES
            )
            item = MoodboardItem(
                id=uuid.uuid4(),
                project_id=active.id,
                title=title,
                description=description,
                file_name=f"{title.lower().replace(' ', '-')}.png",
                content_type="image/png",
                size_bytes=len(icon_bytes),
                storage_key=key,
                sort_order=sort_order,
                created_by=users["collab@pomme.studio"].id,
            )
            db.add(item)
            if first_item is None:
                first_item = item

        assert first_item is not None
        db.add_all(
            [
                MoodboardComment(
                    id=uuid.uuid4(),
                    moodboard_item_id=first_item.id,
                    user_id=users["cliente@pomme.studio"].id,
                    comment="Me encanta la paleta cálida de la sala.",
                ),
                MoodboardComment(
                    id=uuid.uuid4(),
                    moodboard_item_id=first_item.id,
                    user_id=users["collab@pomme.studio"].id,
                    comment="Probemos una variante con madera más oscura.",
                ),
            ]
        )

        await db.commit()

    await engine.dispose()
    print("Demo seeded. Users (email / password):")
    for email, password in DEMO_PASSWORDS.items():
        print(f"  {email} / {password}")
    print(f"ACTIVE project: {active.title}")
    print(f"DRAFT project (writes gated): {draft.title}")


if __name__ == "__main__":
    asyncio.run(main())
