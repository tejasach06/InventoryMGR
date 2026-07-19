# Inventory Page Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip redundant chrome from the inventory page — stat tiles, context panel, presets, Actions column, and semantic status/criticality color — so the page is the toolbar plus the table.

**Architecture:** Pure frontend deletion. Five independent removals across `frontend/src/routes/InventoryPage.tsx`, `frontend/src/components/`, and the Vitest suites that assert the removed UI. No backend, no API, no schema changes. Each task deletes one thing and leaves its test suite green.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, Tailwind, Vitest + Testing Library, Playwright.

## Global Constraints

- All commands run inside `devbox shell` from the repo root unless a `cd` is shown.
- Vitest enforces **80% coverage** on lines/statements/functions/branches. Deleting a component also deletes its tests — coverage must still pass after each task (`bun run test` reports it).
- Real UI lives in `src/routes/*.tsx`; `src/app/**` are thin shells and are excluded from Vitest coverage. Do not add logic to `src/app/`.
- TypeScript strict: no unused imports. After removing JSX, remove the now-unused import from the top of the file or `bun run typecheck` fails.
- Playwright: chromium is already installed as a **system package**. Run headless with the system browser — do not download browsers. `playwright-mcp` or `chrome-devtools` MCP is acceptable for interactive spot-checks.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`).

## Decisions locked in with the user

| Item | Decision |
|------|----------|
| Search bar | Already exists (`InventoryToolbar.tsx:85`). **No work.** |
| Presets | **Remove entirely** — `presetFilters`, the drawer Presets section, and the dead `useFilterPresets` hook + file. |
| Fleet Pulse + card below it | **Remove the whole `ContextPanel`.** Table goes full width. Bulk actions handled by the existing bulk bar, which must now also show on desktop. |
| Actions column | **Remove.** Name cell already links to the detail page. |
| Status/criticality colors | Colored `Badge` kept **only for platform**; tags keep their existing neutral chip look. Status, criticality, environment, lifecycle, os_family, health render as plain text on the inventory page. Remove the `--dark-glow` badge glow. |

## File Structure

**Modified**
- `frontend/src/routes/InventoryPage.tsx` — delete stat strip, `ContextPanel` usage, Actions column, non-platform badges, dead preset hook usage; unwrap the table from its 70/30 flex layout; make the bulk bar desktop-visible.
- `frontend/src/components/filters/FilterDrawer.tsx` — delete the Presets section.
- `frontend/src/components/filters/filterConfig.ts` — delete `presetFilters`.
- `frontend/src/components/filters/ActiveFilterChips.tsx` — neutral chips.
- `frontend/src/app/globals.css` — delete the `--dark-glow` token and its rule.
- `frontend/src/test/InventoryToolbar.test.tsx`, `frontend/src/test/filterConfig.test.ts`, `frontend/src/test/InventoryPage.test.tsx` — drop assertions for removed UI, add assertions that it is gone.

**Deleted**
- `frontend/src/components/ContextPanel.tsx`
- `frontend/src/hooks/useFilterPresets.ts`

---

### Task 1: Remove the quick-stats tile strip

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx:431-453` (the tile grid), `:408-413` (the `stats` object), `:24` (`statTileClass` import)
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `stats` object is replaced by a plain `total` local; later tasks read `total` in the results-count line.

- [ ] **Step 1: Write the failing test**

Read the top of `frontend/src/test/InventoryPage.test.tsx` first to learn the existing render-helper name. Append this inside the existing top-level `describe` block, substituting that helper name for `renderInventory`:

```tsx
  it('does not render the redundant quick-stat tiles', async () => {
    renderInventory();
    expect(await screen.findByText(/of .* shown/)).toBeInTheDocument();
    expect(screen.queryByText('Total VMs')).not.toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg Health')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx`
Expected: FAIL — `Total VMs` found in the document.

- [ ] **Step 3: Delete the tile strip**

In `frontend/src/routes/InventoryPage.tsx`, delete the entire block from the comment `{/* Bento quick-stats strip …` through its closing `</div>` (lines 431-453).

Replace the `stats` object (lines 408-413) with:

```tsx
  const items = vms.data?.items ?? [];
  const total = vms.data?.total ?? items.length;
```

Update the count line (was line 465) to:

```tsx
          <p className="eyebrow-label">
            {vms.data ? `${items.length} of ${total} shown` : 'Loading…'}
          </p>
```

Remove `statTileClass` from the `../components/ui` import list at the top of the file.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/InventoryPage.tsx frontend/src/test/InventoryPage.test.tsx
git commit -m "refactor(inventory): drop redundant quick-stat tiles"
```

---

### Task 2: Remove the ContextPanel (Fleet Pulse + preview/bulk card)

**Files:**
- Delete: `frontend/src/components/ContextPanel.tsx`
- Modify: `frontend/src/routes/InventoryPage.tsx:36` (import), `:471-505` (layout), `:333` + `:485` (`activeVmId` state), `:536` (bulk bar)
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: the `total` / `items` locals from Task 1.
- Produces: `VmTable` no longer accepts `activeVmId` / `onActivate`; Task 3 edits `VmTable` and must not expect those props.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/InventoryPage.test.tsx`:

```tsx
  it('renders no context panel and shows bulk actions when rows are selected', async () => {
    renderInventory();
    await screen.findByText(/of .* shown/);
    expect(screen.queryByLabelText('Inventory context panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet Pulse')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing previewed')).not.toBeInTheDocument();

    const checkboxes = await screen.findAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);
    expect(await screen.findByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();
  });
```

Add `import userEvent from '@testing-library/user-event';` at the top of the test file only if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx`
Expected: FAIL — `Inventory context panel` is present.

- [ ] **Step 3: Delete ContextPanel and simplify the layout**

```bash
rm frontend/src/components/ContextPanel.tsx
```

In `frontend/src/routes/InventoryPage.tsx`:

Remove `import { ContextPanel } from '../components/ContextPanel';`.

Remove the state line:

```tsx
  const [activeVmId, setActiveVmId] = useState<string | null>(null);
```

Replace the whole results block (the `vms.data && vms.data.items.length > 0 ? ( … ) : null` region, lines 471-505) with:

```tsx
        {vms.data && vms.data.items.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <VmTable
                vms={vms.data.items}
                columns={visibleColumns}
                selectedIds={selectedIds}
                onToggle={toggleSelect}
                onToggleAll={toggleSelectAll}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {vms.data.items.map((vm) => (
                <VmCard key={vm.id} vm={vm} />
              ))}
            </div>
          </>
        ) : null}
```

Make the bulk bar show on desktop too — drop `lg:hidden` and fix the stale comment:

```tsx
      {/* Bulk action bar — the only surface for bulk actions now that the
          context panel is gone. */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-40 bulk-bar" role="toolbar" aria-label="Bulk actions">
```

- [ ] **Step 4: Strip the now-dead props from VmTable**

In the `VmTable` component: delete the `activeVmId` and `onActivate` parameters and their type entries, delete `const isActive = activeVmId === vm.id;`, delete the `onClick` handler on the `<tr>`, and reduce the row class to:

```tsx
                className={cn(
                  tableRowClass,
                  isSelected && 'bg-[var(--color-accent)]/10'
                )}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd frontend && bun run test && bun run typecheck`
Expected: PASS. If a test elsewhere imports `ContextPanel`, delete that test — the component is gone.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(inventory): remove context panel, full-width table"
```

---

### Task 3: Remove the Actions column

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx` — the `<th className="px-4 py-3 w-24">Actions</th>` header and the trailing `<td>` with the View/Edit icon links
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: the `VmTable` signature from Task 2 (no `activeVmId` / `onActivate`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/InventoryPage.test.tsx`:

```tsx
  it('has no Actions column in the table header', async () => {
    renderInventory();
    await screen.findByText(/of .* shown/);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View details')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx`
Expected: FAIL — `Actions` columnheader found.

- [ ] **Step 3: Delete the column**

In `frontend/src/routes/InventoryPage.tsx`, delete the header cell:

```tsx
            <th className="px-4 py-3 w-24">Actions</th>
```

and delete the entire trailing body cell of each row — the `<td className="px-4 py-3">` containing `<div className="row-actions …>` with the View-details and Edit `<Link>`s.

`Link` stays imported — the name cell and the empty states still use it.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/InventoryPage.tsx frontend/src/test/InventoryPage.test.tsx
git commit -m "refactor(inventory): drop redundant Actions column"
```

---

### Task 4: Remove presets end to end

**Files:**
- Delete: `frontend/src/hooks/useFilterPresets.ts`
- Modify: `frontend/src/components/filters/FilterDrawer.tsx:16` (import), `:81-83` (`applyPreset`), `:203-218` (Presets section)
- Modify: `frontend/src/components/filters/filterConfig.ts:74-79` (`presetFilters`)
- Modify: `frontend/src/routes/InventoryPage.tsx:34` (import), `:335` (hook call), `:336` (`saveName` state)
- Test: `frontend/src/test/InventoryToolbar.test.tsx:109,140`; `frontend/src/test/filterConfig.test.ts:9,51-57`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `filterConfig.ts` no longer exports `presetFilters`; nothing may import it afterwards.

- [ ] **Step 1: Update the tests to assert presets are gone**

In `frontend/src/test/InventoryToolbar.test.tsx`, inside the "opens the filter drawer with every filter group inside" test, replace:

```tsx
    expect(within(dialog).getByRole('group', { name: 'Filter presets' })).toBeInTheDocument();
```

with:

```tsx
    expect(within(dialog).queryByRole('group', { name: 'Filter presets' })).not.toBeInTheDocument();
```

Delete the whole `it('stages a preset instead of applying it immediately', …)` test (lines 140-152).

In `frontend/src/test/filterConfig.test.ts`: remove `presetFilters,` from the import block and delete the whole `it('only references known filter names in presets', …)` test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && bun run test src/test/InventoryToolbar.test.tsx src/test/filterConfig.test.ts`
Expected: FAIL — `Filter presets` group still present in the drawer.

- [ ] **Step 3: Delete the preset code**

```bash
rm frontend/src/hooks/useFilterPresets.ts
```

In `frontend/src/components/filters/filterConfig.ts`, delete the whole `export const presetFilters: { id: string; label: string; filters: Partial<Filters> }[] = [ … ];` block.

In `frontend/src/components/filters/FilterDrawer.tsx`: remove `presetFilters,` from the `./filterConfig` import, delete the `applyPreset` function, and delete the entire Presets section:

```tsx
        <section className="space-y-2">
          <span className={labelClass}>Presets</span>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Filter presets">
            …
          </div>
        </section>
```

If `labelClass` is now unused in that file, remove its import too — typecheck will tell you.

In `frontend/src/routes/InventoryPage.tsx`, delete:

```tsx
import { useFilterPresets } from '../hooks/useFilterPresets';
```

```tsx
  const { presets, savePreset, deletePreset } = useFilterPresets<Filters, Record<string, string>>('inventory_presets');
  const [saveName, setSaveName] = useState('');
```

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `cd frontend && bun run test && bun run typecheck`
Expected: PASS, no unused-import or missing-export errors.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(inventory): remove filter presets entirely"
```

---

### Task 5: Drop status/criticality color and the badge glow

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx` — `VmTable` cell renderers and `VmCard`
- Modify: `frontend/src/components/filters/ActiveFilterChips.tsx` — neutral chips
- Modify: `frontend/src/app/globals.css:36` and `:332-335` — the `--dark-glow` token and rule
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: the `VmTable` and `VmCard` shapes from Tasks 2-3.
- Produces: nothing new. The shared `Badge` in `components/ui.tsx` is **not** modified — Dashboard and VM-detail keep their colored badges.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/InventoryPage.test.tsx`:

```tsx
  it('renders status and criticality as plain text, keeping only the platform badge coloured', async () => {
    renderInventory();
    await screen.findByText(/of .* shown/);
    const status = await screen.findByTestId('cell-status');
    expect(status.querySelector('span[style*="--color-status"]')).toBeNull();

    const criticality = await screen.findByTestId('cell-criticality');
    expect(criticality.querySelector('span[style*="--color-criticality"]')).toBeNull();

    const platform = await screen.findByTestId('cell-platform');
    expect(platform.querySelector('span[style*="--color-platform"]')).not.toBeNull();
  });
```

This relies on the `data-testid` attributes added in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/InventoryPage.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="cell-status"]`.

- [ ] **Step 3: Replace non-platform badges with plain text**

In `frontend/src/routes/InventoryPage.tsx`, in `VmTable`'s cell renderer, add the test id to the `<td>`:

```tsx
                  <td key={col.key} data-testid={`cell-${col.key}`} className={cn(tableCellClass, col.key === 'name' && 'font-medium')}>
```

and swap the badges (platform stays a `Badge`):

```tsx
                    {col.key === 'platform' && <Badge value={vm.platform} type="platform" />}
                    {col.key === 'status' && <span className="capitalize">{vm.status.replace('_', ' ')}</span>}
                    {col.key === 'environment' && <span className="capitalize">{vm.environment}</span>}
                    {col.key === 'criticality' && <span className="capitalize">{vm.criticality}</span>}
                    {col.key === 'lifecycle' && <span className="capitalize">{vm.lifecycle}</span>}
                    {col.key === 'os_family' && <span className="capitalize">{vm.os_family ?? 'unknown'}</span>}
                    {col.key === 'monitoring_enabled' && <span>{vm.monitoring_enabled ? 'Enabled' : 'Disabled'}</span>}
                    {col.key === 'pmp_enabled' && <span>{vm.pmp_enabled ? 'Enabled' : 'Disabled'}</span>}
                    {col.key === 'health' && <span className={monoClass}>{vm.health_score}</span>}
```

Remove the criticality stripe from the row's checkbox cell:

```tsx
                <td className="py-3 pl-3 pr-4">
```

In `VmCard`: remove the `style={{ borderLeft: … }}` prop from the `<Link>`, replace the status badge with

```tsx
        <span className="text-xs capitalize text-[var(--color-text-secondary)]">{vm.status.replace('_', ' ')}</span>
```

and replace the criticality / environment / lifecycle / os_family badges in the badge cluster with the neutral chip markup already used for `vm.owner`:

```tsx
        <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)] dark:bg-slate-800">{vm.criticality}</span>
        {vm.environment && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)] dark:bg-slate-800">{vm.environment}</span>}
        {vm.lifecycle && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)] dark:bg-slate-800">{vm.lifecycle}</span>}
        {vm.os_family && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)] dark:bg-slate-800">{vm.os_family}</span>}
```

The platform sub-line text stays as-is.

- [ ] **Step 4: Neutralise the active filter chips**

In `frontend/src/components/filters/ActiveFilterChips.tsx`, remove `chipTypeFor` from the `./filterConfig` import and delete the `type={chipTypeFor(advancedName)}` prop from `<FilterChip>`.

Do **not** delete `chipTypeFor` from `filterConfig.ts` — `filterConfig.test.ts` still tests it.

- [ ] **Step 5: Remove the glow**

In `frontend/src/app/globals.css`, delete the token line:

```css
  --dark-glow: 0 0 10px rgba(79, 70, 229, 0.3), 0 0 20px rgba(79, 70, 229, 0.1);
```

and the rule:

```css
/* Badge dark mode glow */
html.dark .dark\:shadow-\[var\(--dark-glow\)\] {
  box-shadow: var(--dark-glow);
}
```

Then remove any leftover class usages:

```bash
cd frontend && grep -rn "dark-glow" src/
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd frontend && bun run test && bun run typecheck`
Expected: PASS. Fix any test elsewhere that asserted a coloured inventory badge.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(inventory): neutral status/criticality, drop badge glow"
```

---

### Task 6: Full verification

**Files:**
- Modify: `frontend/e2e/inventory.spec.ts` only if a spec asserts removed UI.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green `just verify`.

- [ ] **Step 1: Run the frontend suite with coverage**

Run: `cd frontend && bun run test`
Expected: PASS, all four coverage thresholds ≥ 80%. Deleting `ContextPanel.tsx` and `useFilterPresets.ts` removes uncovered lines, so coverage should rise, not fall.

- [ ] **Step 2: Run the E2E suite headless against the system chromium**

Run: `cd frontend && bunx playwright test`
Expected: PASS. The Playwright config starts backend + frontend itself. If the launcher tries to download a browser, point it at the system binary:

```bash
cd frontend && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v chromium || command -v chromium-browser)" bunx playwright test
```

Any spec that clicks a row to open the context panel, reads a stat tile, uses a preset button, or clicks an Actions-column icon must be updated — the detail page is now reached by clicking the VM name link.

- [ ] **Step 3: Eyeball the running page**

Start the app (`just api-dev` and `just web-dev`, or `just pm2-start`), then drive `http://127.0.0.1:3000/inventory` with the playwright MCP or chrome-devtools MCP. Confirm: no stat tiles, no right-hand panel, no Actions column, search box present, Filters drawer has no Presets section, status/criticality plain text, no badge glow in dark mode.

Snapshot to a file, never inline:

```
browser_snapshot(filename: "/tmp/claude-1000/-home-tejas-projects-InventoryMGR/716ef296-7bb4-4029-a460-5cb822817f25/scratchpad/inventory.md")
```

- [ ] **Step 4: Run the full gate**

Run: `just verify`
Expected: ruff + pytest + lint + typecheck + vitest + playwright all green.

- [ ] **Step 5: Refresh the knowledge graph and commit**

```bash
graphify update .
git add -A
git commit -m "test(inventory): update e2e specs for simplified inventory page"
```
