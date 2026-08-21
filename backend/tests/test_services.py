# backend/tests/test_services.py
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Platform, Vm, VmStatus
from app.services.vm_filters import apply_vm_filters
from app.services.vms import list_vms
from tests.conftest import create_user, create_vm_row


def test_vm_filters(db_session: Session):
    user = create_user(db_session, email="test@example.com")
    _vm1 = create_vm_row(db_session, user, name="vm1", platform=Platform.proxmox, status=VmStatus.running)
    _vm2 = create_vm_row(db_session, user, name="vm2", platform=Platform.vmware, status=VmStatus.powered_off)
    
    # Test platform filter
    stmt = apply_vm_filters(select(Vm), platform=[Platform.proxmox])
    results = db_session.scalars(stmt).all()
    assert len(results) == 1
    assert results[0].name == "vm1"

def test_list_vms(db_session: Session):
    user = create_user(db_session, email="test@example.com")
    create_vm_row(db_session, user, name="vm1")
    create_vm_row(db_session, user, name="vm2")
    
    # Test listing
    vms, total = list_vms(db_session, {}, limit=10, offset=0)
    assert total == 2
    assert len(vms) == 2
