import csv
import io
import uuid
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    CsvImportBatch,
    CsvImportRow,
    ImportAction,
    ImportStatus,
    Platform,
    User,
    Vm,
    VmDisk,
    VmNetwork,
    compute_health_score,
)
from app.schemas.vms import VmBase, VmCreate, VmUpdate
from app.services.vms import create_vm, update_vm

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CSV_ROWS = 5000
REQUIRED_HEADERS_ORDER = ("name", "platform", "cluster")
REQUIRED_HEADERS = set(REQUIRED_HEADERS_ORDER)

# vm_type drives lifecycle gating in services/vms.py::_apply_vm_type_lifecycle;
# letting an import set it is out of scope. disks/networks are child collections
# expressed through CHILD_HEADERS instead.
EXCLUDED_FROM_CSV = {"disks", "networks", "vm_type"}
CHILD_HEADERS = {"disk_name", "disk_gb", "ip_address"}

OPTIONAL_HEADERS = (
    set(VmBase.model_fields) - EXCLUDED_FROM_CSV - REQUIRED_HEADERS
) | CHILD_HEADERS
ALL_HEADERS = REQUIRED_HEADERS | OPTIONAL_HEADERS

PLATFORM_ALIASES = {
    "proxmox": "proxmox",
    "pve": "proxmox",
    "vmware": "vmware",
    "vsphere": "vmware",
    "vcenter": "vmware",
}
ENUM_VALUES = {
    "status": {"running", "powered_off", "suspended", "archived", "decommissioned", "unknown"},
    "environment": {"production", "development", "testing", "uat", "dr", "staging", "sandbox"},
    "criticality": {"low", "medium", "high", "critical"},
    "lifecycle": {"planned", "active", "retiring", "retired"},
    "os_family": {"linux", "windows"},
}
DEFAULTS: dict[str, Any] = {
    "status": "unknown",
    "environment": "production",
    "cpu_cores": 0,
    "memory_mb": 0,
    "criticality": "medium",
    "lifecycle": "active",
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
    "os_name",
    "os_distribution",
    "os_version",
    "owner",
    "business_owner",
    "technical_owner",
    "security_remarks",
    "backup_location",
)
ENUM_HEADERS = ("status", "environment", "criticality", "lifecycle", "os_family")
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

    for field in DATE_HEADERS:
        stamp = _parse_date(clean, field, errors)
        if stamp is not None:
            normalized[field] = stamp

    if errors:
        return None, errors
    return normalized, []


def identity_key(normalized: dict[str, Any]) -> tuple[str, str, str]:
    platform = normalized["platform"]
    external_id = normalized.get("external_id")
    if external_id:
        return ("external_id", platform, external_id)
    return ("name", platform, normalized["name"].lower())


def find_matching_vm(db: Session, normalized: dict[str, Any]) -> Vm | None:
    platform = Platform(normalized["platform"])
    external_id = normalized.get("external_id")
    if external_id:
        return db.scalar(
            select(Vm).where(
                Vm.platform == platform,
                Vm.external_id == external_id,
            )
        )
    return db.scalar(
        select(Vm).where(
            Vm.platform == platform,
            Vm.external_id.is_(None),
            func.lower(Vm.name) == normalized["name"].lower(),
        )
    )


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


def create_preview_batch(
    db: Session, *, filename: str, content: bytes, user: User
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
    )
    db.add(batch)
    db.flush()

    seen: set[tuple[str, str, str, str]] = set()
    summary = {"create": 0, "update": 0, "unchanged": 0, "conflict": 0, "invalid": 0}
    field_changes: dict[str, int] = {}
    for idx, raw in enumerate(rows, start=2):
        normalized, errors = normalize_csv_row(raw)
        action = ImportAction.invalid
        target_vm_id: uuid.UUID | None = None
        changes: dict[str, list[Any]] = {}
        if normalized is not None:
            key = identity_key(normalized)
            if key in seen:
                action = ImportAction.conflict
                errors = [_error("identity", "duplicate CSV identity")]
            else:
                seen.add(key)
                match = find_matching_vm(db, normalized)
                if match is None:
                    action = ImportAction.create
                else:
                    target_vm_id = match.id
                    changes = diff_against_vm(normalized, match)
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
                changes=changes,
            )
        )
    batch.summary = summary
    batch.field_changes = field_changes
    db.commit()
    return load_batch_or_404(db, batch.id, user)


def diff_against_vm(normalized: dict[str, Any], vm: Vm) -> dict[str, list[Any]]:
    """Supplied values that differ from the VM's current state, as {field: [old, new]}.

    Only keys present in `normalized` are considered — an absent column can
    never register as a change.
    """
    changes: dict[str, list[Any]] = {}
    for field, new_value in normalized.items():
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


def _commit_row(db: Session, row: CsvImportRow, user: User) -> tuple[str, Vm]:
    assert row.normalized is not None
    normalized = row.normalized.copy()
    date_fields = (
        "last_patch_date", "last_vuln_scan_date", "decommission_date", "last_verified_at"
    )
    for date_field in date_fields:
        if normalized.get(date_field):
            normalized[date_field] = date.fromisoformat(normalized[date_field])
    if row.action == ImportAction.create:
        vm = create_vm(db, VmCreate.model_validate({**DEFAULTS, **normalized}), user, commit=False)
        db.flush()
        disk_name = str(row.raw.get("disk_name") or "").strip()
        disk_gb = row.raw.get("disk_gb")
        ip_address = str(row.raw.get("ip_address") or "").strip()
        if disk_name:
            db.add(VmDisk(
                vm_id=vm.id, disk_name=disk_name,
                size_gb=int(disk_gb) if str(disk_gb or "").strip().isdigit() else 0,
                sort_order=0,
            ))
        if ip_address:
            db.add(VmNetwork(vm_id=vm.id, ip_address=ip_address, sort_order=0))
        return "create", vm
    if row.target_vm_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    vm = db.get(Vm, row.target_vm_id)
    if vm is None or find_matching_vm(db, row.normalized) != vm:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    update_vm(db, vm, VmUpdate.model_validate(normalized), user, commit=False)
    return "update", vm


def commit_batch(db: Session, *, batch_id: uuid.UUID, user: User) -> dict[str, int]:
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
    created = 0
    updated = 0
    touched_vms: list[Vm] = []
    for row in batch.rows:
        if row.action == ImportAction.unchanged:
            continue
        try:
            action, vm = _commit_row(db, row, user)
            touched_vms.append(vm)
            if action == "create":
                created += 1
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
    return {"created": created, "updated": updated}
