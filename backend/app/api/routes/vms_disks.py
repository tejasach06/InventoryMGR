from app.db.models import VmDisk
from app.schemas.vms import DiskCreate, DiskRead, DiskUpdate
from app.services.vms import get_vm_or_404, recompute_health

from ._child_crud import make_child_router

router = make_child_router(
    model=VmDisk,
    create_schema=DiskCreate,
    update_schema=DiskUpdate,
    read_schema=DiskRead,
    order_col=VmDisk.sort_order,
    fk_attr="vm_id",
    parent_check=lambda db, pid: get_vm_or_404(db, pid),
    not_found_detail="Disk not found",
    after_change=recompute_health,
)
