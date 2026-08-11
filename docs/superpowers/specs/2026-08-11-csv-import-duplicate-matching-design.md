# CSV Import Duplicate Matching by Platform

## Problem

CSV import identity matching (`backend/app/services/csv_import.py`) currently treats a Proxmox row as the same VM if `vmid` matches, even when the name differs (raising `ProxmoxIdentityMismatch`), and ignores `node`/`datacenter` entirely. VMware rows match on `external_id` alone. This doesn't reflect how these platforms actually identify VMs: a Proxmox vmid can be reused after a VM is deleted/recreated, and VMware has no stable numeric ID worth trusting from a CSV export.

## Rule

- **Proxmox**: a CSV row matches an existing VM only if `external_id` (vmid), `name` (case-insensitive), `node`, and `datacenter` **all** match exactly. Blank/null counts as a literal value that must match blank-to-blank. If any of the four differ, the row is a different VM → `create`.
- **VMware**: `external_id` is ignored for matching. A row matches an existing VM only if `name`, `node`, and `datacenter` all match.
- **In-batch dedup** (`identity_key`, which flags duplicate rows within one CSV as `conflict`) uses the same per-platform field set. Two rows with the same vmid+name but different node/datacenter are not a within-file conflict — both proceed as independent `create` rows.

## Removed behavior

`ProxmoxIdentityMismatch` is removed. Today it fires when vmid matches but name differs, forcing a manual-resolution error. Under the new rule, a name mismatch (or node/datacenter mismatch) simply means "not the same VM" and falls through to `create` like any other non-match — no special exception path needed.

## Scope

Change is contained to `identity_key()` and `find_matching_vm()` in `backend/app/services/csv_import.py`. `Vm.node` and `Vm.datacenter` already exist as nullable columns — no schema/migration changes required. `diff_against_vm`, storage warnings, CSV parsing, and the batch summary counters are unaffected since they consume whatever `find_matching_vm` returns.

## Testing

Update/extend `backend/tests/test_csv_imports.py` to cover:
- Proxmox: vmid+name match but node differs → create (not update).
- Proxmox: vmid+name match but datacenter differs → create.
- Proxmox: all four match → update.
- Proxmox: vmid matches, name differs → create, no `ProxmoxIdentityMismatch` raised (remove/replace the old mismatch test).
- VMware: name+node+datacenter match, external_id differs or is absent → update (external_id ignored).
- VMware: name matches but node differs → create.
- In-batch: two rows sharing vmid+name but different node/datacenter both import as separate `create` rows, not flagged `conflict`.
