# Multi-Child CSV — Design

Date: 2026-07-19
Status: Approved, not yet implemented
Scope: Spec 3 of 3 (depends on spec 1 and spec 2, both implemented)

## Problem

One CSV row can express one disk and one IP, through the single-value headers
`disk_name`, `disk_gb`, and `ip_address`. A VM with three disks cannot be
imported. Spec 1 named this honestly — "additive, best-effort" — and deferred
multi-value support here.

Spec 2 added `NetworkRole` to `VmNetwork`, but the CSV's lone `ip_address`
column has no role, so every imported IP lands as `private`. An operator
importing public addresses has no way to say so.

## Decisions

**Header shape.** Inline pairing in one column per child type:

```csv
name,platform,cluster,disks,private_ip,public_ip,backup_ip
web-01,proxmox,pve-a,os:100;data:500,10.0.0.5;10.0.0.6,203.0.113.4,
```

`;` is the separator, matching `tags`. Inline `name:size` pairing was chosen
over parallel `disk_name`/`disk_gb` list columns because parallel lists shear
silently when someone edits one column and not the other.

IP role comes from the column name, so no inline pairing is needed there — the
three role columns are plain `;`-separated lists.

**Old headers are dropped, not aliased.** `disk_name`, `disk_gb`, and
`ip_address` leave `ALL_HEADERS`. Spec 1 made unrecognized columns
ignored-and-reported, so an old CSV imports its VM fields and the preview warns
`Ignored columns: disk_name, disk_gb, ip_address`. The operator sees the
problem; nothing is silently destroyed. An alias branch was rejected as
compatibility code with no expiry date.

**Update stays additive, matched by identity.** A supplied child is added if
the VM has no matching one; existing children are never modified or deleted.
Disks match on case-insensitive `disk_name`, IPs on exact address. A row
supplying `os:100` for a VM whose `os` disk is 250GB changes nothing — size
correction remains a VM-form job.

This extends spec 1's decision unchanged. Replace semantics were rejected there
and are rejected here for the same reason: a row that omits a child would
delete it.

**Malformed entries error the row.** `os:100;data` (no size) or `os:abc`
(non-numeric) marks the row an error and commits nothing, the same treatment a
junk `memory_mb` already gets. No partial-row import, no third preview state
between error and success.

**Blank still means "not supplied."** Spec 1's rule holds unchanged: a blank
`disks` cell on update touches no children, and on create adds none.

## Design

### Backend

**Headers.** `CHILD_HEADERS` becomes `{"disks", "private_ip", "public_ip",
"backup_ip"}`. `TEMPLATE_HEADERS` follows without further work — headers already
derive from a single source (`43f778e`).

**Parsing.** One new helper, modelled directly on `_parse_int_list`, which
already splits on `;` and accumulates errors:

```python
def _parse_disks(
    row: dict[str, str], field: str, errors: list[dict[str, str]]
) -> list[tuple[str, int]] | None:
```

Splits on `;`, then each part on the first `:`. Returns `None` when the cell is
blank, so the caller omits the key and spec 1's skip semantics apply unchanged.
On an empty name, a missing size, or a non-numeric size it appends
`_error(field, "must be name:size pairs separated by ;")` and returns `None`;
`normalize_csv_row` already returns `(None, errors)` when `errors` is non-empty,
which is what marks the row an error and stops it committing.

IPs need no new helper. `_parse_list` already splits on `;` and strips; the role
is the column name.

Duplicates within one cell dedupe, first occurrence wins.

**Attachment.** The create and update branches currently build children
separately. That divergence is what let disks and IPs be dropped on update until
`4ea90f8` patched the update side. Both branches call one function instead:

```python
def _attach_children(
    vm: Vm,
    disks: list[tuple[str, int]] | None,
    ips_by_role: dict[NetworkRole, list[str]],
) -> None:
```

New children append at `max(sort_order) + 1`, so import order is stable and
existing rows keep their positions.

The create path's `size_gb=int(disk_gb) if str(disk_gb or "").strip().isdigit()
else 0` fallback is removed. Sizes are validated during parsing now, so a junk
size errors the row instead of silently becoming a 0GB disk.

**Preview.** Added children appear in the existing `changes` JSON with a list
value:

```python
{"disks": [None, ["data:500"]], "private_ip": [None, ["10.0.0.6"]]}
```

Only the value type widens, from scalar to list. `changes` and `field_changes`
are already JSON columns, so there is no migration and no schema revision in
this spec. The batch rollup reads "disks on 12 VMs" with its existing logic.

Classification is unaffected: a row whose only supplied children already exist
on the VM is `unchanged`, because `changes` comes out empty.

### Frontend

- The expanded change detail renders a list where it currently renders a scalar
  `old → new`.
- `ImportCsvPage` help text documents the `name:size;name:size` form, the `;`
  separator, and that import only ever adds children — removing a disk or IP is
  done in the VM form.

### Tests

- Multi-disk row creates every disk with its size and sort order.
- Update adds only the unmatched disk; a matched disk with a different size is
  left untouched.
- The three IP columns land with the correct `NetworkRole`.
- Malformed `disks` errors the row and commits nothing.
- Blank `disks` on update touches no children.
- An old `disk_name` header lands in `ignored_columns` and the row's VM fields
  still import.
- `TEMPLATE_HEADERS == ALL_HEADERS` — the existing guard, which must stay green
  through the header change.

## Out of scope

- **Deleting children via CSV.** No sentinel, no replace mode. Rejected in spec
  1 and unchanged here.
- **Correcting a matched disk's size.** Additive means additive; the VM form
  owns edits.
- **Gateway and VLAN in the CSV.** `VmNetwork` has both, but no flow asked for
  them and inline pairing for a four-field child would need a nested format.
  Revisit if reconcile needs it.
