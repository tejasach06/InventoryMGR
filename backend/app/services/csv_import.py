import uuid
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
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
    VmStatus,
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
    update_vm(db, existing_vm, VmUpdate.model_validate(normalized), user, commit=False)
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
