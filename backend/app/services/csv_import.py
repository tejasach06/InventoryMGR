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
    StorageArray,
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    compute_health_score,
)
from app.schemas.vms import VmCreate, VmUpdate
from app.services.csv_import_parsing import (
    ALL_HEADERS,
    BOOL_HEADERS,
    CHILD_HEADERS,
    DATE_HEADERS,
    DEFAULTS,
    DISK_DEFAULT_HEADERS,
    ENUM_HEADERS,
    ENUM_VALUES,
    EXCLUDED_FROM_CSV,
    INT_HEADERS,
    IP_ROLE_HEADERS,
    LIST_HEADERS,
    MAX_CSV_BYTES,
    MAX_CSV_ROWS,
    OPTIONAL_HEADERS,
    PLATFORM_ALIASES,
    REQUIRED_HEADERS,
    REQUIRED_HEADERS_ORDER,
    STRING_HEADERS,
    TEMPLATE_COLUMNS,
    TEMPLATE_GROUPS,
    TEMPLATE_SAMPLE_ROWS,
    _clean_row,
    _error,
    _parse_applications,
    _parse_disks,
    _parse_ips,
    identity_key,
    normalize_csv_row,
    parse_csv_bytes,
)
from app.services.vms import create_vm, update_vm

__all__ = [
    "ALL_HEADERS",
    "BOOL_HEADERS",
    "CHILD_HEADERS",
    "DATE_HEADERS",
    "DEFAULTS",
    "DISK_DEFAULT_HEADERS",
    "ENUM_HEADERS",
    "ENUM_VALUES",
    "EXCLUDED_FROM_CSV",
    "INT_HEADERS",
    "IP_ROLE_HEADERS",
    "LIST_HEADERS",
    "MAX_CSV_BYTES",
    "MAX_CSV_ROWS",
    "OPTIONAL_HEADERS",
    "PLATFORM_ALIASES",
    "REQUIRED_HEADERS",
    "REQUIRED_HEADERS_ORDER",
    "STRING_HEADERS",
    "TEMPLATE_COLUMNS",
    "TEMPLATE_GROUPS",
    "TEMPLATE_SAMPLE_ROWS",
    "commit_batch",
    "create_preview_batch",
    "diff_against_vm",
    "find_matching_vm",
    "identity_key",
    "load_batch_or_404",
    "normalize_csv_row",
    "parse_csv_bytes",
]

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
    return [_error("storage_name", f"no storage array named '{name}' exists") for name in names if name.lower() not in known]


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

    seen: set[tuple[str, ...]] = set()
    summary = {"create": 0, "update": 0, "unchanged": 0, "conflict": 0, "invalid": 0}
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
                match = find_matching_vm(db, normalized)
                if match is None:
                    action = ImportAction.create
                else:
                    target_vm_id = match.id
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
    batch.summary = summary
    batch.field_changes = field_changes
    db.commit()
    return load_batch_or_404(db, batch.id, user)


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
        seen_ips = {n.ip_address for n in vm.networks}
        for header in IP_ROLE_HEADERS:
            added_ips = []
            for ip_address in _parse_ips(clean, header):
                if ip_address in seen_ips:
                    continue
                seen_ips.add(ip_address)
                added_ips.append(ip_address)
            if added_ips:
                changes[header] = [None, added_ips]
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


def _attach_children(db: Session, vm: Vm, raw: dict[str, Any]) -> None:
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

    existing_ips = {n.ip_address for n in vm.networks}
    ip_order = len(vm.networks)
    for header, role in IP_ROLE_HEADERS.items():
        for ip_address in _parse_ips(clean, header):
            if ip_address in existing_ips:
                continue
            existing_ips.add(ip_address)
            db.add(
                VmNetwork(
                    vm_id=vm.id,
                    ip_address=ip_address,
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
        _attach_children(db, vm, row.raw)
        return "create", vm
    if row.target_vm_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    existing_vm: Vm | None = db.get(Vm, row.target_vm_id)
    if existing_vm is None or find_matching_vm(db, row.normalized) != existing_vm:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    update_vm(db, existing_vm, VmUpdate.model_validate(normalized), user, commit=False)
    _attach_children(db, existing_vm, row.raw)
    return "update", existing_vm


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
