import csv
import io
from datetime import date
from typing import Any

from fastapi import HTTPException, status

from app.core.ip_utils import normalize_ip
from app.db.models import NetworkRole
from app.schemas.vms import VmBase

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CSV_ROWS = 5000
REQUIRED_HEADERS_ORDER = ("name", "platform", "cluster")
REQUIRED_HEADERS = set(REQUIRED_HEADERS_ORDER)

# disks/networks are child collections expressed through CHILD_HEADERS instead.
EXCLUDED_FROM_CSV = {"disks", "networks"}
# One column per child type. Disks pair inline as name:size; IPs take their
# role from the column name. Both split on ";", matching tags.
# Order is load-bearing: an address repeated under two roles keeps the first
# listed here, not the first column in the CSV. Reordering changes precedence.
IP_ROLE_HEADERS = {
    "private_ip": NetworkRole.private,
    "public_ip": NetworkRole.public,
    "backup_ip": NetworkRole.backup,
}
DISK_DEFAULT_HEADERS = {"storage_name", "storage_type"}
CHILD_HEADERS = {"disks", "applications"} | set(IP_ROLE_HEADERS) | DISK_DEFAULT_HEADERS

OPTIONAL_HEADERS = (set(VmBase.model_fields) - EXCLUDED_FROM_CSV - REQUIRED_HEADERS) | CHILD_HEADERS
ALL_HEADERS = REQUIRED_HEADERS | OPTIONAL_HEADERS

# Downloadable template layout. Flat CSV has no real grouping, so the grouping
# is the column ORDER: identity, placement, classification, capacity, OS,
# network, ownership, operations, compliance dates, notes. Mirrors the export
# order in api/routes/vms.py::_EXPORT_SCALAR_COLS minus the derived columns
# (health_score, created_at, updated_at), which are not importable.
# tests/test_csv_imports.py asserts this covers ALL_HEADERS exactly, so a new
# VmBase field fails the suite until it is placed in a group here.
TEMPLATE_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("identity", ("name", "external_id", "fqdn", "sr_id")),
    ("placement", ("platform", "datacenter", "cluster", "node")),
    ("classification", ("status", "environment", "criticality", "vm_type")),
    ("capacity", ("cpu_cores", "memory_mb", "disks", "storage_name", "storage_type")),
    ("operating system", ("os_family", "os_distribution", "os_version")),
    ("network", ("private_ip", "public_ip", "backup_ip")),
    ("ownership", ("owner", "business_owner", "technical_owner", "applications")),
    (
        "operations",
        (
            "monitoring_enabled",
            "pmp_enabled",
            "ha_enabled",
            "backup_enabled",
            "backup_location",
            "tags",
        ),
    ),
    (
        "compliance dates",
        ("last_patch_date", "last_vuln_scan_date", "last_verified_at", "decommission_date"),
    ),
    ("notes", ("security_remarks", "description")),
)
TEMPLATE_COLUMNS: tuple[str, ...] = tuple(
    column for _, columns in TEMPLATE_GROUPS for column in columns
)

# Two rows a human can read as a worked example. They are valid importable
# rows (the suite previews them) so a user can also keep one and edit it.
# Names carry the SAMPLE- prefix and the descriptions say to delete them.
TEMPLATE_SAMPLE_ROWS: tuple[dict[str, str], ...] = (
    {
        "name": "SAMPLE-web-01",
        "external_id": "VM-1001",
        "fqdn": "web-01.corp.local",
        "sr_id": "SR-2481",
        "platform": "proxmox",
        "datacenter": "DC-Mumbai",
        "cluster": "pve-cluster-01",
        "node": "pve-node-03",
        "status": "running",
        "environment": "production",
        "criticality": "high",
        "vm_type": "permanent",
        "cpu_cores": "4",
        "memory_mb": "8192",
        "disks": "os:100;data:500",
        "storage_name": "SAMPLE-SAN-01",
        "storage_type": "ssd",
        "os_family": "linux",
        "os_distribution": "ubuntu",
        "os_version": "22.04",
        "private_ip": "10.20.30.41",
        "public_ip": "",
        "backup_ip": "",
        "owner": "infra-team",
        "business_owner": "Retail Ops",
        "technical_owner": "A. Sharma",
        "applications": "nginx:web-team;postgres:dba-team",
        "monitoring_enabled": "true",
        "pmp_enabled": "true",
        "ha_enabled": "true",
        "backup_enabled": "true",
        "backup_location": "Veeam-Repo-01",
        "tags": "web;tier1",
        "last_patch_date": "2026-07-14",
        "last_vuln_scan_date": "2026-07-01",
        "last_verified_at": "2026-07-20",
        "decommission_date": "",
        "security_remarks": "",
        "description": "Sample row - delete before importing",
    },
    {
        "name": "SAMPLE-test-02",
        "external_id": "VM-1002",
        "fqdn": "test-02.corp.local",
        "sr_id": "SR-2492",
        "platform": "vmware",
        "datacenter": "DC-Pune",
        "cluster": "vc-cluster-02",
        "node": "esxi-node-11",
        "status": "powered_off",
        "environment": "testing",
        "criticality": "low",
        "vm_type": "temporary",
        "cpu_cores": "2",
        "memory_mb": "4096",
        "disks": "os:60",
        "storage_name": "",
        "storage_type": "",
        "os_family": "windows",
        "os_distribution": "",
        "os_version": "2022",
        "private_ip": "10.20.31.52",
        "public_ip": "",
        "backup_ip": "",
        "owner": "qa-team",
        "business_owner": "QA",
        "technical_owner": "R. Iyer",
        "applications": "iis",
        "monitoring_enabled": "false",
        "pmp_enabled": "false",
        "ha_enabled": "false",
        "backup_enabled": "false",
        "backup_location": "",
        "tags": "sandbox",
        "last_patch_date": "2026-06-02",
        "last_vuln_scan_date": "",
        "last_verified_at": "",
        "decommission_date": "2026-09-30",
        "security_remarks": "",
        "description": "Sample row - delete before importing",
    },
)

PLATFORM_ALIASES = {
    "proxmox": "proxmox",
    "pve": "proxmox",
    "vmware": "vmware",
    "vsphere": "vmware",
    "vcenter": "vmware",
}
ENUM_VALUES = {
    "status": {"running", "powered_off", "decommissioned", "unknown"},
    "environment": {"production", "development", "testing", "uat", "dr", "staging", "sandbox"},
    "criticality": {"low", "medium", "high", "critical"},
    "os_family": {"linux", "windows"},
    "vm_type": {"permanent", "temporary"},
}
DEFAULTS: dict[str, Any] = {
    "status": "unknown",
    "environment": "production",
    "cpu_cores": 0,
    "memory_mb": 0,
    "criticality": "medium",
    "monitoring_enabled": False,
    "ha_enabled": False,
    "backup_enabled": False,
    "pmp_enabled": False,
    "tags": [],
    "os_family": None,
}


def _error(field: str, message: str) -> dict[str, str]:
    return {"field": field, "message": message}


def _clean_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        str(key).strip(): "" if value is None else str(value).strip()
        for key, value in row.items()
        if key is not None
    }


def _parse_int(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> int | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    try:
        value = int(raw)
    except ValueError:
        errors.append(_error(field, "must be an integer >= 0"))
        return None
    if value < 0:
        errors.append(_error(field, "must be an integer >= 0"))
        return None
    return value


def _parse_bool(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> bool | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    lowered = raw.lower()
    if lowered in {"true", "yes", "1"}:
        return True
    if lowered in {"false", "no", "0"}:
        return False
    errors.append(_error(field, "must be one of true, false, yes, no, 1, 0"))
    return None


def _parse_list(row: dict[str, str], field: str) -> list[str] | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    return [part.strip() for part in raw.split(";") if part.strip()]


def _parse_int_list(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> list[int]:
    raw = row.get(field, "")
    if raw == "":
        return []
    result: list[int] = []
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        try:
            value = int(cleaned)
        except ValueError:
            errors.append(_error(field, "must be integers >= 0 separated by ;"))
            return []
        if value < 0:
            errors.append(_error(field, "must be integers >= 0 separated by ;"))
            return []
        result.append(value)
    return result


def _parse_disks(
    row: dict[str, str], field: str = "disks", errors: list[dict[str, str]] | None = None
) -> list[tuple[str, int, str | None, str | None]]:
    """Parse disks with optional row-level storage fallbacks into disk tuples.

    Returns [] for a blank cell, so a blank supplies nothing and the skip
    semantics hold. `errors` is optional because the classification and attach
    call sites re-parse a cell normalize_csv_row already proved valid.
    """
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    default_storage_name = str(row.get("storage_name") or "").strip() or None
    default_storage_type = str(row.get("storage_type") or "").strip() or None
    disks: list[tuple[str, int, str | None, str | None]] = []
    seen: set[str] = set()
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        fields = [segment.strip() for segment in cleaned.split(":")]
        if len(fields) < 2 or len(fields) > 4 or not fields[0] or not fields[1].isdigit():
            if errors is not None:
                errors.append(
                    _error(field, "must be name:size[:storage_name[:storage_type]] separated by ;")
                )
            return []
        name, size = fields[0], int(fields[1])
        storage_name = (fields[2] or None if len(fields) > 2 else None) or default_storage_name
        storage_type = (fields[3] or None if len(fields) > 3 else None) or default_storage_type
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        disks.append((name, size, storage_name, storage_type))
    return disks




def _parse_ips(
    row: dict[str, str], field: str, errors: list[dict[str, str]] | None = None
) -> list[str]:
    """Parse a semicolon-separated IP address cell."""
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    entries: list[str] = []
    for part in raw.split(";"):
        cleaned = normalize_ip(part)
        if not cleaned:
            continue
        if ":" in cleaned:
            if errors is not None:
                errors.append(_error(field, "must be IP addresses separated by ;"))
            return []
        entries.append(cleaned)
    return entries


def _parse_applications(
    row: dict[str, str], field: str = "applications", errors: list[dict[str, str]] | None = None
) -> list[tuple[str, str | None]]:
    """Parse a `name:owner;name` cell into (app_name, app_owner) pairs.

    Owner is optional. Duplicate names inside one cell collapse to the first,
    matching the uq_vm_applications_vm_app constraint.
    """
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    pairs: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        name, _, owner = cleaned.partition(":")
        name, owner = name.strip(), owner.strip()
        if not name:
            if errors is not None:
                errors.append(_error(field, "must be name or name:owner entries separated by ;"))
            return []
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        pairs.append((name, owner or None))
    return pairs


def _parse_date(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> str | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        errors.append(_error(field, "must be ISO date YYYY-MM-DD"))
        return None


STRING_HEADERS = (
    "external_id",
    "fqdn",
    "description",
    "datacenter",
    "node",
    "sr_id",
    "os_distribution",
    "os_version",
    "owner",
    "business_owner",
    "technical_owner",
    "security_remarks",
    "backup_location",
)
ENUM_HEADERS = ("status", "environment", "criticality", "os_family", "vm_type")
INT_HEADERS = ("cpu_cores", "memory_mb")
BOOL_HEADERS = ("monitoring_enabled", "ha_enabled", "backup_enabled", "pmp_enabled")
DATE_HEADERS = (
    "last_patch_date",
    "last_vuln_scan_date",
    "decommission_date",
    "last_verified_at",
)
LIST_HEADERS = ("tags",)


def normalize_csv_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    """Normalize one CSV row into supplied values only.

    A value is supplied when its cell is non-blank. An absent column and a
    blank cell are equivalent and both mean "leave this field alone" — the
    caller decides whether to fall back to DEFAULTS (create) or to omit the
    key entirely (update).
    """
    clean = _clean_row(row)
    errors: list[dict[str, str]] = []
    normalized: dict[str, Any] = {}

    for field in REQUIRED_HEADERS:
        value = clean.get(field, "")
        if value == "":
            errors.append(_error(field, "is required and cannot be blank"))
        normalized[field] = value

    platform_raw = clean.get("platform", "").lower()
    if platform_raw:
        platform = PLATFORM_ALIASES.get(platform_raw)
        if platform is None:
            errors.append(
                _error("platform", "must be one of proxmox, pve, vmware, vsphere, vcenter")
            )
        else:
            normalized["platform"] = platform

    for field in STRING_HEADERS:
        value = clean.get(field, "")
        if value:
            normalized[field] = value

    for field in ENUM_HEADERS:
        value = clean.get(field, "").lower()
        if not value:
            continue
        if value not in ENUM_VALUES[field]:
            errors.append(_error(field, f"must be one of {', '.join(sorted(ENUM_VALUES[field]))}"))
        else:
            normalized[field] = value

    for field in INT_HEADERS:
        number = _parse_int(clean, field, errors)
        if number is not None:
            normalized[field] = number

    for field in BOOL_HEADERS:
        flag = _parse_bool(clean, field, errors)
        if flag is not None:
            normalized[field] = flag

    for field in LIST_HEADERS:
        items = _parse_list(clean, field)
        if items is not None:
            normalized[field] = items

    # Validation only. Child values stay in `raw` — `normalized` feeds
    # VmUpdate.model_validate, which would reject a `disks` key.
    _parse_disks(clean, "disks", errors)
    _parse_applications(clean, "applications", errors)
    for header in IP_ROLE_HEADERS:
        _parse_ips(clean, header, errors)

    for field in DATE_HEADERS:
        stamp = _parse_date(clean, field, errors)
        if stamp is not None:
            normalized[field] = stamp

    if errors:
        return None, errors
    return normalized, []


def identity_key(normalized: dict[str, Any]) -> tuple[Any, ...]:
    platform = normalized["platform"]
    name = normalized["name"].lower()
    cluster = normalized["cluster"].lower()
    if platform == "proxmox":
        return ("proxmox", normalized.get("external_id"), name, cluster)
    return ("vmware", name, cluster)


def parse_csv_bytes(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CSV must be UTF-8 encoded"
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")
    headers = {header.strip() for header in reader.fieldnames if header}
    missing = sorted(REQUIRED_HEADERS - headers)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSV missing required headers: {', '.join(missing)}",
        )
    ignored = sorted(headers - ALL_HEADERS)
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")
    if len(rows) > MAX_CSV_ROWS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CSV row count exceeds 5000"
        )
    return rows, ignored
