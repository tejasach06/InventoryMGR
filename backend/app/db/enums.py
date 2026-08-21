from enum import StrEnum

from sqlalchemy import Enum


class UserRole(StrEnum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class Platform(StrEnum):
    proxmox = "proxmox"
    vmware = "vmware"


class VmStatus(StrEnum):
    running = "running"
    powered_off = "powered_off"
    decommissioned = "decommissioned"
    unknown = "unknown"


class Environment(StrEnum):
    production = "production"
    development = "development"
    testing = "testing"
    uat = "uat"
    dr = "dr"
    staging = "staging"
    sandbox = "sandbox"


class Criticality(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class VmType(StrEnum):
    permanent = "permanent"
    temporary = "temporary"


class OsFamily(StrEnum):
    linux = "linux"
    windows = "windows"


os_family_enum = Enum(OsFamily, name="os_family")


class ImportStatus(StrEnum):
    previewed = "previewed"
    committed = "committed"
    cancelled = "cancelled"


class NetworkRole(StrEnum):
    private = "private"
    public = "public"
    backup = "backup"


class ImportAction(StrEnum):
    create = "create"
    update = "update"
    unchanged = "unchanged"
    decommission = "decommission"
    conflict = "conflict"
    invalid = "invalid"


class DropdownCategory(StrEnum):
    cpu = "cpu"
    datacenter = "datacenter"
    disk = "disk"
    os = "os"
    cluster = "cluster"


class StorageVendor(StrEnum):
    synology = "synology"
    netapp = "netapp"
