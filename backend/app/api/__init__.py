from fastapi import APIRouter

from app.api.routes import (
    audit,
    auth,
    clusters,
    dashboard,
    imports,
    notifications,
    preferences,
    reports,
    settings,
    storage,
    users,
    vms,
    vms_applications,
    vms_disks,
    vms_networks,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(vms.router, prefix="/vms", tags=["vms"])
api_router.include_router(vms_disks.router, prefix="/vms/{parent_id}/disks", tags=["vms"])
api_router.include_router(vms_networks.router, prefix="/vms/{parent_id}/networks", tags=["vms"])
api_router.include_router(
    vms_applications.router, prefix="/vms/{parent_id}/applications", tags=["vms"]
)
api_router.include_router(audit.router, prefix="/vms/{vm_id}/audit", tags=["audit"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(imports.router, prefix="/imports", tags=["imports"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(storage.router, prefix="/storage", tags=["storage"])
api_router.include_router(
    storage.volumes_router, prefix="/storage/arrays/{parent_id}/volumes", tags=["storage"]
)
api_router.include_router(
    storage.luns_router, prefix="/storage/volumes/{parent_id}/luns", tags=["storage"]
)
api_router.include_router(
    storage.shares_router, prefix="/storage/volumes/{parent_id}/shares", tags=["storage"]
)
api_router.include_router(clusters.router, prefix="/clusters", tags=["clusters"])
api_router.include_router(
    clusters.nodes_router, prefix="/clusters/{parent_id}/nodes", tags=["clusters"]
)
api_router.include_router(preferences.router, prefix="/user", tags=["user"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
