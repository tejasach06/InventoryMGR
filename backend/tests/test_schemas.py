# backend/tests/test_schemas.py
import pytest
from pydantic import ValidationError
from app.schemas.vms import VmCreate
from app.schemas.users import UserCreate

def test_vm_schema_validation():
    # Valid
    vm = VmCreate(
        name="test-vm", 
        platform="proxmox", 
        status="running", 
        criticality="low",
        cluster="test-cluster",
        cpu_cores=4,
        memory_mb=1024
    )
    assert vm.name == "test-vm"
    
    # Invalid (missing required fields)
    with pytest.raises(ValidationError):
        VmCreate(name="test-vm")

def test_user_schema_validation():
    # Valid
    user = UserCreate(email="test@example.com", password="password123", role="viewer")
    assert user.email == "test@example.com"
    
    # Invalid (invalid email)
    with pytest.raises(ValidationError):
        UserCreate(email="not-an-email", password="password123", role="viewer")
