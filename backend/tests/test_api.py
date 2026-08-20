# backend/tests/test_api.py
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.db.models import UserRole
from tests.conftest import create_user, create_vm_row, login, auth_headers

def test_api_vm_endpoints(client: TestClient, db_session: Session):
    user = create_user(db_session, email="test@example.com", role=UserRole.admin)
    csrf = login(client, "test@example.com")
    
    vm = create_vm_row(db_session, user, name="api-test-vm")
    
    # Test list
    response = client.get("/api/vms", headers=auth_headers(csrf))
    assert response.status_code == 200
    assert len(response.json()["items"]) >= 1
    
    # Test get detail
    response = client.get(f"/api/vms/{vm.id}", headers=auth_headers(csrf))
    assert response.status_code == 200
    assert response.json()["name"] == "api-test-vm"
