from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from starlette.datastructures import MutableHeaders
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes import auth, imports, users, vms
from app.api.routes.audit import router as audit_router
from app.api.routes.auth import limiter as auth_limiter
from app.api.routes.clusters import nodes_router as cluster_nodes_router
from app.api.routes.clusters import router as clusters_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.preferences import router as preferences_router
from app.api.routes.reports import router as reports_router
from app.api.routes.settings import router as settings_router
from app.api.routes.storage import luns_router, shares_router, volumes_router
from app.api.routes.storage import router as storage_router
from app.api.routes.vms_applications import router as vms_applications_router
from app.api.routes.vms_disks import router as vms_disks_router
from app.api.routes.vms_networks import router as vms_networks_router
from app.core.config import get_settings, validate_production_settings


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_security_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["X-XSS-Protection"] = "0"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
            await send(message)

        await self.app(scope, receive, send_with_security_headers)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    validate_production_settings(settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="InventoryMGR API", lifespan=lifespan)
    app.state.limiter = auth_limiter
    app.add_exception_handler(429, cast(Any, _rate_limit_exceeded_handler))
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    @app.get("/api/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(users.router, prefix="/api/users", tags=["users"])
    app.include_router(vms.router, prefix="/api/vms", tags=["vms"])
    app.include_router(vms_disks_router, prefix="/api/vms/{parent_id}/disks", tags=["vms"])
    app.include_router(vms_networks_router, prefix="/api/vms/{parent_id}/networks", tags=["vms"])
    app.include_router(
        vms_applications_router, prefix="/api/vms/{parent_id}/applications", tags=["vms"]
    )
    app.include_router(audit_router, prefix="/api/vms/{vm_id}/audit", tags=["audit"])
    app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
    app.include_router(reports_router, prefix="/api/reports", tags=["reports"])
    app.include_router(imports.router, prefix="/api/imports", tags=["imports"])
    app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
    app.include_router(storage_router, prefix="/api/storage", tags=["storage"])
    app.include_router(
        volumes_router, prefix="/api/storage/arrays/{parent_id}/volumes", tags=["storage"]
    )
    app.include_router(
        luns_router, prefix="/api/storage/volumes/{parent_id}/luns", tags=["storage"]
    )
    app.include_router(
        shares_router, prefix="/api/storage/volumes/{parent_id}/shares", tags=["storage"]
    )
    app.include_router(clusters_router, prefix="/api/clusters", tags=["clusters"])
    app.include_router(
        cluster_nodes_router, prefix="/api/clusters/{parent_id}/nodes", tags=["clusters"]
    )
    app.include_router(preferences_router, prefix="/api/user", tags=["user"])
    app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])

    return app


app = create_app()
