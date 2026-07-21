from datetime import date

from app.db.models import AppSetting, DecommissionAck, UserRole
from tests.conftest import create_user, create_vm_row


def test_app_setting_and_ack_persist(db_session):
    db_session.add(AppSetting(key="decommission_notify_days", value="30"))
    db_session.commit()
    assert db_session.get(AppSetting, "decommission_notify_days").value == "30"

    user = create_user(db_session, email="a@example.com", role=UserRole.viewer)
    vm = create_vm_row(db_session, user, decommission_date=date(2026, 8, 1))
    ack = DecommissionAck(user_id=user.id, vm_id=vm.id, acked_date=date(2026, 8, 1))
    db_session.add(ack)
    db_session.commit()
    db_session.refresh(ack)
    assert ack.id is not None
