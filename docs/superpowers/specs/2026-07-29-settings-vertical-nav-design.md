# Settings Page: Trim Quick-Select Tabs, Vertical Nav

## Goal
Simplify `/settings`: remove the CPU cores, Datacenter, Disk size, and Operating system quick-select editors. Keep Cluster's quick-select editor, Users, and Notifications. Replace the current horizontal tab-strip with a vertical sidebar menu.

## Scope
`frontend/src/routes/SettingsPage.tsx` and `frontend/src/test/SettingsPage.test.tsx`. No backend/API changes — the `cpu`/`datacenter`/`disk`/`os` dropdown-option endpoints and DB data remain untouched and still power VM-form suggestions; they simply lose their admin editor UI. Admins accept this: those lists are stable enough not to need in-app editing.

## Changes

1. **`CATEGORY_ORDER`**: `['cpu', 'datacenter', 'disk', 'os', 'cluster']` → `['cluster']`.
2. **`CATEGORY_LABELS`**: drop the `cpu`/`datacenter`/`disk`/`os` entries, keep `cluster: 'Cluster'`.
3. **Default active tab**: `useState<DropdownCategory | 'notifications'>('cpu')` → `useState<DropdownCategory | 'notifications'>('cluster')`.
4. **`grouped` memo**: only tracks `{ cluster: [] }`; drop the `.sort` call for `cpu` (that sort existed solely for the numeric CPU-cores category, now gone).
5. **Layout**: replace the horizontal `role="tablist"` bottom-border strip with a two-column vertical layout inside the existing `cardClass` card:
   - Left column: `role="tablist" aria-orientation="vertical"` vertical `flex flex-col` list containing three items — **Cluster** (tab, opens `CategoryPanel`), **Users** (external `Link` to `/users`, unchanged behavior/label), **Notifications** (tab, opens `NotificationsPanel`).
   - Active-item styling switches from bottom-border-on-hover to left-border + subtle background highlight (`border-l-2 border-[var(--color-accent)] bg-[...]`), consistent with the Instrument Panel system's flat-by-default + accent-for-active convention.
   - Right column: existing panel content (`CategoryPanel` / `NotificationsPanel`), unchanged internally.
   - `CategoryPanel`, `NotificationsPanel`, `OptionRow` components: no internal changes, only what wraps them.
6. **Tests** (`SettingsPage.test.tsx`): remove all assertions/tests referencing the `CPU cores`, `Datacenter`, `Disk size (GB)`, `Operating system` tabs and their CRUD flows (add/edit/remove option). Keep/adjust: cluster tab presence and behavior, Users link, Notifications panel tests. Add one assertion that the tablist has `aria-orientation="vertical"`.

## Non-goals
- No change to dropdown-option API/schema/backend.
- No change to the VM form's use of cpu/datacenter/disk/os suggestion lists.
- No change to Users page or Notifications panel internals.
