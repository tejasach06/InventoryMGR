import pytest
from pydantic import ValidationError

from app.schemas.clusters import NodeIpAddress, PhysicalNodeCreate


def test_node_ip_address_requires_label_and_address():
    ip = NodeIpAddress(label="mgmt", address="10.0.1.5")
    assert ip.label == "mgmt" and ip.address == "10.0.1.5"
    with pytest.raises(ValidationError):
        NodeIpAddress(label="", address="10.0.1.5")


def test_node_create_defaults():
    n = PhysicalNodeCreate(name="node-01")
    assert n.cpu_cores == 0 and n.cpu_threads == 0 and n.ram_total_gb == 0
    assert n.storage_usable_gb == 0 and n.ram_used_gb is None and n.ip_addresses == []


def test_node_create_rejects_negative_cores():
    with pytest.raises(ValidationError):
        PhysicalNodeCreate(name="node-01", cpu_cores=-1)