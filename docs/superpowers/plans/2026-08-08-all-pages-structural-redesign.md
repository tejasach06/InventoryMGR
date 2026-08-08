# InventoryMGR All-Pages Structural Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every InventoryMGR frontend page into a balanced, responsive instrument panel while preserving routes, API contracts, RBAC, and operator workflows.

**Architecture:** Begin with typed shared primitives and accessible overlay behavior, then rebuild the responsive shell and apply the primitives route group by route group. Each phase updates its colocated Vitest coverage before implementation and ends in an independently reviewable commit; the final phase runs responsive Playwright and the repository graph refresh.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript 6, Tailwind CSS 4, TanStack Query 5, Vitest 4, React Testing Library, Playwright 1.60.

## Global Constraints

- Keep existing URLs, API contracts, RBAC behavior, CSRF behavior, URL-driven inventory state, light/dark parity, and per-user accent preferences.
- All network requests continue through `frontend/src/api/client.ts`; no bare `fetch()` calls.
- Saturated color represents interaction or a real semantic reading; page chrome remains neutral.
- Technical identifiers, addresses, capacities, timestamps, and counts use the mono stack with tabular numerals.
- Do not add frontend dependencies or migrate frameworks.
- Run frontend commands through `devbox shell`; use Bun, not npm, for project scripts.
- Write a failing Vitest test before each behavioral implementation.
- Run `graphify update .` after code modifications are complete.

---

## File map and boundaries

- `frontend/src/app/globals.css`: global tokens, body typography, scrollbars, focus, and reduced-motion behavior only.
- `frontend/src/components/ui.tsx`: shared visual primitives; do not add route-specific data rules.
- `frontend/src/hooks/useModalOverlay.ts`: shared focus containment, Escape, restoration, and scroll-lock behavior.
- `frontend/src/components/Layout.tsx`: responsive authenticated shell and mobile menu state.
- `frontend/src/components/AppNav.tsx`: navigation grouping and active-route presentation.
- `frontend/src/routes/*.tsx`: route-specific composition and data-state decisions.
- `frontend/src/test/*.test.tsx`: route/component contracts using existing `renderWithProviders` helpers.
- `frontend/e2e/*.spec.ts`: responsive workflows and visual regressions through real routes.

---

### Task 1: Semantic badges, neutral data color, and shared typography

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/ui.tsx`
- Test: `frontend/src/test/componentsCore.test.tsx`
- Test: `frontend/src/test/darkContrast.test.ts`

**Interfaces:**
- Produces: `SemanticType`, `BadgeTone`, `Badge({ value, tone, size })`, and neutral `ProgressBar` default behavior.
- Consumes: existing semantic CSS variables and `cn()`.

- [ ] **Step 1: Write failing primitive tests**

Add tests that require an explicit semantic tone and a neutral fallback:

```tsx
renderWithProviders(
  <div>
    <Badge value="running" tone={{ type: 'status', value: 'running' }} />
    <Badge value="admin" tone={{ type: 'neutral' }} />
    <Badge value="unknown reading" tone={{ type: 'status', value: 'not_registered' }} />
    <ProgressBar value={42} label="Capacity" />
  </div>,
);
expect(screen.getByText('running')).toHaveAttribute('data-tone', 'status');
expect(screen.getByText('admin')).toHaveAttribute('data-tone', 'neutral');
expect(screen.getByText('unknown reading')).toHaveAttribute('data-tone', 'neutral');
expect(screen.getByRole('progressbar')).toHaveStyle({ '--progress-color': 'var(--color-text-secondary)' });
```

Also assert `Badge` uses a rounded-md class and no generic `shadow-md` class.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/darkContrast.test.ts'
```

Expected: TypeScript/test failures because `tone`, neutral fallback, and neutral progress behavior do not exist.

- [ ] **Step 3: Implement typed badge tones and token cleanup**

Use these public types and registry in `ui.tsx`:

```tsx
export type SemanticType = 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle';
export type BadgeTone = { type: SemanticType; value: string } | { type: 'neutral' };

const semanticValues: Record<SemanticType, ReadonlySet<string>> = {
  status: new Set(['running', 'powered_off', 'decommissioned', 'unknown']),
  criticality: new Set(['critical', 'high', 'medium', 'low']),
  environment: new Set(['production', 'staging', 'uat', 'testing', 'development', 'dr', 'sandbox']),
  platform: new Set(['proxmox', 'vmware']),
  os_family: new Set(['linux', 'windows']),
  lifecycle: new Set(['active', 'planned', 'retiring', 'retired']),
};
```

Normalize the requested value, use semantic CSS variables only when it exists in the registry, and otherwise render neutral surface/text/border variables. Give the root badge `data-tone`, `rounded-md`, `animate-pill-pop`, and semantic hover brightness without a generic shadow.

Update `ProgressBar` to use `colorVar = 'var(--color-text-secondary)'` and expose the chosen fill through `--progress-color`. Change the `PageHeader` eyebrow default from accent to text-tertiary. Add the documented `0.875rem/1.5` body contract and tokenized scrollbar colors in `globals.css`.

- [ ] **Step 4: Run primitive tests and typecheck**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/darkContrast.test.ts && bun run typecheck'
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/components/ui.tsx frontend/src/test/componentsCore.test.tsx frontend/src/test/darkContrast.test.ts
git commit -m "refactor(ui): make semantic signals explicit"
```

---

### Task 2: Accessible overlays and compact inline states

**Files:**
- Create: `frontend/src/hooks/useModalOverlay.ts`
- Modify: `frontend/src/components/ui.tsx`
- Test: `frontend/src/test/componentsCore.test.tsx`

**Interfaces:**
- Produces: `useModalOverlay({ open, onClose, containerRef, initialFocusRef })`, `InlineEmptyState`, and accessible `Drawer` behavior.
- Consumes: React refs/effects and the global reduced-motion/focus rules from Task 1.

- [ ] **Step 1: Write failing overlay and inline-state tests**

Add a harness that opens a `Drawer`, asserts focus enters it, Tab wraps between its first/last controls, Escape closes it, body overflow is locked while open, and focus returns to the opener. Add:

```tsx
renderWithProviders(<InlineEmptyState title="No disks" body="Add a disk to track storage." />);
const state = screen.getByRole('status');
expect(state).toHaveClass('py-6');
expect(state).not.toHaveClass('shadow-[var(--shadow-raised)]');
```

- [ ] **Step 2: Verify the tests fail**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx'
```

Expected: failure because focus containment, scroll lock, and `InlineEmptyState` are absent.

- [ ] **Step 3: Implement the overlay hook**

Create the exact interface:

```tsx
interface ModalOverlayOptions {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}
export function useModalOverlay(options: ModalOverlayOptions): void;
```

On open, save `document.activeElement`, set `document.body.style.overflow = 'hidden'`, focus the initial target or first focusable element, close on Escape, and wrap Tab/Shift+Tab across enabled focusable descendants. On cleanup, restore the prior overflow value and prior focus.

Wire `Drawer` and `ConfirmDialog` to the hook instead of maintaining separate keyboard logic. Implement `InlineEmptyState` as a neutral, borderless status region with optional action slot.

- [ ] **Step 4: Run component tests**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx && bun run typecheck'
```

Expected: passing focus, Escape, restoration, scroll-lock, and compact-state assertions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useModalOverlay.ts frontend/src/components/ui.tsx frontend/src/test/componentsCore.test.tsx
git commit -m "feat(ui): add accessible overlay and inline empty states"
```

---

### Task 3: Responsive shell and operational navigation groups

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/AppNav.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/src/test/componentsCore.test.tsx`
- Test: `frontend/src/test/clientBehavior.test.tsx`

**Interfaces:**
- Produces: fixed-height mobile app bar, transient mobile navigation, and grouped desktop navigation.
- Consumes: `useModalOverlay`, `AppNav`, theme/accent providers, and existing logout mutation.

- [ ] **Step 1: Write failing navigation tests**

Assert group labels and mobile menu behavior:

```tsx
expect(screen.getByText('Overview')).toBeInTheDocument();
expect(screen.getByText('Inventory')).toBeInTheDocument();
expect(screen.getByText('Infrastructure')).toBeInTheDocument();
expect(screen.getByText('Operations')).toBeInTheDocument();
expect(screen.getByText('Administration')).toBeInTheDocument();
const menu = screen.getByRole('button', { name: 'Open navigation' });
fireEvent.click(menu);
expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
fireEvent.keyDown(document, { key: 'Escape' });
expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
```

Retain existing assertions for desktop sidebar collapse persistence and role-gated destinations.

- [ ] **Step 2: Verify navigation tests fail**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/clientBehavior.test.tsx'
```

Expected: group and mobile-dialog assertions fail.

- [ ] **Step 3: Reorganize `AppNav`**

Define groups as data:

```tsx
const NAV_GROUPS = [
  { label: 'Overview', items: ['/dashboard', '/reports'] },
  { label: 'Inventory', items: ['/inventory'] },
  { label: 'Infrastructure', items: ['/storage', '/clusters'] },
  { label: 'Operations', items: ['/imports/new'] },
  { label: 'Administration', items: ['/settings'] },
] as const;
```

Continue filtering Import by editor/admin role. Render active links with neutral background, accent text, and an accent marker visible in both expanded and collapsed modes. Standardize all SVG icons to a 16-unit view box and 1.5 stroke.

- [ ] **Step 4: Implement the responsive shell**

Render separate mobile and desktop shells: `lg:hidden` fixed-height app bar plus modal navigation, and `hidden lg:flex` desktop aside. The mobile panel contains grouped navigation, theme, user identity, and logout. Close it after route-link activation. Wrap page children in `mx-auto w-full max-w-[100rem]`; allow route-level narrower frames.

Keep `--app-header-h: 4.5rem` synchronized with the real mobile bar and remove the expanded navigation from normal mobile document flow.

- [ ] **Step 5: Run tests and typecheck**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/clientBehavior.test.tsx && bun run typecheck'
```

Expected: navigation and existing logout/collapse tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Layout.tsx frontend/src/components/AppNav.tsx frontend/src/app/globals.css frontend/src/test/componentsCore.test.tsx frontend/src/test/clientBehavior.test.tsx
git commit -m "feat(layout): rebuild responsive operational navigation"
```

---

### Task 4: Page-header hierarchy and global route states

**Files:**
- Modify: `frontend/src/components/ui.tsx`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/app/(app)/layout.tsx`
- Modify: `frontend/src/app/error.tsx`
- Modify: `frontend/src/app/not-found.tsx`
- Modify: `frontend/src/routes/LoginPage.tsx`
- Test: `frontend/src/test/componentsCore.test.tsx`
- Test: `frontend/src/test/loginSetup.test.tsx`
- Test: `frontend/src/test/loginSignIn.test.tsx`

**Interfaces:**
- Produces: `PageHeader({ title, context, description, breadcrumb, actions })` and safe global loading/error/dead-end states.
- Consumes: `InlineEmptyState`, shared button classes, `Logo`, and existing login mutations.

- [ ] **Step 1: Write failing header and auth-state tests**

Require description and breadcrumb slots, a mobile login brand lockup, safe global error copy, and an auth-card-shaped setup skeleton:

```tsx
renderWithProviders(<PageHeader title="Array 01" context="Storage array" description="Capacity and attached volumes" breadcrumb={<a href="/storage">Storage</a>} />);
expect(screen.getByText('Storage array')).toHaveClass('text-[var(--color-text-tertiary)]');
expect(screen.getByText('Capacity and attached volumes')).toBeInTheDocument();
expect(screen.getByRole('link', { name: 'Storage' })).toBeInTheDocument();
```

- [ ] **Step 2: Verify focused tests fail**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/loginSetup.test.tsx src/test/loginSignIn.test.tsx'
```

Expected: missing props/brand/skeleton assertions fail.

- [ ] **Step 3: Extend headers and global metadata**

Change `PageHeader` to accept:

```tsx
interface PageHeaderProps {
  title: string;
  context?: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}
```

Use balanced wrapping, a 65-character description measure, and mobile-safe action wrapping. Set root metadata to a title template (`%s | InventoryMGR`) and describe VM, storage, and physical infrastructure inventory.

- [ ] **Step 4: Refine loading, error, not-found, and login surfaces**

Use a composed session skeleton in authenticated layout. On global error, show a primary Try again button, tertiary Dashboard link, and mono digest only; omit arbitrary `error.message`. On not-found, provide Inventory and Dashboard routes with a neutral illustration.

In Login, replace raw feature-check color with a token, add a mobile-only Logo/wordmark, use `p-6 sm:p-8`, render LDAP as quiet availability text when disabled, and make setup loading match the final card.

- [ ] **Step 5: Run tests and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/componentsCore.test.tsx src/test/loginSetup.test.tsx src/test/loginSignIn.test.tsx && bun run typecheck'
git add frontend/src/components/ui.tsx frontend/src/app/layout.tsx 'frontend/src/app/(app)/layout.tsx' frontend/src/app/error.tsx frontend/src/app/not-found.tsx frontend/src/routes/LoginPage.tsx frontend/src/test/componentsCore.test.tsx frontend/src/test/loginSetup.test.tsx frontend/src/test/loginSignIn.test.tsx
git commit -m "feat(ui): establish page hierarchy and route recovery states"
```

---

### Task 5: Trustworthy dashboard states and responsive data panels

**Files:**
- Modify: `frontend/src/routes/DashboardPage.tsx`
- Test: `frontend/src/test/DashboardPage.test.tsx`

**Interfaces:**
- Produces: checking, unavailable, risk, and confirmed-operational dashboard states.
- Consumes: `api.getDashboard`, storage list query, `ProgressBar`, `Badge`, and shared page primitives.

- [ ] **Step 1: Write failing dashboard truth-state tests**

Mock fleet success while storage remains pending and assert “Checking infrastructure”; mock storage failure and assert “Storage status unavailable”; resolve both with no alerts and assert “Fleet operational”. Add a proportional bar assertion that a 1% segment uses `width: 1%`, not `4%`.

- [ ] **Step 2: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/DashboardPage.test.tsx'
```

Expected: current banner declares health too early and clamps the bar to 4%.

- [ ] **Step 3: Implement dashboard hierarchy and truth states**

Derive the banner with this order:

```tsx
if (dashboardQ.isLoading || arraysQ.isLoading) return 'checking';
if (dashboardQ.isError || arraysQ.isError) return 'unavailable';
if (storageAlerts.length > 0) return 'risk';
return 'operational';
```

Pass `context="Infrastructure"` and a concise fleet-health description to `PageHeader`. Remove `Math.max(4, pct)`. Use title-tier headings for Power state, By environment, and By criticality. Make donut/legend stack on narrow panels. Keep a quiet inventory link when operational and emphasize the storage action only for risk. Render “All clear” in sentence case.

- [ ] **Step 4: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/DashboardPage.test.tsx && bun run typecheck'
git add frontend/src/routes/DashboardPage.tsx frontend/src/test/DashboardPage.test.tsx
git commit -m "refactor(dashboard): make fleet state explicit and proportional"
```

---

### Task 6: Compact report catalogue

**Files:**
- Modify: `frontend/src/routes/ReportsPage.tsx`
- Create: `frontend/src/test/ReportsPage.test.tsx`

**Interfaces:**
- Produces: compact report rows with valid optional coverage.
- Consumes: report summary query and existing export URLs.

- [ ] **Step 1: Write the failing report catalogue test**

Mock `total_vms: 10` and `owner: 14`. Assert eight report rows render, Owner Report shows `14 owners`, Owner Report has no progressbar, Linux retains a progressbar, and only semantically categorized rows use semantic colors.

- [ ] **Step 2: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ReportsPage.test.tsx'
```

Expected: owner currently renders a misleading clamped progress bar and repeated cards.

- [ ] **Step 3: Implement compact responsive rows**

Pass `context="Exports"` and a concise catalogue description to `PageHeader`. Add `coverage: boolean` and optional semantic color to `ReportDef`; set `coverage: false` for Owner. Render one bordered catalogue with divided rows, mono counts, optional `ProgressBar`, and a secondary Download action that becomes visible on row hover/focus at desktop but remains visible on touch layouts. Use neutral progress for monitoring, applications, owner, and PMP.

- [ ] **Step 4: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ReportsPage.test.tsx && bun run typecheck'
git add frontend/src/routes/ReportsPage.tsx frontend/src/test/ReportsPage.test.tsx
git commit -m "refactor(reports): replace cards with a compact catalogue"
```

---

### Task 7: Inventory hierarchy, export menu, and mobile-safe bulk actions

**Files:**
- Modify: `frontend/src/routes/InventoryPage.tsx`
- Modify: `frontend/src/components/InventoryToolbar.tsx`
- Test: `frontend/src/test/InventoryPage.test.tsx`
- Test: `frontend/src/test/InventoryIpColumn.test.tsx`
- Test: `frontend/src/test/InventoryToolbar.test.tsx`

**Interfaces:**
- Produces: one Export control, semantic status rows, mono identity values, compact edit controls, and wrapping bulk tray.
- Consumes: existing URL params, column preferences, filter drawers, and export URL helpers.

- [ ] **Step 1: Add failing inventory interaction tests**

Assert the header exposes one Export button and one New VM primary action; opening Export reveals CSV and Excel links. Assert partially selected rows set the header checkbox `indeterminate = true`, sortable headers expose `aria-sort`, VM names have `tech`, and a running row exposes a status-border CSS variable.

Add a bulk-tray assertion for responsive wrapping classes and `aria-live="polite"` on the selected count.

- [ ] **Step 2: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/InventoryPage.test.tsx src/test/InventoryIpColumn.test.tsx src/test/InventoryToolbar.test.tsx'
```

Expected: separate CSV/Excel controls and missing row/header accessibility assertions fail.

- [ ] **Step 3: Implement the table and header refinements**

Pass `context="Virtual machines"` and an operator-focused fleet description to `PageHeader`. Use a small accessible export disclosure anchored to one secondary Export button. Preserve existing URLs. Set the selection checkbox’s `.indeterminate` property in an effect. Add `aria-sort` values (`ascending`, `descending`, `none`). Apply `monoClass` to VM identity fields and a 3px status border through `style={{ '--row-status': ... }}` plus a CSS class.

Use compact inline edit class variants (`px-2 py-1 text-xs`) so editing does not change row height. Keep status and criticality prominent on mobile; move other badges into a quieter metadata row.

- [ ] **Step 4: Refine the bulk tray**

Give the tray `max-w-[calc(100vw-2rem)] flex-wrap`, make the selected count live, reuse `Alert` for errors, and collapse bulk CSV/Excel under one Export disclosure. Preserve every existing bulk mutation and selection rule.

- [ ] **Step 5: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/InventoryPage.test.tsx src/test/InventoryIpColumn.test.tsx src/test/InventoryToolbar.test.tsx && bun run typecheck'
git add frontend/src/routes/InventoryPage.tsx frontend/src/components/InventoryToolbar.tsx frontend/src/test/InventoryPage.test.tsx frontend/src/test/InventoryIpColumn.test.tsx frontend/src/test/InventoryToolbar.test.tsx
git commit -m "refactor(inventory): clarify dense fleet workflows"
```

---

### Task 8: VM detail and form structure

**Files:**
- Modify: `frontend/src/routes/VmDetailPage.tsx`
- Modify: `frontend/src/routes/VmFormPage.tsx`
- Modify: `frontend/src/lib/vmForm.ts`
- Test: `frontend/src/test/VmDetailPage.test.tsx`
- Test: `frontend/src/test/VmFormPage.test.tsx`
- Test: `frontend/src/test/VmFormInputs.test.tsx`

**Interfaces:**
- Produces: breadcrumb/action hierarchy, flat telemetry, inline collection states, overlay suggestions, and unsaved-state tray.
- Consumes: `PageHeader`, `InlineEmptyState`, `SectionNav`, `Badge`, `RemoveButton`, and current form schema/API mutations.

- [ ] **Step 1: Write failing VM detail tests**

Assert “Back to inventory” is a breadcrumb, Edit is the sole primary action, Clone/Delete live under an Actions disclosure, environment appears once in telemetry, empty child panels use `role=status` compact states, and technical values carry `tech`.

- [ ] **Step 2: Write failing VM form tests**

Assert suggestion lists use `role=listbox` with absolute overlay classes, repeated disk/IP rows have a neutral grouped surface, technical inputs carry the mono font, and the sticky tray displays “Unsaved changes” only when dirty.

- [ ] **Step 3: Verify both suites fail**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/VmDetailPage.test.tsx src/test/VmFormPage.test.tsx src/test/VmFormInputs.test.tsx'
```

- [ ] **Step 4: Refactor VM detail composition**

Pass neutral context/description/breadcrumb to `PageHeader`. Keep Edit primary; place Clone and Delete in an accessible action disclosure with the existing `ConfirmDialog`. Replace four nested telemetry boxes with one divided responsive grid and one health row. Replace nested `EmptyState` uses with `InlineEmptyState`. Apply `.row-actions` to child removal controls and `monoClass` to sizes, dates, audit fields, and old/new values.

- [ ] **Step 5: Refactor VM form composition**

Make combobox wrappers `relative` and lists `absolute top-full z-30 max-h-64 overflow-y-auto shadow-[var(--shadow-overlay)]`. Combine Identity with Location and Operations with Security at the outer-card level while retaining stable section IDs for `SectionNav`. Wrap repeated items in `surface-secondary` rows and apply a technical input variant to FQDN, IDs, IP/VLAN/gateway, CPU, memory, and disk values.

Use overlay shadow on the sticky tray, show dirty-state copy on the left, and keep actions right aligned. Preserve the current confirm-on-cancel and unload protection.

- [ ] **Step 6: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/VmDetailPage.test.tsx src/test/VmFormPage.test.tsx src/test/VmFormInputs.test.tsx src/test/vmFormSchema.test.ts src/test/VmTypeGating.test.tsx && bun run typecheck'
git add frontend/src/routes/VmDetailPage.tsx frontend/src/routes/VmFormPage.tsx frontend/src/lib/vmForm.ts frontend/src/test/VmDetailPage.test.tsx frontend/src/test/VmFormPage.test.tsx frontend/src/test/VmFormInputs.test.tsx
git commit -m "refactor(vms): flatten detail and editing workflows"
```

---

### Task 9: Storage list and detail redesign

**Files:**
- Modify: `frontend/src/routes/StoragePage.tsx`
- Modify: `frontend/src/routes/StorageDetailPage.tsx`
- Modify: `frontend/src/components/ArrayForm.tsx`
- Test: `frontend/src/test/StoragePage.test.tsx`
- Test: `frontend/src/test/StorageDetailPage.test.tsx`

**Interfaces:**
- Produces: stable list capacity rows, explicit critical threshold badge, summary grid, and progressively disclosed volume editors.
- Consumes: existing storage API types/mutations and shared primitives.

- [ ] **Step 1: Write failing storage list tests**

Assert loading renders a table skeleton, empty state contains New array for editors, threshold badge has critical tone with visible label “Over threshold”, and each populated row shows used/total capacity plus percentage.

- [ ] **Step 2: Write failing storage detail tests**

Assert breadcrumb hierarchy; read view includes management host, datacenter, vendor/model, description/notes; LUN/share empty regions use compact status states; add forms are hidden until their Add control is activated; removal actions carry `.row-actions`.

- [ ] **Step 3: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/StoragePage.test.tsx src/test/StorageDetailPage.test.tsx'
```

- [ ] **Step 4: Implement storage list**

Pass infrastructure context and a capacity-focused description to the Storage page header. Replace generic loading with `TableSkeleton`. Use `EmptyState.actions` for authorized creation. Map threshold badge to `{ type: 'criticality', value: 'critical' }`. Give capacity its own stable column with mono used/total and a compact meter; truncate vendor/datacenter with `title` attributes.

- [ ] **Step 5: Implement storage detail**

Build a responsive summary definition grid for capacity, used, vendor/model, datacenter, management host, description, and notes. Render each volume as a divided section with flat LUN/share subsections. Gate each add form behind a local Add button and use persistent labels in `grid-cols-1 sm:grid-cols-2 lg:grid-cols-12`; wide identifiers span more columns than numeric fields. Use compact empty rows and quiet removal actions.

- [ ] **Step 6: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/StoragePage.test.tsx src/test/StorageDetailPage.test.tsx && bun run typecheck'
git add frontend/src/routes/StoragePage.tsx frontend/src/routes/StorageDetailPage.tsx frontend/src/components/ArrayForm.tsx frontend/src/test/StoragePage.test.tsx frontend/src/test/StorageDetailPage.test.tsx
git commit -m "refactor(storage): clarify capacity and child records"
```

---

### Task 10: Cluster list and detail redesign

**Files:**
- Modify: `frontend/src/routes/ClustersPage.tsx`
- Modify: `frontend/src/routes/ClusterDetailPage.tsx`
- Modify: `frontend/src/components/ClusterForm.tsx`
- Test: `frontend/src/test/ClustersPage.test.tsx`
- Test: `frontend/src/test/ClusterDetailPage.test.tsx`

**Interfaces:**
- Produces: human-readable cluster metrics, summary region, contained node section, and grouped progressive node form.
- Consumes: existing cluster API types/mutations and unit formatters.

- [ ] **Step 1: Write failing cluster tests**

Require table skeleton loading, contextual New cluster empty action, truncated descriptions with full `title`, formatted RAM/storage units, breadcrumb detail hierarchy, summary metrics, a hidden-until-requested node form, and neutral normal RAM bars.

- [ ] **Step 2: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ClustersPage.test.tsx src/test/ClusterDetailPage.test.tsx'
```

- [ ] **Step 3: Implement list and detail hierarchy**

Pass infrastructure context and a physical-compute description to the Clusters page header. Use `TableSkeleton` and `EmptyState.actions`; apply unit formatters and mono values. Replace the detail description-only card with a responsive summary region for node count, RAM, storage, description, and notes. Place nodes, empty state, table, and add editor in one top-level section.

Group the node editor under fieldsets named Identity and network, Compute, Capacity, and Location. Use one column on the smallest breakpoint, wider spans for name/IP, and narrow spans for numeric fields. Change normal utilization fill to text-secondary and use semantic warning colors only when backed by a real threshold. Reveal remove actions on hover/focus.

- [ ] **Step 4: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ClustersPage.test.tsx src/test/ClusterDetailPage.test.tsx && bun run typecheck'
git add frontend/src/routes/ClustersPage.tsx frontend/src/routes/ClusterDetailPage.tsx frontend/src/components/ClusterForm.tsx frontend/src/test/ClustersPage.test.tsx frontend/src/test/ClusterDetailPage.test.tsx
git commit -m "refactor(clusters): strengthen compute summaries and node editing"
```

---

### Task 11: Accessible and scannable CSV import

**Files:**
- Modify: `frontend/src/routes/ImportCsvPage.tsx`
- Test: `frontend/src/test/ImportCsvPage.test.tsx`

**Interfaces:**
- Produces: explicit action tones, keyboard drop zone, selected-file state, grouped format reference, and high-contrast committed preview.
- Consumes: existing import preview/commit mutations and CSV schema.

- [ ] **Step 1: Write failing import tests**

Assert Enter/Space on the drop zone activates the file input; selected file displays name, formatted size, and Clear; create/update/unchanged/conflict/invalid render intentional tones; committed preview does not have an opacity class; field key `ram_gb` is displayed as `RAM`; batch ID is truncated with a copy control.

- [ ] **Step 2: Verify failure**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ImportCsvPage.test.tsx'
```

- [ ] **Step 3: Implement the import workflow presentation**

Pass operations context and preview-before-upsert description to `PageHeader`. Create a route-local mapping:

```tsx
const actionTone: Record<ImportAction, BadgeTone> = {
  create: { type: 'status', value: 'running' },
  update: { type: 'lifecycle', value: 'planned' },
  unchanged: { type: 'neutral' },
  conflict: { type: 'criticality', value: 'high' },
  invalid: { type: 'criticality', value: 'critical' },
};
```

Make the drop-zone root a focusable button-like control with keyboard activation and visible focus. Separate selected-file metadata and Clear. Rewrite reference copy into grouped required identifiers, matching, list syntax, and additive behavior sections with mono examples. Remove preview-wide opacity, humanize field names through an explicit label map, and add an accessible copy button for the batch ID.

- [ ] **Step 4: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/ImportCsvPage.test.tsx && bun run typecheck'
git add frontend/src/routes/ImportCsvPage.tsx frontend/src/test/ImportCsvPage.test.tsx
git commit -m "refactor(import): clarify preview and file workflow"
```

---

### Task 12: Settings, Users, and LDAP administration

**Files:**
- Modify: `frontend/src/routes/SettingsPage.tsx`
- Modify: `frontend/src/routes/UsersPage.tsx`
- Modify: `frontend/src/routes/LdapSettingsPanel.tsx`
- Test: `frontend/src/test/SettingsPage.test.tsx`
- Test: `frontend/src/test/UsersPage.test.tsx`
- Test: `frontend/src/test/LdapSettingsPanel.test.tsx`

**Interfaces:**
- Produces: standalone settings tab rail, setting rows, one-at-a-time user editors, explicit role/status badges, and grouped LDAP states.
- Consumes: existing settings, user, LDAP, theme, and accent API calls.

- [ ] **Step 1: Write failing Settings tests**

Assert the page uses a `max-w-5xl` frame, tabs are outside the panel surface, appearance swatches are flat 44px targets with `aria-checked`, notification rows contain title/consequence/control regions, and save success is announced with `role=status`.

- [ ] **Step 2: Write failing Users tests**

Assert the panel heading includes user count; default rows show neutral role plus explicit Active/Inactive semantic status; inputs are absent until Edit is activated; opening one editor closes the prior editor; Save is disabled when unchanged.

- [ ] **Step 3: Write failing LDAP tests**

Assert loading skeleton and query error render before fields; disabled mode disables dependent controls; fieldset legends are Status, Connection, Directory search, Role mapping, and Transport security; test feedback renders full-width; successful save is announced.

- [ ] **Step 4: Verify all three suites fail**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/SettingsPage.test.tsx src/test/UsersPage.test.tsx src/test/LdapSettingsPanel.test.tsx'
```

- [ ] **Step 5: Implement Settings and notification rows**

Pass administration context and a preference/security description to `PageHeader`. Move the tab rail outside the content surface, constrain the page, and let each panel own its top-level surface. Render swatches as flat bordered radio targets with selected check/ring. Implement notification rows as `grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]` with feedback below the grid and a short-lived saved status.

- [ ] **Step 6: Implement one-at-a-time user editing**

Lift `editingUserId: string | null` to `UsersPanel`. Default rows render email, neutral role badge, running/powered-off status badge, and a quiet Edit action. Only the selected row renders role, active, password, Save, and Cancel controls. Track dirty state from initial role/status and password length. Preserve self-deactivation protections and all current mutation payloads.

- [ ] **Step 7: Group LDAP and model query states**

Return a skeleton while `configQuery.isLoading` and `Alert` plus Retry while it errors. Use real `<fieldset disabled={!enabled}>` groups for dependent controls, leaving Status enabled. Keep the test-connection area outside the persisted form fieldsets, clear its password after completion, and render save/test feedback beneath their action rows.

- [ ] **Step 8: Run and commit**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test -- src/test/SettingsPage.test.tsx src/test/UsersPage.test.tsx src/test/LdapSettingsPanel.test.tsx && bun run typecheck'
git add frontend/src/routes/SettingsPage.tsx frontend/src/routes/UsersPage.tsx frontend/src/routes/LdapSettingsPanel.tsx frontend/src/test/SettingsPage.test.tsx frontend/src/test/UsersPage.test.tsx frontend/src/test/LdapSettingsPanel.test.tsx
git commit -m "refactor(settings): simplify administration workflows"
```

---

### Task 13: Cross-page responsive verification and documentation sync

**Files:**
- Modify: `frontend/e2e/ui-changes.spec.ts`
- Modify: `DESIGN.md`
- Modify: `frontend/src/app/globals.css` only for defects proven by responsive checks

**Interfaces:**
- Produces: regression coverage for the redesigned shell and representative page families.
- Consumes: all prior task outputs.

- [ ] **Step 1: Add responsive Playwright assertions**

Add tests at 375px, 768px, and 1440px that verify:

```ts
await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
await page.getByRole('button', { name: 'Open navigation' }).click();
await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
```

At desktop, verify the grouped sidebar and absence of the mobile menu. Cover Inventory export/bulk flow, one VM detail/form, one storage detail, one cluster detail, Import, and Settings user/LDAP disclosure.

- [ ] **Step 2: Run the complete frontend unit suite**

```bash
devbox shell -- bash -lc 'cd frontend && bun run test'
```

Expected: all Vitest tests pass with existing coverage thresholds.

- [ ] **Step 3: Run lint and typecheck**

```bash
devbox shell -- bash -lc 'cd frontend && bun run lint && bun run typecheck'
```

Expected: no ESLint, Tailwind token, or TypeScript errors.

- [ ] **Step 4: Run Playwright**

```bash
devbox shell -- bash -lc 'just db-up && just e2e'
```

Expected: responsive and existing end-to-end suites pass. If infrastructure is unavailable, record the exact command and failure boundary rather than claiming success.

- [ ] **Step 5: Perform visual acceptance checks**

Capture representative mobile/tablet/desktop screenshots in both light and dark modes. Confirm one primary action per page, fixed-height mobile app bar, intentional table overflow, legible semantic badges, no nested full-size empty cards, and reduced-motion state communication.

- [ ] **Step 6: Synchronize design documentation**

Update `DESIGN.md` to document the operational navigation groups, mobile menu contract, `BadgeTone`, compact inline empty states, neutral progress default, and one-primary-action rule. Do not duplicate route-level implementation details.

- [ ] **Step 7: Refresh the code graph and review the diff**

```bash
graphify update .
git diff --check
git status --short
```

Expected: graph update completes, no whitespace errors, and only intentional files remain modified.

- [ ] **Step 8: Commit final verification assets and documentation**

```bash
git add frontend/e2e/ui-changes.spec.ts DESIGN.md frontend/src/app/globals.css
git commit -m "test(ui): lock responsive redesign behavior"
```
