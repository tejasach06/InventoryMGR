from app.db.models import VmNetwork
from app.schemas.vms import NetworkCreate, NetworkRead, NetworkUpdate

from ._vm_subrouter import make_vm_subrouter

router = make_vm_subrouter(
    model=VmNetwork,
    create_schema=NetworkCreate,
    update_schema=NetworkUpdate,
    read_schema=NetworkRead,
    order_col=VmNetwork.sort_order,
    not_found_detail="Network entry not found",
)
