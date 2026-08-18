from app.db.models import VmNetwork
from app.schemas.vms import NetworkCreate, NetworkRead, NetworkUpdate
from app.services.vms import get_vm_or_404, recompute_health

from ._child_crud import make_child_router

router = make_child_router(
    model=VmNetwork,
    create_schema=NetworkCreate,
    update_schema=NetworkUpdate,
    read_schema=NetworkRead,
    order_col=VmNetwork.sort_order,
    fk_attr="vm_id",
    parent_check=lambda db, pid: get_vm_or_404(db, pid),
    not_found_detail="Network entry not found",
    after_change=recompute_health,
)
