from app.db.models import VmDisk
from app.schemas.vms import DiskCreate, DiskRead, DiskUpdate

from ._vm_subrouter import make_vm_subrouter

router = make_vm_subrouter(
    model=VmDisk,
    create_schema=DiskCreate,
    update_schema=DiskUpdate,
    read_schema=DiskRead,
    order_col=VmDisk.sort_order,
    not_found_detail="Disk not found",
)
