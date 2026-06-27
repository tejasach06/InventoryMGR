from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, imports, users, vms
from app.api.routes.audit import router as audit_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.reports import router as reports_router
from app.api.routes.settings import router as settings_router
from app.api.routes.vms_applications import router as vms_applications_router
from app.api.routes.vms_attachments import router as vms_attachments_router
from app.api.routes.vms_disks import router as vms_disks_router
from app.api.routes.vms_networks import router as vms_networks_router
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
    app.include_router(vms_disks_router, prefix="/api/vms/{vm_id}/disks", tags=["vms"])
    app.include_router(vms_networks_router, prefix="/api/vms/{vm_id}/networks", tags=["vms"])
    app.include_router(vms_applications_router, prefix="/api/vms/{vm_id}/applications", tags=["vms"])
    app.include_router(vms_attachments_router, prefix="/api/vms/{vm_id}/attachments", tags=["vms"])
    app.include_router(audit_router, prefix="/api/vms/{vm_id}/audit", tags=["audit"])
    app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
    app.include_router(reports_router, prefix="/api/reports", tags=["reports"])
    app.include_router(imports.router, prefix="/api/imports", tags=["imports"])
    app.include_router(settings_router, prefix="/api/settings", tags=["settings"])

    return app


app = create_app()
