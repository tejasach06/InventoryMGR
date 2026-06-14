from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, imports, mempalace, users, vms
from app.core.config import get_settings, validate_production_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    validate_production_settings(settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="InventoryMGR API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(users.router, prefix="/api/users", tags=["users"])
    app.include_router(vms.router, prefix="/api/vms", tags=["vms"])
    app.include_router(imports.router, prefix="/api/imports", tags=["imports"])
    app.include_router(mempalace.router, prefix="/api/mempalace", tags=["mempalace"])
    return app


app = create_app()
