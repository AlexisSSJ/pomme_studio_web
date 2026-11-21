"""Aggregated router for API version 1."""

from fastapi import APIRouter

from .endpoints import admin_audit, admin_leads, admin_pricing, admin_projects, admin_users, auth, brief, health, leads, projects

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
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
