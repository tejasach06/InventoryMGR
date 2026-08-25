import csv
import io
import uuid
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.ip_utils import normalize_ip
from app.db.models import (
    AuditLog,
    CsvImportBatch,
    CsvImportRow,
    ImportAction,
    ImportStatus,
    NetworkRole,
    Platform,
    StorageArray,
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    VmStatus,
    compute_health_score,
)
from app.schemas.vms import VmBase, VmCreate, VmUpdate
from app.services.vm_mutations import create_vm, update_vm

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

# Human-curated columns: on an update row, CSV values may only gap-fill an empty
# field, never overwrite an existing value.
PROTECTED_HEADERS: frozenset[str] = frozenset({
    "owner",
    "business_owner",
    "technical_owner",
    "monitoring_enabled",
    "pmp_enabled",
    "backup_location",
    "criticality",
    "environment",
    "vm_type",
    "sr_id",
    "last_patch_date",
    "last_vuln_scan_date",
    "last_verified_at",
    "security_remarks",
})
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


def find_matching_vm(db: Session, normalized: dict[str, Any]) -> Vm | None:
    platform = Platform(normalized["platform"])
    name = normalized["name"].lower()
    cluster = normalized["cluster"].lower()
    conditions = [
        Vm.platform == platform,
        func.lower(Vm.name) == name,
        func.lower(Vm.cluster) == cluster,
    ]
    if platform == Platform.proxmox:
        external_id = normalized.get("external_id")
        conditions.append(
            Vm.external_id.is_(None) if external_id is None else Vm.external_id == external_id
        )
    return db.scalar(select(Vm).where(*conditions))


def _storage_warnings(db: Session, raw: dict[str, Any]) -> list[dict[str, str]]:
    """Flag effective disk storage names that match no storage_arrays row."""
    clean = _clean_row(raw)
    names: list[str] = []
    seen: set[str] = set()
    for _disk, _size, storage_name, _storage_type in _parse_disks(clean):
        if storage_name and storage_name.lower() not in seen:
            seen.add(storage_name.lower())
            names.append(storage_name)
    if not names:
        return []
    known = {
        name.lower()
        for name in db.scalars(
            select(StorageArray.name).where(func.lower(StorageArray.name).in_(seen))
        )
    }
    return [
        _error("storage_name", f"no storage array named '{name}' exists")
        for name in names
        if name.lower() not in known
    ]


def _decommission_candidates(
    db: Session, matched_vm_ids: set[uuid.UUID], scopes: set[tuple[str, str]]
) -> list[Vm]:
    """Non-decommissioned VMs absent from a full-inventory CSV, restricted to
    the (cluster, platform) pairs the CSV covers."""
    stmt = select(Vm).where(Vm.status != VmStatus.decommissioned).order_by(Vm.name.asc())
    return [
        vm
        for vm in db.scalars(stmt)
        if vm.id not in matched_vm_ids
        and ((vm.cluster or "").strip().lower(), vm.platform.value) in scopes
    ]


def create_preview_batch(
    db: Session, *, filename: str, content: bytes, user: User, full_inventory: bool = False
) -> CsvImportBatch:
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file exceeds 5 MiB"
        )
    rows, ignored_columns = parse_csv_bytes(content)
    batch = CsvImportBatch(
        filename=filename,
        created_by_id=user.id,
        status=ImportStatus.previewed,
        summary={},
        ignored_columns=ignored_columns,
        full_inventory=full_inventory,
    )
    db.add(batch)
    db.flush()

    seen: set[tuple[str, ...]] = set()
    summary = {
        "create": 0,
        "update": 0,
        "unchanged": 0,
        "conflict": 0,
        "invalid": 0,
        "decommission": 0,
    }
    matched_vm_ids: set[uuid.UUID] = set()
    scopes: set[tuple[str, str]] = set()
    field_changes: dict[str, int] = {}
    for idx, raw in enumerate(rows, start=2):
        normalized, errors = normalize_csv_row(raw)
        action = ImportAction.invalid
        target_vm_id: uuid.UUID | None = None
        changes: dict[str, list[Any]] = {}
        warnings = _storage_warnings(db, raw) if normalized is not None else []
        if normalized is not None:
            key = identity_key(normalized)
            if key in seen:
                action = ImportAction.conflict
                errors = [_error("identity", "duplicate CSV identity")]
            else:
                seen.add(key)
                scopes.add(
                    (
                        (normalized.get("cluster") or "").strip().lower(),
                        str(normalized.get("platform") or ""),
                    )
                )
                match = find_matching_vm(db, normalized)
                if match is None:
                    action = ImportAction.create
                else:
                    target_vm_id = match.id
                    matched_vm_ids.add(match.id)
                    changes = diff_against_vm(normalized, match, raw)
                    action = ImportAction.update if changes else ImportAction.unchanged
                    for field in changes:
                        field_changes[field] = field_changes.get(field, 0) + 1
        summary[action.value] += 1
        db.add(
            CsvImportRow(
                batch_id=batch.id,
                row_number=idx,
                raw=_clean_row(raw),
                normalized=normalized,
                action=action,
                target_vm_id=target_vm_id,
                errors=errors,
                warnings=warnings,
                changes=changes,
            )
        )
    if full_inventory:
        candidates = _decommission_candidates(db, matched_vm_ids, scopes)
        next_row = len(rows) + 2
        for offset, vm in enumerate(candidates):
            db.add(
                CsvImportRow(
                    batch_id=batch.id,
                    row_number=next_row + offset,
                    raw={"name": vm.name, "cluster": vm.cluster, "platform": vm.platform.value},
                    normalized=None,
                    action=ImportAction.decommission,
                    target_vm_id=vm.id,
                    errors=[],
                    warnings=[],
                    changes={"status": [vm.status.value, VmStatus.decommissioned.value]},
                )
            )
        summary["decommission"] = len(candidates)
        summary["decommission_candidate_total"] = len(candidates) + len(matched_vm_ids)
    batch.summary = summary
    batch.field_changes = field_changes
    db.commit()
    return load_batch_or_404(db, batch.id, user)


def _plan_ip_changes(
    vm: Vm, clean: dict[str, str], header: str, claimed: set[str]
) -> tuple[list[tuple[VmNetwork, str]], list[str]]:
    """(rows to retarget, addresses to insert) for one IP column.

    Positional: the cell's new addresses reuse this role's rows that the cell
    no longer mentions, in sort_order. Surplus rows are left untouched — a
    partial import never deletes an IP.
    """
    role = IP_ROLE_HEADERS[header]
    # ordered dedup of mentioned addresses
    mentioned_list = _parse_ips(clean, header)
    mentioned: list[str] = []
    for a in mentioned_list:
        if a not in mentioned:
            mentioned.append(a)

    role_rows = sorted(
        [n for n in vm.networks if n.role == role],
        key=lambda n: (n.sort_order, str(n.id)),
    )
    role_addrs = {n.ip_address for n in role_rows}
    new_addrs = [a for a in mentioned if a not in role_addrs and a not in claimed]
    reusable = [n for n in role_rows if n.ip_address not in mentioned]

    retarget_count = min(len(new_addrs), len(reusable))
    retargets = list(zip(reusable[:retarget_count], new_addrs[:retarget_count], strict=False))
    inserts = new_addrs[retarget_count:]

    for _, a in retargets:
        claimed.add(a)
    for a in inserts:
        claimed.add(a)

    return retargets, inserts

def _vm_field_is_set(vm: Vm, field: str) -> bool:
    """Whether the VM already holds a curated value for `field`.

    False for a boolean is treated as unset, so a CSV may still turn a flag on
    but never off.
    """
    value = getattr(vm, field)
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip() != ""
    return True


def applicable_updates(normalized: dict[str, Any], vm: Vm) -> dict[str, Any]:
    """`normalized` minus protected columns the VM already has a value for.

    Human-maintained columns (ownership, monitoring/PMP, criticality, compliance
    dates) are gap-filled only: the extraction script that generates the CSV has
    no authority over them, so it may fill a blank but never overwrite.
    """
    return {
        field: value
        for field, value in normalized.items()
        if field not in PROTECTED_HEADERS or not _vm_field_is_set(vm, field)
    }


def diff_against_vm(
    normalized: dict[str, Any], vm: Vm, raw: dict[str, Any] | None = None
) -> dict[str, list[Any]]:
    """Supplied values that differ from the VM's current state, as {field: [old, new]}.

    Only keys present in `normalized` are considered — an absent column can
    never register as a change.

    Child columns live in `raw`, not `normalized`, and count as a change only
    when the VM has no matching child — otherwise a row whose sole content is
    a disk it already has would classify as an update on every import.
    """
    changes: dict[str, list[Any]] = {}
    if raw is not None:
        clean = _clean_row(raw)
        existing_disks = {(d.disk_name or "").lower() for d in vm.disks}
        added_disks = [
            f"{name}:{size}"
            for name, size, _storage_name, _storage_type in _parse_disks(clean)
            if name.lower() not in existing_disks
        ]
        if added_disks:
            changes["disks"] = [None, added_disks]
        existing_apps = {(a.app_name or "").lower() for a in vm.applications}
        added_apps = [
            name for name, _owner in _parse_applications(clean) if name.lower() not in existing_apps
        ]
        if added_apps:
            changes["applications"] = [None, added_apps]
        # Accumulate exactly as _attach_children does, so the preview and the
        # batch rollup promise precisely what the commit will create. An address
        # repeated in a cell, or under a second role, is one network row.
        claimed_ips = {n.ip_address for n in vm.networks}
        for header in IP_ROLE_HEADERS:
            retargets, inserts = _plan_ip_changes(vm, clean, header, claimed_ips)
            old_retargeted = [n.ip_address for n, _ in retargets]
            new_retargeted = [a for _, a in retargets]
            new_combined = new_retargeted + inserts
            if old_retargeted or new_combined:
                changes[header] = [old_retargeted if old_retargeted else None, new_combined]
    for field, new_value in applicable_updates(normalized, vm).items():
        if field in CHILD_HEADERS:
            continue
        if not hasattr(vm, field):
            continue
        old_value = getattr(vm, field)
        # StrEnum and date columns compare cleanly against their string form.
        old_comparable = old_value.value if isinstance(old_value, StrEnum) else old_value
        if isinstance(old_comparable, date):
            old_comparable = old_comparable.isoformat()
        if old_comparable != new_value:
            changes[field] = [old_comparable, new_value]
    return changes


def load_batch_or_404(db: Session, batch_id: uuid.UUID, user: User) -> CsvImportBatch:
    batch = db.scalar(
        select(CsvImportBatch)
        .options(selectinload(CsvImportBatch.rows))
        .where(CsvImportBatch.id == batch_id)
    )
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
    if user.role.value != "admin" and batch.created_by_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Import batch not visible"
        )
    return batch


def _attach_children(db: Session, vm: Vm, raw: dict[str, Any], user: User) -> None:
    """Attach the row's disks and IPs that the VM has no matching child for.

    Additive only: existing children are never modified or removed. A row that
    omits a disk must not delete it, so there is no replace mode.

    ponytail: matches disk on name and IP on address; a size change on an
    existing disk is ignored rather than applied. Editing a child is a VM-form
    job — the CSV only ever adds.
    """
    clean = _clean_row(raw)

    existing_disks = {(d.disk_name or "").lower() for d in vm.disks}
    disk_order = len(vm.disks)
    for disk_name, size_gb, storage_name, storage_type in _parse_disks(clean):
        if disk_name.lower() in existing_disks:
            continue
        existing_disks.add(disk_name.lower())
        db.add(
            VmDisk(
                vm_id=vm.id,
                disk_name=disk_name,
                size_gb=size_gb,
                storage_name=storage_name,
                storage_type=storage_type,
                sort_order=disk_order,
            )
        )
        disk_order += 1

    claimed_ips = {n.ip_address for n in vm.networks}
    ip_order = len(vm.networks)
    for header in IP_ROLE_HEADERS:
        retargets, inserts = _plan_ip_changes(vm, clean, header, claimed_ips)
        for net_row, new_addr in retargets:
            old_addr = net_row.ip_address
            net_row.ip_address = new_addr
            db.add(
                AuditLog(
                    vm_id=vm.id,
                    user_id=user.id,
                    field_name=header,
                    old_value=old_addr,
                    new_value=new_addr,
                )
            )
        role = IP_ROLE_HEADERS[header]
        for new_addr in inserts:
            db.add(
                VmNetwork(
                    vm_id=vm.id,
                    ip_address=new_addr,
                    role=role,
                    sort_order=ip_order,
                )
            )
            ip_order += 1
    existing_apps = {(a.app_name or "").lower() for a in vm.applications}
    for app_name, app_owner in _parse_applications(clean):
        if app_name.lower() in existing_apps:
            continue
        existing_apps.add(app_name.lower())
        db.add(VmApplication(vm_id=vm.id, app_name=app_name, app_owner=app_owner))


def _commit_row(db: Session, row: CsvImportRow, user: User) -> tuple[str, Vm]:
    if row.action == ImportAction.decommission:
        vm = db.get(Vm, row.target_vm_id) if row.target_vm_id else None
        if vm is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed"
            )
        payload: dict[str, Any] = {"status": VmStatus.decommissioned}
        if vm.decommission_date is None:
            payload["decommission_date"] = date.today()
        update_vm(db, vm, VmUpdate.model_validate(payload), user, commit=False)
        return "decommission", vm
    assert row.normalized is not None
    normalized = row.normalized.copy()
    date_fields = (
        "last_patch_date",
        "last_vuln_scan_date",
        "decommission_date",
        "last_verified_at",
    )
    for date_field in date_fields:
        if normalized.get(date_field):
            normalized[date_field] = date.fromisoformat(normalized[date_field])
    if row.action == ImportAction.create:
        vm = create_vm(db, VmCreate.model_validate({**DEFAULTS, **normalized}), user, commit=False)
        db.flush()
        _attach_children(db, vm, row.raw, user)
        return "create", vm
    if row.target_vm_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    existing_vm: Vm | None = db.get(Vm, row.target_vm_id)
    if existing_vm is None or find_matching_vm(db, row.normalized) != existing_vm:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    payload = applicable_updates(normalized, existing_vm)
    update_vm(db, existing_vm, VmUpdate.model_validate(payload), user, commit=False)
    _attach_children(db, existing_vm, row.raw, user)
    return "update", existing_vm


def commit_batch(
    db: Session, *, batch_id: uuid.UUID, user: User, confirm_decommission: bool = False
) -> dict[str, int]:
    batch = load_batch_or_404(db, batch_id, user)
    if batch.status != ImportStatus.previewed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Import batch is not previewed"
        )
    blockers = [
        row for row in batch.rows if row.action in {ImportAction.invalid, ImportAction.conflict}
    ]
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Import contains invalid or conflicting rows",
        )
    decommission_rows = [r for r in batch.rows if r.action == ImportAction.decommission]
    candidate_total = int(batch.summary.get("decommission_candidate_total", 0))
    if (
        decommission_rows
        and not confirm_decommission
        and candidate_total
        and len(decommission_rows) * 2 > candidate_total
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This import would decommission {len(decommission_rows)} of {candidate_total} VMs "
                "(over half the inventory). Re-submit with confirm_decommission to proceed."
            ),
        )
    created = 0
    updated = 0
    decommissioned = 0
    touched_vms: list[Vm] = []
    for row in batch.rows:
        if row.action == ImportAction.unchanged:
            continue
        try:
            action, vm = _commit_row(db, row, user)
            touched_vms.append(vm)
            if action == "create":
                created += 1
            elif action == "decommission":
                decommissioned += 1
            else:
                updated += 1
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Row {row.row_number} failed to import: {exc}",
            ) from exc

    # ponytail: health_score depends on disks/networks attached above; recompute here
    # (once, for every commit path) rather than inside create_vm/update_vm's commit=False branch.
    db.flush()
    for vm in touched_vms:
        db.refresh(vm)
        vm.health_score = compute_health_score(vm)

    try:
        batch.status = ImportStatus.committed
        batch.committed_at = datetime.now(UTC)
        batch.summary = {**batch.summary, "committed": True}
        db.add(batch)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"created": created, "updated": updated, "decommissioned": decommissioned}
