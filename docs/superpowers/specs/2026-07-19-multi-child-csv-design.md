# Multi-Child CSV — Design

Date: 2026-07-19
Status: Implemented (`f408fb3`, `dfe81aa`)
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

**Parsing.** One new helper, modelled on `_parse_int_list`, which already splits
on `;` and accumulates errors:

```python
def _parse_disks(
    row: dict[str, str], field: str, errors: list[dict[str, str]] | None = None
) -> list[tuple[str, int]]:
```

Splits on `;`, then each part on the first `:`. Returns `[]` for a blank cell,
so a blank supplies nothing and spec 1's skip semantics hold. On an empty name,
a missing size, or a non-numeric size it appends
`_error(field, "must be name:size pairs separated by ;")` and returns `[]`;
`normalize_csv_row` already returns `(None, errors)` when `errors` is non-empty,
which is what marks the row an error and stops it committing.

`errors` is optional because the two non-validating call sites
(`diff_against_vm`, `_attach_children`) re-parse a cell that `normalize_csv_row`
already proved valid, and have no error list to hand it.

IPs need no new helper. `_parse_list` already splits on `;` and strips; the role
is the column name.

Duplicates within one cell dedupe, first occurrence wins.

**Attachment.** `_attach_children(db, vm, raw)` already exists and is already
called by both the create and update branches — `4ea90f8` unified them, and its
`ponytail:` comment names this spec as the upgrade path. Nothing is unified
here; the function's body widens from one disk and one IP to lists, and its
signature is unchanged.

New children keep the existing `sort_order=len(vm.disks)` idiom, incrementing as
each is appended, so import order is stable and existing rows keep positions.

**Where child values live.** Child columns stay in `raw`, never in `normalized`
— `normalized` feeds `VmUpdate.model_validate`, and a `disks` key there would
be rejected. `_parse_disks` is therefore a pure function over the raw cell,
called at three sites: `normalize_csv_row` for validation only, `diff_against_vm`
for classification, and `_attach_children` for the write.

The `size_gb=int(disk_gb) if str(disk_gb or "").strip().isdigit() else 0`
fallback inside `_attach_children` is removed. Sizes are validated during
parsing now, so a junk size errors the row instead of silently becoming a 0GB
disk.

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

## Notes from implementation

1. **No implementation plan was written.** Specs 1 and 2 each got one. This
   change is three functions in one backend file plus two cells in one
   component, so the plan would have been longer than the diff. Decided
   deliberately, not skipped.
2. **The first draft of this spec was wrong about `_attach_children`**, claiming
   the create and update branches built children separately and needed
   unifying. `4ea90f8` had already unified them. Caught by reading the code
   before planning and corrected in `6e905f5` — spec 2's plan shipped nine
   deviations from exactly this failure to read first.
3. **The frontend list-rendering work did not exist.** The spec called for the
   expanded change detail to render a list instead of a scalar, but
   `ImportCsvPage` has no expanded detail — it shows a field *count* per row and
   a batch rollup of counts, both of which are indifferent to the value type.
   The real frontend change was the preview table's disk and IP cells, which
   showed one of each because one was all a row could carry.
4. **`_parse_disks` takes `errors` as an optional keyword.** The spec's first
   signature had it required, which the two non-validating call sites cannot
   satisfy — they re-parse a cell `normalize_csv_row` already validated and have
   no error list to pass.
5. **Verification:** 67 backend tests, 172 Vitest, 29 Playwright, ruff clean.
   The six new backend tests drive the real preview and commit endpoints against
   real Postgres, so the multi-child path is exercised end to end rather than at
   the unit level.
