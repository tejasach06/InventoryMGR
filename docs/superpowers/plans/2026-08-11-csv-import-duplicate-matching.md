# CSV Import Duplicate Matching by Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CSV-import duplicate/update matching platform-aware: Proxmox rows match an existing VM only when `name` + `node` + `datacenter` match, and additionally `external_id` (vmid) when the row supplies one; VMware rows match only on `name` + `node` + `datacenter`, ignoring `external_id` entirely.

**Architecture:** Single-file change in `backend/app/services/csv_import.py`. Replace `identity_key()` and `find_matching_vm()` with platform-aware versions built on the existing normalized-row dict and `Vm` columns (`Vm.node`, `Vm.datacenter` already exist, nullable, no migration needed). Remove the now-unnecessary `ProxmoxIdentityMismatch` exception and its call site — a field mismatch simply falls through to "no match" (→ `create`) instead of raising.

**Tech Stack:** Python, SQLAlchemy, FastAPI, pytest (existing stack, no new dependencies).

## Global Constraints

- Blank/absent CSV cell for `node`/`datacenter`/`external_id` is a real value ("blank") that must match blank-to-blank against the existing `Vm` row — never treated as "skip this field."
- No schema or migration changes. `Vm.node` and `Vm.datacenter` already exist as nullable `String(255)` columns.
- `diff_against_vm`, `_storage_warnings`, CSV parsing/headers, and `commit_batch`/`_commit_row` must keep working unchanged — they only consume whatever `find_matching_vm` returns.
- All existing tests in `backend/tests/test_csv_imports.py` must pass after the change; three of them assert now-obsolete behavior and must be rewritten as part of this same task (see Step 6).

---

### Task 1: Platform-aware identity matching

**Files:**
- Modify: `backend/app/services/csv_import.py:490-535` (delete `ProxmoxIdentityMismatch`, rewrite `identity_key()` and `find_matching_vm()`)
- Modify: `backend/app/services/csv_import.py:622-630` (remove the `try/except ProxmoxIdentityMismatch` wrapper around `find_matching_vm`)
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: `normalized: dict[str, Any]` produced by `normalize_csv_row()` — only string/None values, using `.get(field)` returns `None` when the CSV cell was blank or the column was absent (established behavior, see `normalize_csv_row` docstring at line 416).
- Produces:
  - `identity_key(normalized: dict[str, Any]) -> tuple[str, ...]` — used by `create_preview_batch` at line 616 to flag in-batch duplicates.
  - `find_matching_vm(db: Session, normalized: dict[str, Any]) -> Vm | None` — used by `create_preview_batch` (line 623) and `_commit_row` (line 808). Signature and return type (`Vm | None`, no exception) are unchanged from today except `ProxmoxIdentityMismatch` is never raised.

- [ ] **Step 1: Write the failing tests for the new matching rule**

Append to `backend/tests/test_csv_imports.py`:

```python
def test_proxmox_matches_only_when_vmid_name_node_datacenter_all_match(
    client, db_session: Session
) -> None:
    user = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        user,
        name="pve-app-01",
        platform="proxmox",
        external_id="VM-100",
        datacenter="dc-a",
        node="pve-node-1",
    )
    csrf = login(client, user.email)

    same = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id,datacenter,node",
                "pve-app-01,proxmox,pve-cluster-a,VM-100,dc-a,pve-node-1",
            ]
        ),
    )
    assert same.json()["rows"][0]["action"] == "update"

    diff_node = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id,datacenter,node",
                "pve-app-01,proxmox,pve-cluster-a,VM-100,dc-a,pve-node-2",
            ]
        ),
    )
    assert diff_node.json()["rows"][0]["action"] == "create"

    diff_datacenter = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id,datacenter,node",
                "pve-app-01,proxmox,pve-cluster-a,VM-100,dc-b,pve-node-1",
            ]
        ),
    )
    assert diff_datacenter.json()["rows"][0]["action"] == "create"

    renamed = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id,datacenter,node",
                "renamed-app,proxmox,pve-cluster-a,VM-100,dc-a,pve-node-1",
            ]
        ),
    )
    assert renamed.json()["rows"][0]["action"] == "create"


def test_proxmox_without_vmid_still_requires_node_and_datacenter_match(
    client, db_session: Session
) -> None:
    user = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        user,
        name="pve-app-02",
        platform="proxmox",
        external_id=None,
        datacenter="dc-a",
        node="pve-node-1",
    )
    csrf = login(client, user.email)

    same = upload_csv(
        client,
        csrf,
        "name,platform,cluster,datacenter,node\npve-app-02,proxmox,pve-cluster-a,dc-a,pve-node-1\n",
    )
    assert same.json()["rows"][0]["action"] == "update"

    diff_node = upload_csv(
        client,
        csrf,
        "name,platform,cluster,datacenter,node\npve-app-02,proxmox,pve-cluster-a,dc-a,pve-node-9\n",
    )
    assert diff_node.json()["rows"][0]["action"] == "create"


def test_vmware_ignores_vmid_matches_on_name_node_datacenter(
    client, db_session: Session
) -> None:
    user = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        user,
        name="vc-app-01",
        platform="vmware",
        external_id="VM-1001",
        datacenter="dc-vc",
        node="esxi-1",
    )
    csrf = login(client, user.email)

    diff_vmid = upload_csv(
        client,
        csrf,
        "name,platform,cluster,external_id,datacenter,node\nvc-app-01,vmware,vc-cluster,VM-9999,dc-vc,esxi-1\n",
    )
    assert diff_vmid.json()["rows"][0]["action"] == "update"

    no_vmid = upload_csv(
        client,
        csrf,
        "name,platform,cluster,datacenter,node\nvc-app-01,vmware,vc-cluster,dc-vc,esxi-1\n",
    )
    assert no_vmid.json()["rows"][0]["action"] == "update"

    diff_node = upload_csv(
        client,
        csrf,
        "name,platform,cluster,external_id,datacenter,node\nvc-app-01,vmware,vc-cluster,VM-1001,dc-vc,esxi-2\n",
    )
    assert diff_node.json()["rows"][0]["action"] == "create"


def test_in_batch_same_vmid_name_different_placement_are_two_creates(
    client, db_session: Session
) -> None:
    user = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, user.email)

    preview = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id,datacenter,node",
                "dup-app,proxmox,pve-cluster-a,VM-500,dc-a,pve-node-1",
                "dup-app,proxmox,pve-cluster-a,VM-500,dc-b,pve-node-2",
            ]
        ),
    )
    assert preview.status_code == 201, preview.text
    assert [row["action"] for row in preview.json()["rows"]] == ["create", "create"]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd backend && pytest tests/test_csv_imports.py -k "matches_only_when_vmid or without_vmid_still_requires or ignores_vmid_matches or same_vmid_name_different_placement" -v`
Expected: FAIL — the `diff_node`/`diff_datacenter`/`renamed` assertions get `"update"` instead of `"create"` (today's code ignores node/datacenter), and the vmware test's `diff_node` case gets `"update"` instead of `"create"`.

- [ ] **Step 3: Rewrite `identity_key()` and `find_matching_vm()`, delete `ProxmoxIdentityMismatch`**

Replace lines 490-535 of `backend/app/services/csv_import.py` (the `ProxmoxIdentityMismatch` class through the end of `find_matching_vm`) with:

```python
def identity_key(normalized: dict[str, Any]) -> tuple[str, ...]:
    platform = normalized["platform"]
    name = normalized["name"].lower()
    node = (normalized.get("node") or "").lower()
    datacenter = (normalized.get("datacenter") or "").lower()
    if platform == "proxmox":
        return ("proxmox", normalized.get("external_id"), name, node, datacenter)
    return ("vmware", name, node, datacenter)


def find_matching_vm(db: Session, normalized: dict[str, Any]) -> Vm | None:
    platform = Platform(normalized["platform"])
    name = normalized["name"].lower()
    node = normalized.get("node")
    datacenter = normalized.get("datacenter")
    conditions = [
        Vm.platform == platform,
        func.lower(Vm.name) == name,
        Vm.node.is_(None) if node is None else func.lower(Vm.node) == node.lower(),
        Vm.datacenter.is_(None)
        if datacenter is None
        else func.lower(Vm.datacenter) == datacenter.lower(),
    ]
    if platform == Platform.proxmox:
        external_id = normalized.get("external_id")
        conditions.append(
            Vm.external_id.is_(None) if external_id is None else Vm.external_id == external_id
        )
    return db.scalar(select(Vm).where(*conditions))
```

Then in `create_preview_batch` (originally lines 621-630), replace:

```python
                seen.add(key)
                try:
                    match = find_matching_vm(db, normalized)
                except ProxmoxIdentityMismatch as exc:
                    errors = [
                        _error(
                            "external_id",
                            f"vmid already belongs to Proxmox VM '{exc.existing_name}'; rename the CSV row or the existing VM",
                        )
                    ]
                else:
                    if match is None:
                        action = ImportAction.create
                    else:
                        target_vm_id = match.id
                        changes = diff_against_vm(normalized, match, raw)
                        action = ImportAction.update if changes else ImportAction.unchanged
                        for field in changes:
                            field_changes[field] = field_changes.get(field, 0) + 1
```

with:

```python
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
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd backend && pytest tests/test_csv_imports.py -k "matches_only_when_vmid or without_vmid_still_requires or ignores_vmid_matches or same_vmid_name_different_placement" -v`
Expected: PASS (all 4 new tests)

- [ ] **Step 5: Run the full CSV import test suite to find breakage from the rule change**

Run: `cd backend && pytest tests/test_csv_imports.py -v`
Expected: 3 pre-existing tests fail:
- `test_csv_preview_persists_classification_for_create_update_conflict_and_invalid` — row 0 now gets `"create"` instead of `"update"`, because the CSV has no `datacenter`/`node` columns while the pre-existing `Existing App` VM has `datacenter="dc-a"` (set via `create_vm_row`'s `vm_payload` default).
- `test_proxmox_vmid_identity_includes_name_and_rejects_renames` — the final assertion expects an `"invalid"` action with a `ProxmoxIdentityMismatch` error message, which no longer exists.
- `test_non_proxmox_external_id_still_matches_without_name` — asserts vmware matches purely on `external_id` even though the name differs, which contradicts the new vmware rule.

- [ ] **Step 6: Fix the 3 broken tests to assert the new, correct behavior**

In `backend/tests/test_csv_imports.py`, in `test_csv_preview_persists_classification_for_create_update_conflict_and_invalid`, change the CSV header and first two data rows (originally lines 29-31) to carry a matching `datacenter` column so `Existing App` (created with default `datacenter="dc-a"`, no `node`) still matches:

```python
    csv_content = "\n".join(
        [
            "name,platform,cluster,status,cpu_cores,memory_mb,external_id,tags,ha_enabled,last_verified_at,datacenter",
            "Existing App,Proxmox,pve-cluster-a,running,4,8192,,web; critical,yes,2026-06-13,dc-a",
            " existing app ,pve,pve-cluster-a,powered_off,2,4096,,,false,,dc-a",
            "New VMware,vcenter,vc-cluster,unknown,8,16384,vm-200,db;prod,no,2026-01-01,",
            "Broken Row,vmware,vc-cluster,unknown,-1,1024,,,false,,",
        ]
    )
```

Replace `test_proxmox_vmid_identity_includes_name_and_rejects_renames` (originally lines 1042-1081) entirely — it tested the removed `ProxmoxIdentityMismatch` behavior. Rename and rewrite it to assert the new "rename means create" behavior instead:

```python
def test_proxmox_rename_with_same_vmid_creates_new_vm(client, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, user.email)
    preview = upload_csv(
        client,
        csrf,
        "\n".join(
            [
                "name,platform,cluster,external_id",
                "stg-a,proxmox,pve-a,VM-9001",
                "stg-c,proxmox,pve-a,VM-9001",
                "stg-a,proxmox,pve-a,VM-9001",
            ]
        ),
    )
    assert preview.status_code == 201, preview.text
    rows = preview.json()["rows"]
    assert [row["action"] for row in rows] == ["create", "create", "conflict"]
    assert rows[2]["errors"] == [{"field": "identity", "message": "duplicate CSV identity"}]
    assert client.post(f"/api/imports/{preview.json()['id']}/commit", headers=auth_headers(csrf)).status_code == 409

    accepted = upload_csv(
        client,
        csrf,
        "name,platform,cluster,external_id\nstg-a,proxmox,pve-a,VM-9001\nstg-c,proxmox,pve-a,VM-9001\n",
    )
    assert client.post(f"/api/imports/{accepted.json()['id']}/commit", headers=auth_headers(csrf)).status_code == 200

    renamed = upload_csv(
        client,
        csrf,
        "name,platform,cluster,external_id\nrenamed-x,proxmox,pve-a,VM-9001\n",
    )
    row = renamed.json()["rows"][0]
    assert row["action"] == "create"
```

Replace `test_non_proxmox_external_id_still_matches_without_name` (originally lines 1084-1096) — its premise (vmware matches on `external_id` regardless of name) is now wrong. Delete it; its replacement behavior is already covered by the new `test_vmware_ignores_vmid_matches_on_name_node_datacenter` test added in Step 1.

- [ ] **Step 7: Run the full CSV import test suite again**

Run: `cd backend && pytest tests/test_csv_imports.py -v`
Expected: PASS (all tests, including the 4 new ones and the 3 fixed ones)

- [ ] **Step 8: Run the full backend test suite as a regression check**

Run: `cd backend && pytest -q`
Expected: PASS — no other test file references `ProxmoxIdentityMismatch`, `identity_key`, or `find_matching_vm` (confirmed via `grep -rn "ProxmoxIdentityMismatch" backend` during planning, only found in `csv_import.py`).

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "feat: match Proxmox/VMware CSV import rows on name+node+datacenter

Proxmox additionally requires vmid to match when the row supplies one.
VMware ignores vmid entirely. Removes ProxmoxIdentityMismatch, whose
name-mismatch error is now just a normal create."
```
