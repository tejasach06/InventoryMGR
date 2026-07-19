# Spec 2 — Network roles

**Status:** implemented on `feat/inventory-simplify` (913a1ef…c9f33be). Never
formally approved — implementation proceeded on the user's instruction to
continue. One manual check outstanding: a pre-existing saved column layout must
be confirmed intact against real data (see the plan's Task 8, step 3).
**Depends on:** spec 1 (CSV import correctness) — merged
**Blocks:** spec 3 (multi-child CSV), which needs the role column to exist

## Problem

`VmNetwork` has `ip_address`, `vlan`, `gateway`, `sort_order` and no notion of
what an address is *for*. Operators distinguish private, public, and backup
addresses, but the model cannot, so:

- The inventory table renders `vm.networks?.[0]?.ip_address`
  (`InventoryPage.tsx:281`) — whichever row sorted first. Arbitrary.
- Nothing can answer "which VMs are reachable from the internet".
- Spec 3 wants three role-scoped CSV columns and has no column to write to.

## Decisions

Pinned with the user during brainstorming:

| Question | Decision |
|---|---|
| Role values | `private`, `public`, `backup` |
| Backfill for existing rows | all → `private` |
| Inventory table | three columns — `private_ip`, `public_ip`, `backup_ip` |
| Multi-IP display in table | first IP of that role only; full list on VM detail |
| Filter drawer | full role facet, multi-select across the three roles |

## Architecture

### Database

New `NetworkRole` StrEnum in `db/models.py` (`private`/`public`/`backup`),
new `role` column on `VmNetwork`, `nullable=False`, default `private`.

Migration `0012_network_roles.py`:

```
CREATE TYPE network_role AS ENUM ('private', 'public', 'backup');
ALTER TABLE vm_networks ADD COLUMN role network_role NOT NULL DEFAULT 'private';
```

The server default doubles as the backfill — existing rows become `private`
without a separate UPDATE. Downgrade drops the column, then the type.

### Backend

- `schemas/vms.py`: `role: NetworkRole = NetworkRole.private` on
  `NetworkCreate`; `role: NetworkRole | None = None` on `NetworkUpdate`;
  `NetworkRead` inherits it.
- `services/vms.py::_sync_networks` (line 57) passes `role` through; the
  clone path at line 195 copies it.
- `services/vms.py::apply_vm_filters` gains a role facet: given selected
  roles, match VMs having at least one `VmNetwork` in any of them. Existing
  IP substring search at line 278 is unchanged.

### Frontend

- `api/client.ts`: `NetworkRole` type; `role` on the network interfaces.
- VM form and VM detail: role selector per IP row, defaulting to private.
- `InventoryPage.tsx:281`: replace the single `ip_address` cell with three
  cells, each rendering the first network of its role, `—` when absent.
- `filters/filterConfig.ts` + `ActiveFilterChips.tsx`: role facet.

### Column preferences — the migration hazard

Column keys are validated server-side against a canonical list
(`api/routes/preferences.py:15`), and `test_put_rejects_unknown_column_key`
enforces the rejection. Users have **saved** preferences containing
`ip_address`. Dropping that key from the allowed list would make every saved
layout contain an unknown key.

Handling: keep `ip_address` in the allowed list as a deprecated alias.
On read, a stored `ip_address` entry maps to `private_ip` with its visibility
and order preserved; the two new keys append hidden. Nothing rejects, no
layout resets, and operators who never touch the column editor see their old
IP column keep working — now well-defined as the private address.

This is the piece the original follow-on note missed. It is the only part of
spec 2 that can break something a user already has.

## Testing

- Migration applies from base and backfills existing rows to `private`
  (verify on a scratch DB — the test suite builds schema via `create_all` and
  never exercises migrations).
- `_sync_networks` round-trips role; clone copies it.
- Role facet returns VMs having an IP in any selected role, and no others.
- A saved preference containing `ip_address` survives the upgrade: still
  accepted, maps to `private_ip`, order and visibility intact.
- Inventory table renders the first IP per role and `—` for absent roles.

## Out of scope

- CSV import of roles — that is spec 3.
- Per-role validation (public addresses need not be non-RFC1918).
- Reordering IPs across roles in the form beyond existing `sort_order`.
