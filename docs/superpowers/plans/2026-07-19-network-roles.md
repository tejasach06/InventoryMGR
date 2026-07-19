# Network Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `VmNetwork` row a role (private/public/backup) and surface it through the VM form, VM detail, inventory table, and filter drawer.

**Architecture:** New Postgres enum plus a `NOT NULL DEFAULT 'private'` column, so the default performs the backfill. The role then threads through schemas → `_sync_networks` → API → UI. The inventory's single arbitrary IP cell becomes three role-scoped cells, and `ip_address` survives as a deprecated column-preference key aliased to `private_ip`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres 16, Next.js App Router, TanStack Query, Vitest, Playwright.

## Global Constraints

- Role values are exactly `private`, `public`, `backup`. Default `private`.
- Existing `vm_networks` rows backfill to `private`.
- Inventory shows the **first** IP of each role; the full list stays on VM detail.
- Filter facet is multi-select across all three roles.
- `ip_address` must remain an accepted column-preference key. Saved layouts
  containing it must not reset.
- ruff line length 100, rules E/F/I/UP/B. TypeScript strict.
- Test DB is built by `create_all`, so pytest never runs migrations. Migration
  changes are verified on a scratch DB (see Task 1 Step 5).

---

### Task 1: Role column and migration

**Files:**
- Modify: `backend/app/db/models.py:265-277` (`VmNetwork`), enum block near `ImportAction`
- Create: `backend/alembic/versions/0012_network_roles.py`
- Test: `backend/tests/test_vms.py`

**Interfaces:**
- Produces: `NetworkRole` StrEnum; `VmNetwork.role: Mapped[NetworkRole]`.

- [ ] **Step 1: Write the failing test**

```python
def test_network_defaults_to_private_role(db_session: Session) -> None:
    """Roles backfill and default to private, so pre-role rows stay meaningful."""
    from app.db.models import NetworkRole

    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Roled VM", external_id=None)
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", sort_order=0))
    db_session.commit()

    network = db_session.scalar(select(VmNetwork).where(VmNetwork.vm_id == vm.id))
    assert network is not None
    assert network.role == NetworkRole.private
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_vms.py::test_network_defaults_to_private_role -v
```

Expected: FAIL with `ImportError: cannot import name 'NetworkRole'`.

- [ ] **Step 3: Add the enum and column**

In `app/db/models.py`, beside the other StrEnums:

```python
class NetworkRole(StrEnum):
    private = "private"
    public = "public"
    backup = "backup"
```

In `class VmNetwork`, after the `ip_address` line:

```python
    role: Mapped[NetworkRole] = mapped_column(
        Enum(NetworkRole, name="network_role"), nullable=False, default=NetworkRole.private
    )
```

- [ ] **Step 4: Write the migration**

Create `backend/alembic/versions/0012_network_roles.py`:

```python
"""Add role to vm_networks: private/public/backup, existing rows backfill to private.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

network_role = sa.Enum("private", "public", "backup", name="network_role")


def upgrade() -> None:
    network_role.create(op.get_bind(), checkfirst=True)
    # NOT NULL + server default backfills every existing row to private in one
    # statement; no separate UPDATE needed.
    op.add_column(
        "vm_networks",
        sa.Column("role", network_role, nullable=False, server_default="private"),
    )


def downgrade() -> None:
    op.drop_column("vm_networks", "role")
    network_role.drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 5: Verify the migration on a scratch DB**

The test database is built by `create_all` and never runs migrations, so this
is the only check that 0012 actually applies.

```bash
cd backend && uv run python -c "
import psycopg
with psycopg.connect('postgresql://inventorymgr@127.0.0.1:54329/postgres', autocommit=True) as c:
    c.execute('DROP DATABASE IF EXISTS migcheck')
    c.execute('CREATE DATABASE migcheck')
"
cd backend && APP_ENV=test DATABASE_URL="postgresql+psycopg://inventorymgr@127.0.0.1:54329/migcheck" \
  uv run alembic upgrade head
```

Expected: `Running upgrade 0011 -> 0012`.

- [ ] **Step 6: Run the test and commit**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vms.py -q
git add backend/app/db/models.py backend/alembic/versions/0012_network_roles.py backend/tests/test_vms.py
git commit -m "feat(network): add role column to vm_networks

Private/public/backup, NOT NULL DEFAULT private so existing rows
backfill in place. Nothing reads it yet."
```

---

### Task 2: Thread role through schemas and services

**Files:**
- Modify: `backend/app/schemas/vms.py:148-158` (`NetworkCreate`/`NetworkRead`), `:181-185` (`NetworkUpdate`)
- Modify: `backend/app/services/vms.py:57-66` (`_sync_networks`), `:195-199` (clone)
- Test: `backend/tests/test_vms.py`

**Interfaces:**
- Consumes: `NetworkRole` from Task 1.
- Produces: `role` on the network request/response schemas.

- [ ] **Step 1: Write the failing tests**

```python
def test_vm_create_round_trips_network_roles(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    payload = vm_payload(name="Multi Role")
    payload["networks"] = [
        {"ip_address": "10.0.0.5", "role": "private", "sort_order": 0},
        {"ip_address": "203.0.113.4", "role": "public", "sort_order": 1},
    ]
    response = client.post("/api/vms", json=payload, headers=auth_headers(csrf))
    assert response.status_code == 201, response.text

    roles = {n["ip_address"]: n["role"] for n in response.json()["networks"]}
    assert roles == {"10.0.0.5": "private", "203.0.113.4": "public"}


def test_clone_preserves_network_roles(client, db_session: Session) -> None:
    """Clone rebuilds children field by field; a missed field silently resets."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Clone Source", external_id=None)
    db_session.add(
        VmNetwork(vm_id=vm.id, ip_address="203.0.113.4", role=NetworkRole.public, sort_order=0)
    )
    db_session.commit()
    csrf = login(client, "editor@example.local")

    response = client.post(f"/api/vms/{vm.id}/clone", headers=auth_headers(csrf))
    assert response.status_code == 201, response.text
    assert response.json()["networks"][0]["role"] == "public"
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_vms.py -k "network_roles" -v
```

Expected: FAIL — response networks have no `role` key.

- [ ] **Step 3: Add role to the schemas**

In `app/schemas/vms.py`, extend the import from `app.db.models` to include
`NetworkRole`, then:

```python
class NetworkCreate(BaseModel):
    ip_address: str
    role: NetworkRole = NetworkRole.private
    vlan: int | None = Field(default=None, ge=0, le=4094)
    gateway: str | None = None
    sort_order: int = 0
```

```python
class NetworkUpdate(BaseModel):
    ip_address: str | None = None
    role: NetworkRole | None = None
    vlan: int | None = Field(default=None, ge=0, le=4094)
    gateway: str | None = None
    sort_order: int | None = None
```

`NetworkRead` inherits from `NetworkCreate`, so it picks `role` up for free.

- [ ] **Step 4: Pass role through the service**

In `app/services/vms.py::_sync_networks`:

```python
        db.add(VmNetwork(
            vm_id=vm.id,
            ip_address=network.ip_address,
            role=network.role,
            vlan=network.vlan,
            gateway=network.gateway,
            sort_order=network.sort_order if network.sort_order is not None else i,
        ))
```

And in the clone loop:

```python
    for net in vm.networks:
        db.add(VmNetwork(
            vm_id=cloned.id, ip_address=net.ip_address, role=net.role, vlan=net.vlan,
            gateway=net.gateway, sort_order=net.sort_order,
        ))
```

- [ ] **Step 5: Run and commit**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/ -q
git add backend/app/schemas/vms.py backend/app/services/vms.py backend/tests/test_vms.py
git commit -m "feat(network): thread role through schemas and sync

Includes the clone path, which rebuilds children field by field and
would otherwise reset every cloned IP to private."
```

---

### Task 3: Role filter facet (backend)

**Files:**
- Modify: `backend/app/services/vms.py::apply_vm_filters` (signature near line 262)
- Modify: `backend/app/api/routes/vms.py` (query parameter passthrough)
- Test: `backend/tests/test_vm_filters.py`

**Interfaces:**
- Consumes: `NetworkRole` from Task 1.
- Produces: `ip_role: list[NetworkRole] | None` parameter on `apply_vm_filters`
  and an `ip_role` query parameter on `GET /api/vms`.

- [ ] **Step 1: Write the failing test**

```python
def test_ip_role_filter_matches_vms_having_that_role(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    public_vm = create_vm_row(db_session, editor, name="Public VM", external_id=None)
    private_vm = create_vm_row(db_session, editor, name="Private VM", external_id=None)
    db_session.add(
        VmNetwork(vm_id=public_vm.id, ip_address="203.0.113.4", role=NetworkRole.public)
    )
    db_session.add(
        VmNetwork(vm_id=private_vm.id, ip_address="10.0.0.5", role=NetworkRole.private)
    )
    db_session.commit()
    csrf = login(client, "editor@example.local")

    response = client.get("/api/vms?ip_role=public", headers=auth_headers(csrf))
    assert response.status_code == 200, response.text

    names = [vm["name"] for vm in response.json()["items"]]
    assert names == ["Public VM"]
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_vm_filters.py::test_ip_role_filter_matches_vms_having_that_role -v
```

Expected: FAIL — `ip_role` ignored, both VMs returned.

- [ ] **Step 3: Add the filter**

In `apply_vm_filters`, add the parameter alongside the other list filters:

```python
    ip_role: list[NetworkRole] | None = None,
```

and, in the body, a correlated EXISTS so a VM with several IPs is not
duplicated by the join:

```python
    if ip_role:
        stmt = stmt.where(
            select(VmNetwork.id)
            .where(VmNetwork.vm_id == Vm.id, VmNetwork.role.in_(ip_role))
            .exists()
        )
```

- [ ] **Step 4: Accept the query parameter**

In `app/api/routes/vms.py`, add `ip_role: Annotated[list[NetworkRole] | None, Query()] = None`
to the list endpoint signature and pass it into `apply_vm_filters` beside the
existing filters.

- [ ] **Step 5: Run and commit**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/ -q
git add backend/app/services/vms.py backend/app/api/routes/vms.py backend/tests/test_vm_filters.py
git commit -m "feat(network): filter VMs by IP role

Correlated EXISTS rather than a join, so a VM with several IPs in the
selected role appears once."
```

---

### Task 4: Column preference keys and the `ip_address` alias

This is the task that can break existing users. Saved layouts contain
`ip_address`, and the server rejects unknown keys.

**Files:**
- Modify: `backend/app/api/routes/preferences.py:8-35`
- Modify: `frontend/src/hooks/useColumnPreferences.ts:12-60`
- Test: `backend/tests/test_preferences.py`

**Interfaces:**
- Produces: column keys `private_ip`, `public_ip`, `backup_ip`; `ip_address`
  retained as a deprecated accepted key.

- [ ] **Step 1: Write the failing tests**

```python
def test_saved_ip_address_preference_still_accepted(client, db_session: Session) -> None:
    """Existing users have ip_address saved. Rejecting it would reset layouts."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    response = client.put(
        "/api/preferences/inventory",
        json={"columns": [{"key": "ip_address", "visible": True, "order": 6}]},
        headers=auth_headers(csrf),
    )
    assert response.status_code == 200, response.text


def test_role_ip_columns_are_valid_keys(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    response = client.put(
        "/api/preferences/inventory",
        json={
            "columns": [
                {"key": "private_ip", "visible": True, "order": 6},
                {"key": "public_ip", "visible": False, "order": 7},
                {"key": "backup_ip", "visible": False, "order": 8},
            ]
        },
        headers=auth_headers(csrf),
    )
    assert response.status_code == 200, response.text
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_preferences.py -k "ip" -v
```

Expected: the role-columns test FAILS with 422 (unknown key). The
`ip_address` test passes already — it is a regression guard for Step 3.

- [ ] **Step 3: Update the backend key list**

In `app/api/routes/preferences.py`, replace the `ip_address` entry in
`DEFAULT_COLUMNS` with the three role columns:

```python
    {"key": "private_ip", "visible": True, "order": 6},
```

and append, after `created_at`:

```python
    {"key": "public_ip", "visible": False, "order": 25},
    {"key": "backup_ip", "visible": False, "order": 26},
```

Then widen the accepted set so old saved layouts keep validating:

```python
# ip_address predates roles. Saved layouts still contain it, so it stays an
# accepted key and renders as the private IP column.
DEPRECATED_COLUMN_KEYS = {"ip_address"}
ALL_COLUMN_KEYS = {c["key"] for c in DEFAULT_COLUMNS} | DEPRECATED_COLUMN_KEYS
```

- [ ] **Step 4: Mirror in the frontend and alias on read**

`DEFAULT_COLUMNS` in `useColumnPreferences.ts` duplicates the backend list —
the same drift that made `backup_location` unimportable in spec 1. Apply the
identical three entries, add labels:

```ts
  private_ip: 'Private IP',
  public_ip: 'Public IP',
  backup_ip: 'Backup IP',
```

and normalize stored preferences as they load, so a saved `ip_address` keeps
its position and visibility:

```ts
function aliasLegacyKeys(columns: ColumnConfig[]): ColumnConfig[] {
  return columns.map((col) =>
    col.key === 'ip_address' ? { ...col, key: 'private_ip' } : col,
  );
}
```

Call it wherever fetched preferences are merged into state.

- [ ] **Step 5: Run and commit**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_preferences.py -q
cd frontend && bun run test && bun run typecheck
git add backend/app/api/routes/preferences.py backend/tests/test_preferences.py \
        frontend/src/hooks/useColumnPreferences.ts
git commit -m "feat(network): role-scoped IP columns, ip_address kept as alias

Saved layouts contain ip_address and the server rejects unknown keys, so
dropping it would invalidate every stored preference. It stays accepted
and maps to private_ip with order and visibility preserved."
```

---

### Task 5: Role in the VM form and detail page

**Files:**
- Modify: `frontend/src/api/client.ts` (network types)
- Modify: `frontend/src/routes/VmFormPage.tsx`, `frontend/src/routes/VmDetailPage.tsx`
- Modify: `frontend/src/lib/vmForm.ts` (blank-row factory)
- Test: `frontend/src/test/VmFormPage.test.tsx`, `frontend/src/test/VmDetailPage.test.tsx`

**Interfaces:**
- Consumes: `role` from the API (Task 2).
- Produces: `NetworkRole` TS type.

- [ ] **Step 1: Write the failing test**

```tsx
it('defaults a new IP row to the private role and submits the chosen role', async () => {
  const create = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm());
  renderWithProviders(<VmFormPage />);

  fireEvent.click(screen.getByRole('button', { name: /add ip/i }));
  const roleSelect = screen.getByLabelText(/ip role/i);
  expect(roleSelect).toHaveValue('private');

  fireEvent.change(roleSelect, { target: { value: 'public' } });
  fireEvent.change(screen.getByLabelText(/ip address/i), { target: { value: '203.0.113.4' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(create).toHaveBeenCalled());
  const payload = create.mock.calls[0][0];
  expect(payload.networks?.[0]).toMatchObject({ ip_address: '203.0.113.4', role: 'public' });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && bun run test src/test/VmFormPage.test.tsx
```

Expected: FAIL — no element labelled "IP role".

- [ ] **Step 3: Add the type**

In `frontend/src/api/client.ts`:

```ts
export type NetworkRole = 'private' | 'public' | 'backup';
```

Add `role: NetworkRole;` to the network read interface and
`role?: NetworkRole;` to the network payload interface.

- [ ] **Step 4: Add the selector**

In the blank-network factory in `src/lib/vmForm.ts`, add `role: 'private'`.

In `VmFormPage.tsx`, beside each IP row's address input:

```tsx
<label className="sr-only" htmlFor={`network-role-${index}`}>IP role</label>
<select
  id={`network-role-${index}`}
  value={network.role ?? 'private'}
  onChange={(e) => updateNetwork(index, { role: e.target.value as NetworkRole })}
>
  <option value="private">Private</option>
  <option value="public">Public</option>
  <option value="backup">Backup</option>
</select>
```

In `VmDetailPage.tsx`, render the role beside each address so the full
per-role list is visible where the table only shows the first.

- [ ] **Step 5: Run and commit**

```bash
cd frontend && bun run test && bun run typecheck
git add frontend/src/api/client.ts frontend/src/routes/VmFormPage.tsx \
        frontend/src/routes/VmDetailPage.tsx frontend/src/lib/vmForm.ts frontend/src/test
git commit -m "feat(network): choose IP role in the VM form and show it on detail"
```

---

### Task 6: Three role columns in the inventory table

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx:281`
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: column keys from Task 4, `role` from Task 5.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders the first IP of each role in its own column', async () => {
  vi.spyOn(api, 'listVms').mockResolvedValue({
    items: [
      makeVm({
        name: 'web-01',
        networks: [
          { id: 'n1', vm_id: 'vm-1', ip_address: '10.0.0.5', role: 'private', sort_order: 0 },
          { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.6', role: 'private', sort_order: 1 },
          { id: 'n3', vm_id: 'vm-1', ip_address: '203.0.113.4', role: 'public', sort_order: 2 },
        ],
      }),
    ],
    total: 1,
  });
  renderWithProviders(<InventoryPage />);

  // First private IP only; the second lives on the detail page.
  expect(await screen.findByText('10.0.0.5')).toBeInTheDocument();
  expect(screen.queryByText('10.0.0.6')).not.toBeInTheDocument();
  expect(screen.getByText('203.0.113.4')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && bun run test src/test/InventoryPage.test.tsx
```

Expected: FAIL — `203.0.113.4` not rendered; only the first network shows.

- [ ] **Step 3: Replace the cell**

Add a helper above the component:

```tsx
function firstIpForRole(vm: Vm, role: NetworkRole): string {
  return vm.networks?.find((n) => n.role === role)?.ip_address ?? '—';
}
```

Replace line 281's single cell with:

```tsx
{col.key === 'private_ip' && <span className={monoClass}>{firstIpForRole(vm, 'private')}</span>}
{col.key === 'public_ip' && <span className={monoClass}>{firstIpForRole(vm, 'public')}</span>}
{col.key === 'backup_ip' && <span className={monoClass}>{firstIpForRole(vm, 'backup')}</span>}
```

- [ ] **Step 4: Run and commit**

```bash
cd frontend && bun run test && bun run typecheck
git add frontend/src/routes/InventoryPage.tsx frontend/src/test/InventoryPage.test.tsx
git commit -m "feat(network): three role-scoped IP columns in the inventory table

Replaces networks[0].ip_address, which showed whichever row sorted first."
```

---

### Task 7: Role facet in the filter drawer

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx:32-45` (filter names, `emptyFilters`)
- Modify: `frontend/src/components/filters/filterConfig.ts:12-44`
- Test: `frontend/src/test/filterConfig.test.ts`, `frontend/src/test/InventoryToolbar.test.tsx`

**Interfaces:**
- Consumes: the `ip_role` query parameter from Task 3.

- [ ] **Step 1: Write the failing test**

```ts
it('offers ip_role as a multi-select advanced filter', () => {
  expect(advancedFilterConfig.ip_role).toEqual({
    kind: 'multiSelect',
    options: ['private', 'public', 'backup'],
  });
  expect(advancedFilterLabels.ip_role).toBe('IP Role');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && bun run test src/test/filterConfig.test.ts
```

Expected: FAIL — `advancedFilterConfig.ip_role` is undefined.

- [ ] **Step 3: Register the filter**

In `InventoryPage.tsx`, add `'ip_role'` to `advancedFilterNames` (line 33) and
`ip_role: []` to `emptyFilters()`.

In `filterConfig.ts`:

```ts
  ip_role: { kind: 'multiSelect', options: ['private', 'public', 'backup'] as const },
```

```ts
  ip_role: 'IP Role',
```

`Filters` is `Record<FilterName, string[]>` and the query builder iterates
`filterNames`, so the parameter reaches the API without further wiring —
confirm this in Step 4 rather than assuming it.

- [ ] **Step 4: Verify end to end**

```bash
cd frontend && bun run test && bun run typecheck
```

Then, with the app running, apply the facet and confirm the request carries
`ip_role=public` and the result set narrows. If the query builder does not
pass it through, wire it beside the other list-valued filters.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/InventoryPage.tsx frontend/src/components/filters/filterConfig.ts \
        frontend/src/test
git commit -m "feat(network): filter the inventory by IP role"
```

---

### Task 8: Full verification

- [ ] **Step 1: Backend and frontend suites**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q
cd backend && uv run ruff check app tests
cd frontend && bun run test && bun run typecheck
```

- [ ] **Step 2: Playwright**

```bash
cd frontend && bunx playwright test
```

`e2e/inventory.spec.ts` and `e2e/ui-changes.spec.ts` both touch IP fields.
`ui-changes.spec.ts:205` ("IP address add/remove works on VM detail page")
is the likely breakage — the row now has a role selector. Update it to the
new markup rather than loosening the assertion.

- [ ] **Step 3: Manual check**

The suite cannot see a reset column layout. Before merging:

1. Open the inventory with a saved layout that predates this work.
2. Confirm the IP column still appears, in its old position, now titled
   Private IP.
3. Open the column editor; confirm Public IP and Backup IP appear hidden.
4. Add a public IP to a VM; confirm it shows in Public IP, not Private IP.
5. Filter by IP role = public; confirm only that VM returns.

Step 2 is the one that matters — it is the only check that existing users'
layouts survived.

---

## Deviations from this plan, as built

The plan was written against an imperfect reading of the codebase. Where the
code disagreed, the code won:

1. **`backend/tests/test_vms.py` does not exist.** Task 1 and 2 tests went to a
   new `backend/tests/test_vm_networks.py`, matching the per-topic pattern of
   `test_vm_type_lifecycle.py`.
2. **Task 4's alias design was wrong and would have broken saved layouts.**
   Aliasing on the frontend leaves `get_columns` merging `private_ip` in as a
   *second* entry, and the next save fails the server's duplicate-key check.
   Built instead as a server-side rewrite in `get_columns`, applied *before*
   the merge. No frontend alias function exists.
3. **The preferences route is `/api/user/preferences/{page_key}`**, not
   `/api/preferences/{page_key}`.
4. **Tasks 4 and 6 were committed together** (`cba1d92`). Task 4 renames the
   column key and Task 6 renders it; split, Task 4 alone leaves the inventory
   IP column blank — `InventoryIpColumn.test.tsx` failed at exactly that point.
5. **`ip_role` was declared on `VmFilterParams`**, not on the list endpoint
   signature. Export shares that dependency, so the planned version would have
   left CSV export silently ignoring the facet.
6. **`role` is required, not optional, on the TS `Network` interface.** This
   caught `VmDetailPage`'s add-IP mutation building a role-less network — an
   optional field would have compiled and posted it.
7. **`AddRowForm` gained optional `options` select fields** rather than the VM
   detail page growing a second bespoke form.
8. **`ip_role` had to be added to `filterGroups`.** `advancedFilterConfig` and
   `advancedFilterLabels` are exhaustive `Record`s so TypeScript forces those,
   but `filterGroups` is a plain array — a facet omitted from it compiles and
   never renders.
9. **`ui-changes.spec.ts:205` did not break** as Task 8 predicted. It fills the
   add-IP row by placeholder and the role select defaults to private.
