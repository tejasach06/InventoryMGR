from app.db.models import VmApplication
from app.schemas.vms import ApplicationCreate, ApplicationRead, ApplicationUpdate

from ._vm_subrouter import make_vm_subrouter

router = make_vm_subrouter(
    model=VmApplication,
    create_schema=ApplicationCreate,
    update_schema=ApplicationUpdate,
    read_schema=ApplicationRead,
    order_col=VmApplication.app_name,
    not_found_detail="Application not found",
    conflict_detail="Application already linked to this VM",
)
