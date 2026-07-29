# Settings Page: Horizontal Tabs & Inline Users Management Design

## Goal
Redesign `/settings` to use a horizontal tab-strip layout containing two tabs: **Users** (default) and **Notifications**. Remove the **Cluster** quick-select editor (along with unused quick-select infrastructure), embed `<UsersPanel />` directly in Settings, and redirect the standalone `/users` route to `/settings`.

## Scope
- `frontend/src/routes/SettingsPage.tsx`: Convert from vertical sidebar to horizontal tabs; replace quick-select panels with inline `<UsersPanel />` and `<NotificationsPanel />`.
- `frontend/src/app/(app)/users/page.tsx`: Add server-side Next.js `redirect('/settings')`.
- `frontend/src/test/SettingsPage.test.tsx`: Update unit tests for horizontal tabs, inline Users management, Notifications, and absence of Cluster quick-select.

## Design Details

### 1. Settings Navigation Layout (`SettingsPage.tsx`)
- Outer container: `cardClass` wrapper with a horizontal `role="tablist"` header:
  - `<div role="tablist" aria-label="Settings categories" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-100 dark:border-slate-800">`
  - Omit `aria-orientation="vertical"`.
- Two horizontal tabs:
  1. **Users** (`role="tab"`, `id="tab-users"`, `aria-controls="panel-users"`, `aria-selected={activeTab === 'users'}`)
  2. **Notifications** (`role="tab"`, `id="tab-notifications"`, `aria-controls="panel-notifications"`, `aria-selected={activeTab === 'notifications'}`)
- Tab button styling (Instrument Panel flat-by-default design system):
  - Common: `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer`
  - Active tab: `border-[var(--color-accent)] text-[var(--color-accent)]`
  - Inactive tab: `border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200`
- State: `const [activeTab, setActiveTab] = useState<'users' | 'notifications'>('users')`.

### 2. Tab Content Panels
- When `activeTab === 'users'`: render `<UsersPanel />` inside `<div role="tabpanel" id="panel-users" aria-labelledby="tab-users" className="animate-fade-in">`.
- When `activeTab === 'notifications'`: render `<NotificationsPanel />` inside `<div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="animate-fade-in">`.
- Code cleanup: Remove `CategoryPanel`, `OptionRow`, `CATEGORY_ORDER`, `CATEGORY_LABELS`, and `optionsQuery` from `SettingsPage.tsx` as all quick-select option editors (CPU, Datacenter, Disk, OS, Cluster) are removed from the Settings UI.

### 3. Route Redirection (`app/(app)/users/page.tsx`)
- Update `UsersRoute` component to call `redirect('/settings')` from `next/navigation`.
- Anyone attempting to access `/users` directly will be redirected seamlessly to `/settings` (where Users is the default tab).

### 4. Testing Strategy (`SettingsPage.test.tsx`)
- Test that `/settings` renders a horizontal `role="tablist"` containing **Users** and **Notifications** tabs.
- Test that **Users** is selected by default (`aria-selected="true"`) and renders `UsersPanel` content (e.g. user list / "New user" button).
- Test switching to the **Notifications** tab reveals the decommission window and storage warning threshold forms.
- Test that the **Cluster** tab (and former quick-select tabs) are not present.
- Test user creation, role update, or password reset inside the Users tab on SettingsPage.

## Non-Goals
- Dropdown option database tables and API endpoints (`/api/options`) remain untouched on the backend for VM form suggestions.
- Backend auth/RBAC checks for admin access remain required on `/api/users` endpoints.
