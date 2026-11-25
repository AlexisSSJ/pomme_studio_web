"""Aggregated router for API version 1."""

from fastapi import APIRouter

from .endpoints import admin_audit, admin_leads, admin_pricing, admin_projects, admin_users, assets, auth, brief, deliverables, health, leads, moodboard, notifications, project_meetings, projects, specifications, stages

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(leads.router, prefix="/leads", tags=["leads"])
api_router.include_router(admin_users.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_pricing.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_leads.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_audit.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_projects.router, prefix="/admin", tags=["admin"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(
    brief.router,
    prefix="/projects/{project_id}/brief",
    tags=["brief"],
)
api_router.include_router(
    brief.client_brief_router,
    prefix="/brief",
    tags=["brief"],
)
api_router.include_router(
    brief.client_brief_router,
    prefix="/projects/brief",
    tags=["brief"],
)
api_router.include_router(
    moodboard.router,
    prefix="/projects/{project_id}/moodboard",
    tags=["moodboard"],
)
api_router.include_router(
    stages.router,
    prefix="/projects/{project_id}/stages",
    tags=["stages"],
)
api_router.include_router(
    deliverables.router,
    prefix="/projects/{project_id}/deliverables",
    tags=["deliverables"],
)
api_router.include_router(
    project_meetings.router,
    prefix="/projects/{project_id}/meetings",
    tags=["meetings"],
)
api_router.include_router(
    specifications.router,
    prefix="/projects/{project_id}/specifications",
    tags=["specifications"],
)
api_router.include_router(
    assets.router,
    prefix="/projects/{project_id}/assets",
    tags=["assets"],
)
