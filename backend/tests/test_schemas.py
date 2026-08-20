import pytest
from pydantic import ValidationError

from app.schemas.vms import (
    VmCreate, VmUpdate, DiskCreate, NetworkCreate, ApplicationCreate,
    VmBulkFilters, VmBulkUpdate, VmBulkRequest
)
from app.schemas.users import UserCreate
from app.schemas.auth import LoginRequest, SetupAdminRequest

def test_vm_create_schema():
    # Valid VmCreate
    vm = VmCreate(
        name="test-vm",
        platform="proxmox",
        status="running",
        criticality="low",
        cluster="test-cluster",
        cpu_cores=4,
        memory_mb=1024,
        disks=[DiskCreate(disk_name="d1", size_gb=10)],
        networks=[NetworkCreate(ip_address="192.168.1.1")]
    )
    assert vm.name == "test-vm"
    assert len(vm.disks) == 1
    assert vm.networks[0].ip_address == "192.168.1.1"

    # Invalid (missing required fields)
    with pytest.raises(ValidationError):
        VmCreate(name="test-vm")

def test_vm_bulk_request():
    # Valid
    req = VmBulkRequest(
        ids=["550e8400-e29b-41d4-a716-446655440000"],
        patch=VmBulkUpdate(status="running")
    )
    assert req.ids is not None
    
    # Invalid (missing targets)
    with pytest.raises(ValidationError):
        VmBulkRequest(patch=VmBulkUpdate(status="running"))

def test_user_schema_validation():
    # Valid
    user = UserCreate(email="test@example.com", password="password123", role="viewer")
    assert user.email == "test@example.com"

    # Invalid (invalid email)
    with pytest.raises(ValidationError):
        UserCreate(email="not-an-email", password="password123", role="viewer")

from app.schemas.clusters import PhysicalNodeCreate, PhysicalClusterCreate
from app.schemas.storage import LunCreate, VolumeCreate, ArrayCreate

def test_cluster_schemas():
    node = PhysicalNodeCreate(name="node1", ip_addresses=[{"label": "mgmt", "address": "10.0.0.1"}])
    assert node.name == "node1"
    
    cluster = PhysicalClusterCreate(name="cluster1")
    assert cluster.name == "cluster1"

def test_storage_schemas():
    lun = LunCreate(name="lun1")
    assert lun.name == "lun1"
    
    vol = VolumeCreate(name="vol1")
    assert vol.name == "vol1"
    
    arr = ArrayCreate(name="arr1", vendor="synology")
    assert arr.name == "arr1"

from app.schemas.ldap import LdapConfigUpdate
from app.schemas.notifications import DuplicateIpRead
from app.schemas.preferences import AccentPreference
from app.schemas.settings import AppSettingsUpdate

def test_settings_and_config():
    # LDAP config
    ldap = LdapConfigUpdate(enabled=True, server_uri="ldap://localhost", user_base_dn="ou=users,dc=test")
    assert ldap.enabled is True
    
    # Settings update
    cfg = AppSettingsUpdate(decommission_notify_days=30)
    assert cfg.decommission_notify_days == 30

def test_notifications_pref():
    # Preference
    pref = AccentPreference(accent="blue")
    assert pref.accent == "blue"
    
    # Notifications
    notif = DuplicateIpRead(ip_address="1.1.1.1", occurrences=2, vms=[])
    assert notif.ip_address == "1.1.1.1"
