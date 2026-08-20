# backend/tests/test_db.py
from sqlalchemy.orm import Session

from app.db.models import User, UserRole
from tests.conftest import create_user, create_vm_row


def test_db_models(db_session: Session):
    # Verify user creation
    user = create_user(db_session, email="test@example.com", role=UserRole.admin)
    assert user.id is not None
    assert user.email == "test@example.com"
    
    # Verify VM creation
    vm = create_vm_row(db_session, user, name="db-test-vm")
    assert vm.id is not None
    assert vm.name == "db-test-vm"
    assert vm.created_by_id == user.id

def test_db_session_health(db_session: Session):
    # Just check if we can query the DB
    user_count = db_session.query(User).count()
    assert user_count >= 0
