# CSV Import Correctness — Design

Date: 2026-07-19
Status: Approved, not yet implemented
Scope: Spec 1 of 3 (see "Follow-on work")

## Problem

The CSV import update path silently destroys data.

`normalize_csv_row` writes every known field into its `normalized` dict
regardless of whether the CSV supplied that column. `_commit_row` passes the
dict to `VmUpdate.model_validate`, which marks every key as explicitly set.
`update_vm`'s `exclude_unset=True` therefore protects nothing.

An operator uploading a four-column CSV to correct owners:

```csv
name,platform,cluster,owner
Existing App,proxmox,pve-cluster-a,bob
```

gets `owner` applied and, on the same row, `fqdn`, `description`,
`datacenter`, `security_remarks` and every date blanked; `status` reset to
`unknown`; `environment` to `production`; `criticality` to `medium`;
`cpu_cores` and `memory_mb` to `0`; every boolean to `False`; `tags` emptied.
The preview reports `update` with no error. The audit trail records it as a
legitimate edit.

Reproduced against real Postgres in
`backend/tests/test_csv_imports.py::test_partial_column_update_preserves_unmentioned_fields`:

```
assert refreshed.fqdn == "existing-app.corp.example"
AssertionError: assert None == 'existing-app.corp.example'
```

Two secondary defects in the same area:

- `_commit_row` attaches `disk_name`/`ip_address` only on the create branch. On
  update they are parsed, shown in the preview table, then discarded.
- `TEMPLATE_HEADERS` (frontend) includes `backup_location`, which is not in
  backend `ALL_HEADERS`. Downloading the template, filling it in and uploading
  it returns `400 CSV has unsupported headers: backup_location`. The template
  also omits supported headers: `lifecycle`, `ha_enabled`, `technical_owner`,
  `os_name`, `last_verified_at`.

## Users

Two flows, established during design:

- **A — Seed.** One admin, bulk create, a few times a year.
- **B — Reconcile.** A few editors, monthly, against an export from this app,
  from the hypervisor, or from a hand-maintained spreadsheet. The update path
  dominates and carries the risk.

## Decisions

**Update semantics.** An absent column and a blank cell both mean "do not
touch this field". CSV never clears a field; clearing is done in the VM edit
form. There is no clear-sentinel token — rejected to avoid escaping questions
(a real value of `__CLEAR__`), a third preview state, and documentation
surface, for a capability with no established need.

Because absent and blank are equivalent, the implementation needs one rule —
"a value is supplied when its cell is non-blank" — and does not need to track
which headers were present.

**Blank on create still means default.** A new row needs a value, so
`DEFAULTS` applies on create. Blank means skip on update and default on
create. This asymmetry is intentional and must be stated in the page help
text.

**`unchanged` is a fifth action.** A row matching an existing VM with no
differing supplied values is `unchanged`, not `update`. A faithful round-trip
then reads `0 create · 0 update · 4,987 unchanged`, and `create`/`update`
counts come to mean "will actually change something". Under the alternative
the same file reads `4,987 update`, which trains operators to ignore the
number. Secondary benefit: collapsing unchanged rows removes most of the
pressure from rendering 5000 rows.

**Unrecognized columns are ignored and reported**, not rejected. Hypervisor
exports carry columns this app does not model; rejecting the whole file means
hand-deleting columns before every monthly import. Silent ignoring is also
wrong — a typo'd header (`ownr`) would quietly drop a column the operator
meant to import. Ignoring plus an explicit report keeps the file working while
putting the typo in front of the operator.

**Disk/IP on update: attach, additively.** Add the disk or IP if the VM has no
matching one; leave existing children alone. Replace semantics were rejected:
a single-disk-per-row CSV under replace would delete two disks from a
three-disk VM that the import never mentioned — the same class of silent
destruction as the primary bug.

One CSV row carries one disk and one IP, so a multi-disk VM cannot be fully
expressed. This is honestly "additive, best-effort"; the help text must say
multi-disk VMs are managed in the VM form. Multi-value support is spec 3.

## Design

### Backend

**`normalize_csv_row`** returns a dict of supplied values only. Parse helpers
(`_parse_bool`, `_parse_int`, `_parse_date`, `_parse_list`) currently collapse
blank to `False`/`0`/`None`/`[]`; they change to signal absence so the caller
omits the key. Validation runs only on supplied values — a blank cell is never
an error.

Required headers (`name`, `platform`, `cluster`) are unaffected: they are
required non-blank, so they are always supplied.

**`_commit_row`** create branch merges defaults: `{**DEFAULTS, **normalized}`.
Update branch passes `normalized` unchanged, so `exclude_unset=True` in
`update_vm` now does the work it was always meant to do.

**Preview classification** compares supplied values against the matched VM:

- no match → `create`
- match, at least one supplied value differs → `update`
- match, no supplied value differs → `unchanged`

**`parse_csv_bytes`** stops raising on unsupported headers and returns the
ignored list alongside the rows.

### Schema

One Alembic revision:

- `ImportAction` enum gains `unchanged`.
- `CsvImportRow.changes` — JSON, `{field: [old, new]}` for update rows.
- `CsvImportBatch.field_changes` — JSON, `{field: count}` across the batch.
- `CsvImportBatch.ignored_columns` — JSON, list of header names.

`changes` is computed during preview classification, which already performs
the comparison, so storing it costs nothing extra.

### Frontend

- Fifth summary card, `unchanged`. Unchanged rows collapsed by default.
- Per-row changed-field count on update rows (`update · 3 fields`), expandable
  to old → new.
- Batch-level rollup above the table: "owner on 40 VMs, status on 3". This is
  the safety net — it surfaces an unintended mass change from outside the
  import logic, without relying on the semantics fix being correct.
- Ignored-columns warning when the list is non-empty.
- `TEMPLATE_HEADERS` corrected: `backup_location` removed, missing supported
  headers added.

### Tests

- The reproduction test above, passing.
- Blank cell in a present column does not overwrite (distinct from absent
  column, same expected outcome).
- Create with blank cells still applies `DEFAULTS`.
- Round-trip of an unchanged export classifies every row `unchanged`.
- Unrecognized column is ignored, reported, and does not fail the import.
- Disk/IP attach on update; existing children untouched.
- `TEMPLATE_HEADERS` equals backend `ALL_HEADERS`. This is what makes the
  template fix permanent rather than a one-off correction.

## Out of scope

- **All-or-nothing commit.** Nothing in the two flows calls for partial
  commit, and it complicates rollback.
- **Row pagination.** The `unchanged` collapse removes most of the pressure.
  Revisit if it is still slow with real data.
- **Column mapping UI.** Considered and dropped during design.

## Follow-on work

- **Spec 2 — Network roles.** `VmNetwork` has no role column. Add one plus an
  enum and a backfill migration (existing rows → private), then propagate
  through schemas, VM form, VM detail, the inventory IP column, and filters.
  Full-stack, per decision.
- **Spec 3 — Multi-child CSV.** Inline `name:size;…` disk pairing, and three
  role-scoped IP columns (`private_ip`, `backup_ip`, `public_ip`) each holding
  multiple values. Depends on spec 1 (skip semantics) and spec 2 (role
  column). Separator standardizes on `;`, matching tags — inline pairing was
  chosen over parallel `disk_name`/`disk_gb` columns because parallel lists
  shear silently when someone edits one column and not the other.
