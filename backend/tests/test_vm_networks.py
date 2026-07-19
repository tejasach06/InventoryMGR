from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import NetworkRole, UserRole, VmNetwork
from tests.conftest import create_user, create_vm_row


def test_network_defaults_to_private_role(db_session: Session) -> None:
    """Roles backfill and default to private, so pre-role rows stay meaningful."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Roled VM", external_id=None)
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", sort_order=0))
    db_session.commit()

    network = db_session.scalar(select(VmNetwork).where(VmNetwork.vm_id == vm.id))
    assert network is not None
    assert network.role == NetworkRole.private
