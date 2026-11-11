import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.clusters import PhysicalClusterCreate, PhysicalNodeCreate
from app.schemas.ldap import LdapConfigUpdate
from app.schemas.notifications import DuplicateIpRead
from app.schemas.preferences import AccentPreference
from app.schemas.settings import AppSettingsUpdate
from app.schemas.storage import ArrayCreate, LunCreate, VolumeCreate
from app.schemas.users import UserCreate
from app.schemas.vms import (
    VmBulkFilters,
    DiskCreate,
    NetworkCreate,
    VmBulkRequest,
    VmBulkUpdate,
    VmCreate,
    VmRead,
    VmUpdate,
)

from .conftest import create_user, create_vm_row


VM_REQUIRED_FIELDS = {
    "name": "status-vm",
    "platform": "proxmox",
    "cluster": "test-cluster",
    "cpu_cores": 2,
    "memory_mb": 1024,
    "criticality": "low",
}


@pytest.mark.parametrize("status", ["running", "powered_off", "decommissioned"])
def test_vm_writable_statuses(status):
    assert VmCreate(**VM_REQUIRED_FIELDS, status=status).status == status
    assert VmUpdate(status=status).status == status
    assert VmBulkUpdate(status=status).status == status


@pytest.mark.parametrize("status", ["unknown", " UNKNOWN ", "", None])
def test_vm_writes_reject_invalid_status(status):
    for schema, fields in [
        (VmCreate, VM_REQUIRED_FIELDS),
        (VmUpdate, {}),
        (VmBulkUpdate, {}),
    ]:
        with pytest.raises(ValidationError):
            schema(**fields, status=status)


def test_vm_status_required_only_on_create():
    with pytest.raises(ValidationError) as exc_info:
        VmCreate(**VM_REQUIRED_FIELDS)
    assert exc_info.value.errors()[0]["loc"] == ("status",)
    assert VmUpdate(owner="ops").model_dump(exclude_unset=True) == {"owner": "ops"}
    assert VmBulkUpdate(owner="ops").model_dump(exclude_unset=True) == {"owner": "ops"}


def test_vm_read_and_filters_preserve_historical_unknown(db_session):
    user = create_user(db_session, email="historical-status@example.com")
    vm = create_vm_row(db_session, user, status="unknown", os_family=None)
    response = VmRead.model_validate(vm)
    assert response.model_dump(mode="json")["status"] == "unknown"
    assert response.os_family is None
    assert VmBulkFilters(status=["unknown"]).status == ["unknown"]


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


def test_vm_bulk_filters_os_family_validation():
    assert VmBulkFilters(os_family=["linux", "windows"]).os_family == ["linux", "windows"]
    assert VmBulkFilters(os_family=["undefined"]).os_family == ["undefined"]
    assert VmBulkFilters(os_family=["linux", "undefined"]).os_family == ["linux", "undefined"]

    with pytest.raises(ValidationError) as exc_info:
        VmBulkFilters(os_family=["bogus"])
    errors = exc_info.value.errors()
    assert len(errors) == 1
    assert errors[0]["type"] == "enum"


def test_os_family_query_filter_does_not_widen_saved_family():
    from app.api.routes.vms import VmFilterParams

    adapter = TypeAdapter(VmFilterParams)
    assert adapter.validate_python({"os_family": ["undefined"]}).os_family == ["undefined"]
    with pytest.raises(ValidationError):
        adapter.validate_python({"os_family": ["bogus"]})
    with pytest.raises(ValidationError):
        VmUpdate(os_family="undefined")
