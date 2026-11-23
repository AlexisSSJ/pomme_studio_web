"""Scope-aware design brief templates seeded when a project is created.

The templates contain only questions about branding, interior design,
creative direction and FF&E specifications. Execution, construction and
on-site topics are deliberately out of scope for the studio.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.brief_item import (
    BriefCategory,
    BriefItem,
    BriefItemType,
    BriefStatus,
)
from ..models.lead import ServiceType
from ..models.project import Project

_BRANDING_QUESTIONS: list[tuple[str, BriefCategory]] = [
    (
        "¿Cuál es la esencia de su marca y qué valores fundamentales desea que transmita?",
        BriefCategory.BRANDING,
    ),
    (
        "¿A quién se dirige principalmente su marca? Describa su público objetivo y sus necesidades.",
        BriefCategory.BRANDING,
    ),
    (
        "¿Qué personalidad y tono de voz debería tener la marca al comunicarse con su audiencia?",
        BriefCategory.BRANDING,
    ),
    (
        "¿Quiénes son sus principales competidores y qué diferencia a su propuesta de la de ellos?",
        BriefCategory.BRANDING,
    ),
    (
        "¿Qué referencias visuales de otras marcas admira y qué es lo que le resulta atractivo de ellas?",
        BriefCategory.BRANDING,
    ),
    (
        "¿Qué colores y tipografías le gustaría utilizar y cuáles prefiere evitar?",
        BriefCategory.BRANDING,
    ),
    (
        "¿En qué aplicaciones prevé utilizar la identidad (papelería, digital, señalética, empaques)?",
        BriefCategory.BRANDING,
    ),
]

_INTERIOR_QUESTIONS: list[tuple[str, BriefCategory]] = [
    (
        "¿Cómo se utilizará cada espacio y qué actividades se desarrollarán en él?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Qué estilo y atmósfera desea crear en los espacios?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Qué referencias visuales de interiores le inspiran y por qué?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Qué paleta de colores y materiales prefiere y cuáles desea evitar?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Qué mobiliario existente desea conservar en la especificación de FF&E?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Cómo es la iluminación natural disponible y qué ambiente lumínico desea lograr?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Cuál es el presupuesto orientativo previsto para la especificación de FF&E?",
        BriefCategory.INTERIOR,
    ),
    (
        "¿Qué restricciones del inmueble conoce que debamos considerar como insumo de diseño?",
        BriefCategory.INTERIOR,
    ),
]

_GENERAL_QUESTIONS: list[tuple[str, BriefCategory]] = [
    (
        "¿Cuáles son los plazos y fechas clave del proyecto que debemos considerar?",
        BriefCategory.GENERAL,
    ),
]

_INTEGRAL_GENERAL_QUESTIONS: list[tuple[str, BriefCategory]] = [
    (
        "¿Cómo debe reflejarse la personalidad de la marca en la experiencia de los espacios?",
        BriefCategory.GENERAL,
    ),
    (
        "¿Cuáles son las prioridades del proyecto y qué aspectos son innegociables para usted?",
        BriefCategory.GENERAL,
    ),
]

BRIEF_TEMPLATES: dict[ServiceType, list[tuple[str, BriefCategory]]] = {
    ServiceType.BRANDING: _BRANDING_QUESTIONS + _GENERAL_QUESTIONS,
    ServiceType.INTERIOR: _INTERIOR_QUESTIONS + _GENERAL_QUESTIONS,
    ServiceType.INTEGRAL: (
        _BRANDING_QUESTIONS
        + _INTERIOR_QUESTIONS
        + _GENERAL_QUESTIONS
        + _INTEGRAL_GENERAL_QUESTIONS
    ),
}


async def seed_brief_from_template(
    db: AsyncSession,
    project: Project,
    actor_user_id: UUID,
) -> list[BriefItem]:
    """Seed the project's brief questions for its service scope.

    Adds the items to the session with ``db.add_all`` but does not commit;
    the caller owns the transaction. Idempotent: projects that already have
    brief questions are left untouched and an empty list is returned.
    """
    existing = await db.execute(
        select(BriefItem.id)
        .where(
            BriefItem.project_id == project.id,
            BriefItem.item_type == BriefItemType.QUESTION,
        )
        .limit(1)
    )
    if existing.first() is not None:
        return []

    template = BRIEF_TEMPLATES.get(project.scope_type) if project.scope_type else None
    if not template:
        return []

    items = [
        BriefItem(
            project_id=project.id,
            item_type=BriefItemType.QUESTION,
            category=category,
            prompt=prompt,
            status=BriefStatus.PENDING,
            created_by=actor_user_id,
        )
        for prompt, category in template
    ]
    db.add_all(items)
    return items
