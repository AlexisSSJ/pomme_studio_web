"""Aggregated router for API version 1."""

from fastapi import APIRouter

from .endpoints import admin_audit, admin_pricing, admin_users, auth, health

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin_users.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_pricing.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_audit.router, prefix="/admin", tags=["admin"])
