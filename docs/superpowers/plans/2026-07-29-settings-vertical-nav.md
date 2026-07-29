# Settings Vertical Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim `/settings` quick-select tabs to Cluster only (drop CPU cores, Datacenter, Disk size, Operating system) and replace the horizontal tab-strip with a vertical sidebar nav (Cluster, Users, Notifications).

**Architecture:** Single-file UI change in `frontend/src/routes/SettingsPage.tsx` (React/Next.js client component, TanStack Query for data, Vitest + React Testing Library for tests). No backend/API changes — `CategoryPanel`, `NotificationsPanel`, `OptionRow` internals stay as-is; only the constants, default state, and outer layout markup in `SettingsPage()` change.

**Tech Stack:** Next.js 15 / React 18, TanStack Query, Vitest + @testing-library/react + @testing-library/user-event, Tailwind CSS.

## Global Constraints

- No backend/API changes — `cpu`/`datacenter`/`disk`/`os` dropdown-option endpoints and DB data stay untouched; they simply lose their admin editor UI.
- No changes to `CategoryPanel`, `NotificationsPanel`, or `OptionRow` component internals.
- No changes to the VM form's use of cpu/datacenter/disk/os suggestion lists.
- Keep `role="tab"` / `aria-selected` / `role="tabpanel"` semantics; add `aria-orientation="vertical"` to the tablist.
- Follow existing Instrument Panel styling conventions already in the file (`cn()` helper, `var(--color-accent)`, `cardClass`, dark-mode variants).

---

### Task 1: Vertical nav, Cluster-only quick-select

**Files:**
- Modify: `frontend/src/routes/SettingsPage.tsx:10-17` (constants), `:186-267` (`SettingsPage` component)
- Test: `frontend/src/test/SettingsPage.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: existing `CategoryPanel({ category, options })`, `NotificationsPanel()`, `api.getAllDropdownOptions`, `api.createDropdownOption(category, value, family?)`, `api.updateDropdownOption(id, value, family?)`, `api.deleteDropdownOption(id)`, `cn()` from `../lib/classNames`, `cardClass`/`Skeleton`/`Alert`/`PageHeader`/`PageTransition` from `../components/ui` — all unchanged signatures.
- Produces: `SettingsPage` still exported the same way (`export function SettingsPage()`), consumed by `frontend/src/app/settings/page.tsx` (not modified).

- [x] **Step 1: Replace the test file with the new expected behavior**

Overwrite `frontend/src/test/SettingsPage.test.tsx` with:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../api/client';
import type { DropdownOption } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { makeUser, renderWithProviders } from './utils';

const clusterOptions: DropdownOption[] = [{ id: 'o1', category: 'cluster', value: 'cluster-a', family: null }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows the loading skeleton on first render before the options query resolves', () => {
    // The query is pending on the initial synchronous render; resolution happens on
    // a later microtask, so asserting before any await observes the loading state.
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders an error alert when the options query rejects', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockRejectedValue(new ApiError(500, 'Boom'));

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders a vertical nav with the Cluster tab, a link to Users, and lists the cluster option', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(await screen.findByRole('tab', { name: 'Cluster' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.queryByRole('tab', { name: 'CPU cores' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Datacenter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Disk size (GB)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Operating system' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users');
    expect(screen.getByText('cluster-a')).toBeInTheDocument();
  });

  it('switches the active panel when Notifications is clicked, and back', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const clusterTab = await screen.findByRole('tab', { name: 'Cluster' });
    expect(clusterTab).toHaveAttribute('aria-selected', 'true');

    const notificationsTab = screen.getByRole('tab', { name: /notifications/i });
    await user.click(notificationsTab);

    expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
    expect(clusterTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-notifications');

    await user.click(clusterTab);
    expect(clusterTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-cluster');
  });

  it('creates a new cluster option from the add form', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const createSpy = vi
      .spyOn(api, 'createDropdownOption')
      .mockResolvedValue({ id: 'o2', category: 'cluster', value: 'cluster-b', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.type(screen.getByLabelText('Add Cluster option'), 'cluster-b');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('cluster', 'cluster-b'));
  });

  it('edits an existing cluster option and saves the new value', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const updateSpy = vi
      .spyOn(api, 'updateDropdownOption')
      .mockResolvedValue({ id: 'o1', category: 'cluster', value: 'cluster-c', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editInput = screen.getByLabelText('Edit cluster-a');
    await user.clear(editInput);
    await user.type(editInput, 'cluster-c');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('o1', 'cluster-c'));
  });

  it('deletes a cluster option after the confirm dialog is accepted', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const deleteSpy = vi.spyOn(api, 'deleteDropdownOption').mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('o1'));
  });

  it('links to the standalone Users page instead of duplicating it as a tab', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const usersLink = await screen.findByRole('link', { name: /users/i });
    expect(usersLink).toHaveAttribute('href', '/users');
    expect(screen.queryByRole('tab', { name: /^users$/i })).not.toBeInTheDocument();
  });

  it('saves the decommission notify window', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 60, storage_usage_warn_pct: 85 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/days before decommission/i);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /save window/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ decommission_notify_days: 60 }));
  });

  it('saves the storage usage warning threshold', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 90 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/storage usage warning threshold/i);
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /save threshold/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ storage_usage_warn_pct: 90 }));
  });
});
```

This drops the four removed-category tests (add/edit/remove for cpu, the OS-family add/edit tests, the "renders every category tab" test) and rewrites the remaining ones around the `cluster` category and the vertical nav.

- [x] **Step 2: Run the test file and confirm it fails**

Run: `cd frontend && bun run test -- SettingsPage.test.tsx`
Expected: Multiple FAIL — `getByRole('tab', { name: 'Cluster' })` not found (component still renders `cpu`/`datacenter`/`disk`/`os` tabs and defaults to `cpu`), `aria-orientation` assertion fails, `Add Cluster option` label not found, etc.

- [x] **Step 3: Update the category constants**

In `frontend/src/routes/SettingsPage.tsx`, replace lines 10-17:

```ts
const CATEGORY_ORDER = ['cluster'] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  cluster: 'Cluster',
};
```

- [x] **Step 4: Update `SettingsPage()` default tab and `grouped` memo**

Replace lines 186-197:

```tsx
export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'cluster' | 'notifications'>('cluster');
  const optionsQuery = useQuery({ queryKey: ['settings', 'options', 'all'], queryFn: api.getAllDropdownOptions });

  const grouped = useMemo(() => {
    return { cluster: (optionsQuery.data ?? []).filter((option) => option.category === 'cluster') };
  }, [optionsQuery.data]);
```

- [x] **Step 5: Replace the loading skeleton and horizontal tab-strip markup with a vertical nav**

Replace lines 205-263 (the loading skeleton block and the `optionsQuery.data ? (...)` block) with:

```tsx
        {optionsQuery.isLoading ? (
          <div className={cardClass} role="status" aria-label="Loading">
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="flex shrink-0 flex-col gap-2 sm:w-48">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <div className="flex-1 space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
            </div>
          </div>
        ) : null}
        {optionsQuery.data ? (
          <div className={cardClass}>
            <div className="flex flex-col gap-6 sm:flex-row">
              <div
                className="flex shrink-0 flex-col gap-1 sm:w-48 sm:border-r sm:border-slate-100 sm:pr-4 sm:dark:border-slate-800"
                role="tablist"
                aria-orientation="vertical"
                aria-label="Settings categories"
              >
                {CATEGORY_ORDER.map((category) => (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    id={`tab-${category}`}
                    aria-selected={activeTab === category}
                    aria-controls={`panel-${category}`}
                    onClick={() => setActiveTab(category)}
                    className={cn(
                      'rounded-md border-l-2 px-3 py-2 text-left text-sm font-medium transition-colors',
                      activeTab === category
                        ? 'border-[var(--color-accent)] bg-slate-50 text-[var(--color-accent)] dark:bg-slate-800/60'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                    )}
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                ))}
                <Link
                  href="/users"
                  className="flex items-center gap-1 rounded-md border-l-2 border-transparent px-3 py-2 text-left text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Users ↗
                </Link>
                <button
                  key="notifications"
                  type="button"
                  role="tab"
                  id="tab-notifications"
                  aria-selected={activeTab === 'notifications'}
                  aria-controls="panel-notifications"
                  onClick={() => setActiveTab('notifications')}
                  className={cn(
                    'rounded-md border-l-2 px-3 py-2 text-left text-sm font-medium transition-colors',
                    activeTab === 'notifications'
                      ? 'border-[var(--color-accent)] bg-slate-50 text-[var(--color-accent)] dark:bg-slate-800/60'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  Notifications
                </button>
              </div>
              <div className="min-w-0 flex-1">
                {activeTab === 'notifications' ? (
                  <NotificationsPanel />
                ) : (
                )}
              </div>
            </div>
          </div>
        ) : null}
```

- [x] **Step 6: Run the test file and confirm it passes**

Run: `cd frontend && bun run test -- SettingsPage.test.tsx`
Expected: PASS — all tests in `SettingsPage.test.tsx` green.

- [x] **Step 7: Lint and typecheck**

Run: `cd frontend && bun run lint && bun run typecheck`
Expected: no errors.

- [x] **Step 8: Commit**

```bash
git add frontend/src/routes/SettingsPage.tsx frontend/src/test/SettingsPage.test.tsx
git commit -m "feat(settings): vertical nav, cluster-only quick-select"
```

---

## Self-Review Notes

- **Spec coverage:** CATEGORY_ORDER/LABELS trimmed (spec §1-2) — Step 3. Vertical sidebar layout with Cluster/Users/Notifications (spec §5) — Step 5. Default tab + grouped memo updated (spec §3-4) — Step 4. Tests rewritten dropping cpu/datacenter/disk/os assertions, adding `aria-orientation="vertical"` check (spec §6) — Step 1. No backend/CategoryPanel/NotificationsPanel changes — confirmed untouched throughout.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `CATEGORY_ORDER` is now `['cluster'] as const` (a literal tuple, not `DropdownCategory[]`) so `CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string>`, `activeTab: useState<'cluster' | 'notifications'>`, and `grouped: { cluster: DropdownOption[] }` all agree on the literal `'cluster'` key — `CATEGORY_ORDER.map((category) => ...)` yields `category: 'cluster'`, so `setActiveTab(category)` and `grouped[activeTab]` (after excluding `'notifications'`) both type-check. `CategoryPanel`'s `category: DropdownCategory` prop still accepts the narrower `'cluster'` literal (assignable).
