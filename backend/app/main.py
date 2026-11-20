"""Pomme Studio API entry point (`uvicorn app.main:app`)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.router import api_router
from .core.config import API_V1_PREFIX, settings

PROJECT_NAME = "Pomme Studio API"
VERSION = "0.1.0"


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title=PROJECT_NAME,
        version=VERSION,
        description=(
            "Backend for Pomme Studio: branding and interior design studio "
            "operations (design, creative direction, executive documentation "
            "and FF&E specifications)."
        ),
        # Interactive docs are a development aid only.
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        openapi_url="/openapi.json" if settings.DEBUG else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=API_V1_PREFIX)

    @app.get("/", tags=["meta"])
    async def root() -> dict[str, str]:
        """Return basic service metadata and the health-check URL."""
        return {
            "name": PROJECT_NAME,
            "version": VERSION,
            "health": f"{API_V1_PREFIX}/health",
        }

    return app


app = create_app()
