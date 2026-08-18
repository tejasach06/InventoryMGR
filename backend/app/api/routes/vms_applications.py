from app.db.models import VmApplication
from app.schemas.vms import ApplicationCreate, ApplicationRead, ApplicationUpdate
from app.services.vms import get_vm_or_404, recompute_health

from ._child_crud import make_child_router

router = make_child_router(
    model=VmApplication,
    create_schema=ApplicationCreate,
    update_schema=ApplicationUpdate,
    read_schema=ApplicationRead,
    order_col=VmApplication.app_name,
    fk_attr="vm_id",
    parent_check=lambda db, pid: get_vm_or_404(db, pid),
    not_found_detail="Application not found",
    conflict_detail="Application already linked to this VM",
    after_change=recompute_health,
)
