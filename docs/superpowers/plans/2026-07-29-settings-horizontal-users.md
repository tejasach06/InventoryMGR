# Settings Horizontal Nav & Inline Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/settings` to use a horizontal tab-strip layout with two tabs: **Users** (default, renders `<UsersPanel />` inline) and **Notifications** (renders `<NotificationsPanel />`), remove the Cluster quick-select tab (and unused quick-select UI code), and redirect `/users` to `/settings`.

**Architecture:** UI updates in `frontend/src/routes/SettingsPage.tsx` (embed `<UsersPanel />` from `frontend/src/routes/UsersPage.tsx`, render horizontal `role="tablist"`), route redirect in `frontend/src/app/(app)/users/page.tsx`, and test updates in `frontend/src/test/SettingsPage.test.tsx`.

**Tech Stack:** Next.js 15 / React 18, TanStack Query, Vitest + @testing-library/react + @testing-library/user-event, Tailwind CSS.

## Global Constraints

- No backend/API changes — `/api/options` endpoints and DB data remain untouched.
- `UsersPanel` and `NotificationsPanel` component implementations are preserved; `UsersPanel` is embedded inside `SettingsPage.tsx`.
- Follow Instrument Panel horizontal tab styling: `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors`. Active: `border-[var(--color-accent)] text-[var(--color-accent)]`. Inactive: `border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200`.
- Standard Next.js server-side `redirect('/settings')` in `app/(app)/users/page.tsx`.

---

### Task 1: Redirection for `/users` route

**Files:**
- Modify: `frontend/src/app/(app)/users/page.tsx`

**Interfaces:**
- Consumes: `redirect` from `next/navigation`
- Produces: Server-side redirect from `/users` to `/settings`

- [ ] **Step 1: Update `frontend/src/app/(app)/users/page.tsx` to redirect to `/settings`**

Replace `frontend/src/app/(app)/users/page.tsx` content with:

```tsx
import { redirect } from 'next/navigation';

export default function UsersRoute() {
  redirect('/settings');
}
```

- [ ] **Step 2: Typecheck frontend**

Run: `cd frontend && bun run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/users/page.tsx
git commit -m "feat(users): redirect /users route to /settings"
```

---

### Task 2: Horizontal tab navigation and inline Users management in SettingsPage

**Files:**
- Modify: `frontend/src/routes/SettingsPage.tsx`
- Modify: `frontend/src/test/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `UsersPanel` exported from `frontend/src/routes/UsersPage.tsx`, `NotificationsPanel` inside `SettingsPage.tsx`, `cardClass`/`PageHeader`/`PageTransition` from `../components/ui`, `cn` from `../lib/classNames`.
- Produces: `SettingsPage` client component rendering horizontal `role="tablist"` with **Users** and **Notifications** tabs.

- [ ] **Step 1: Update `frontend/src/test/SettingsPage.test.tsx` for horizontal nav & inline Users**

Rewrite `frontend/src/test/SettingsPage.test.tsx` to test the new layout and behavior:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { User } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { makeUser, renderWithProviders } from './utils';

const mockUsers: User[] = [
  { id: 'u1', email: 'admin@example.com', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('renders a horizontal tablist with Users as default tab and lists users', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const tablist = screen.getByRole('tablist', { name: 'Settings categories' });
    expect(tablist).not.toHaveAttribute('aria-orientation', 'vertical');

    const usersTab = screen.getByRole('tab', { name: 'Users' });
    expect(usersTab).toHaveAttribute('aria-selected', 'true');

    expect(screen.getByRole('tab', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cluster' })).not.toBeInTheDocument();

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
  });

  it('switches between Users and Notifications tabs', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const usersTab = await screen.findByRole('tab', { name: 'Users' });
    const notificationsTab = screen.getByRole('tab', { name: 'Notifications' });

    await user.click(notificationsTab);

    expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
    expect(usersTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText(/days before decommission/i)).toBeInTheDocument();

    await user.click(usersTab);
    expect(usersTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('saves the decommission notify window from Notifications tab', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 60, storage_usage_warn_pct: 85 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/days before decommission/i);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /save window/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ decommission_notify_days: 60 }));
  });

  it('saves the storage usage warning threshold from Notifications tab', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test -- SettingsPage.test.tsx`
Expected: FAIL — tab orientation check or Users default tab assertion fails against previous SettingsPage implementation.

- [ ] **Step 3: Update `SettingsPage.tsx` with horizontal tabs and inline `<UsersPanel />`**

Replace `frontend/src/routes/SettingsPage.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage } from '../api/client';
import { PageHeader, PageTransition, Spinner, cardClass, inputClass, primaryButtonClass } from '../components/ui';
import { cn } from '../lib/classNames';
import { UsersPanel } from './UsersPage';

function NotificationsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'app'], queryFn: api.getAppSettings });
  const [days, setDays] = useState('');
  const [warnPct, setWarnPct] = useState('');
  const touched = useRef(false);
  const pctTouched = useRef(false);
  useEffect(() => {
    if (settingsQuery.data && !touched.current) setDays(String(settingsQuery.data.decommission_notify_days));
    if (settingsQuery.data && !pctTouched.current) setWarnPct(String(settingsQuery.data.storage_usage_warn_pct));
  }, [settingsQuery.data]);
  const save = useMutation({
    mutationFn: () => api.updateAppSettings({ decommission_notify_days: Number(days) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  const savePct = useMutation({
    mutationFn: () => api.updateAppSettings({ storage_usage_warn_pct: Number(warnPct) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  return (
    <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="animate-fade-in">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (Number(days) >= 1) save.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="notify-days">
            Days before decommission to warn
          </label>
          <input id="notify-days" type="number" min={1} className={inputClass + ' max-w-32'} value={days} onChange={(e) => { touched.current = true; setDays(e.target.value); }} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={save.isPending || Number(days) < 1}>
          {save.isPending ? <><Spinner /> Saving…</> : 'Save window'}
        </button>
        {save.isError ? <span className="text-sm font-medium text-[var(--color-criticality-critical)]" role="alert">{detailMessage(save.error)}</span> : null}
      </form>

      <form
        className="mt-6 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-6 dark:border-slate-800"
        onSubmit={(e) => { e.preventDefault(); if (Number(warnPct) >= 1 && Number(warnPct) <= 100) savePct.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="warn-pct">
            Storage usage warning threshold (%)
          </label>
          <input id="warn-pct" type="number" min={1} max={100} className={inputClass + ' max-w-32'} value={warnPct} onChange={(e) => { pctTouched.current = true; setWarnPct(e.target.value); }} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={savePct.isPending || Number(warnPct) < 1 || Number(warnPct) > 100}>
          {savePct.isPending ? <><Spinner /> Saving…</> : 'Save threshold'}
        </button>
        {savePct.isError ? <span className="text-sm font-medium text-[var(--color-criticality-critical)]" role="alert">{detailMessage(savePct.error)}</span> : null}
      </form>
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'notifications'>('users');

  return (
    <PageTransition>
      <section>
        <PageHeader title="Settings" eyebrow="Admin only" />
        <div className={cardClass}>
          <div
            className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-100 dark:border-slate-800"
            role="tablist"
            aria-label="Settings categories"
          >
            <button
              type="button"
              role="tab"
              id="tab-users"
              aria-selected={activeTab === 'users'}
              aria-controls="panel-users"
              onClick={() => setActiveTab('users')}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                activeTab === 'users'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              Users
            </button>
            <button
              type="button"
              role="tab"
              id="tab-notifications"
              aria-selected={activeTab === 'notifications'}
              aria-controls="panel-notifications"
              onClick={() => setActiveTab('notifications')}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                activeTab === 'notifications'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              Notifications
            </button>
          </div>
          <div>
            {activeTab === 'users' ? (
              <div role="tabpanel" id="panel-users" aria-labelledby="tab-users" className="animate-fade-in">
                <UsersPanel />
              </div>
            ) : (
              <NotificationsPanel />
            )}
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && bun run test -- SettingsPage.test.tsx`
Expected: PASS — all 4 tests in `SettingsPage.test.tsx` pass.

- [ ] **Step 5: Lint, typecheck, and full test suite**

Run: `cd frontend && bun run lint && bun run typecheck && bun run test`
Expected: PASS with 0 errors across all 30 test files.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/SettingsPage.tsx frontend/src/test/SettingsPage.test.tsx
git commit -m "feat(settings): horizontal tabs with inline Users management"
```

---

## Self-Review

1. **Spec coverage:** Horizontal tab navigation with Users (default) & Notifications, Cluster tab removed, UsersPanel inline (Task 2), `/users` route redirect (Task 1).
2. **Placeholder scan:** None.
3. **Type consistency:** `activeTab` typed `'users' | 'notifications'`, `UsersPanel` imported from `./UsersPage.tsx`.

---

Execution Handoff: Offer execution choice to user.
