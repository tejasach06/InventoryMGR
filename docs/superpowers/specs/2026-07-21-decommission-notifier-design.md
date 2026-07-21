# Decommission Notifier — Design

Date: 2026-07-21
Status: Approved (pending spec review)

## Goal

Surface VMs approaching their `decommission_date` in a persistent notifier so
operators act before the date passes. Bell + dropdown pinned to the top-right
corner, on every app page, with per-user unread tracking.

## Context / existing surface

- `Vm.decommission_date` (`db/models.py` L186) — nullable `date`, user-entered.
  No new VM field needed.
- `Lifecycle` enum: planned/active/retiring/retired. `VmStatus.decommissioned`.
- App shell is a fixed **left sidebar** (`components/Layout.tsx::AppLayout`).
  There is **no top header bar** — the notifier mounts as a `fixed top-right`
  element over `<main>`, rendered once inside `AppLayout`.
- `api/settings/options` is a dropdown-*list* store only; it cannot hold a
  scalar. Hence a new key/value settings table (below).
- Frontend HTTP goes through `api/client.ts` (`credentials: include`, CSRF
  header auto-applied on mutations). Components never call `fetch` directly.

## Due rule

For the current user, a VM is **due** when:

```
decommission_date <= today + N
AND lifecycle != retired
AND status   != decommissioned
```

- `N` = the `decommission_notify_days` setting (default 30).
- Past-dated rows are **included** and marked overdue (`days_remaining < 0`),
  rendered red. The lifecycle/status guards stop already-retired VMs nagging
  forever.
- A due VM is **unread** for user U when no `decommission_ack` row matches
  `(U, vm, current decommission_date)`. Because the acked value is the date
  itself, changing a VM's `decommission_date` re-surfaces it as unread.

`ponytail:` pure date + retired/decommissioned guard only — no other lifecycle
nuance. Upgrade to richer rules only if operators ask.

## Data model — 1 migration, 2 tables

### `app_setting` (key/value scalars)
| col   | type | notes |
|-------|------|-------|
| key   | text | PK |
| value | text | stored as text, parsed per key |

Seed row: `decommission_notify_days = "30"`.

### `decommission_ack` (per-user read state)
| col          | type | notes |
|--------------|------|-------|
| user_id      | uuid | FK users, cascade delete |
| vm_id        | uuid | FK vms, cascade delete |
| acked_date   | date | the `decommission_date` value acknowledged |
| updated_at   | timestamptz | |

Unique `(user_id, vm_id)` — one row per user/VM, upserted. Acks are per-user UI
state, so **no audit rows** are written for them.

## Backend (`backend/app`)

New `services/notifications.py`:
- `list_due(db, user_id) -> list[DueVm]` — runs the due query, joins ack rows,
  computes `days_remaining` and `unread`, sorted soonest-first (overdue first).
- `ack(db, user_id, vm_ids | None)` — upsert ack rows for the given VMs (or all
  currently-due when `None`) with each VM's current `decommission_date`.

New `schemas/notifications.py`: `DueVmRead { vm_id, name, decommission_date,
days_remaining, unread }`, `AckRequest { vm_ids: list[UUID] | None = None }`.

New router `api/routes/notifications.py`, mounted under `/api` in `main.py`:
- `GET  /api/notifications/decommissions` — `ViewerUser` → `list[DueVmRead]`.
- `POST /api/notifications/decommissions/ack` — `ViewerUser` + `Csrf`,
  body `AckRequest` → 204.

Settings scalar folded into existing `api/routes/settings.py`:
- `GET   /api/settings/app` — `ViewerUser` → `{ decommission_notify_days: int }`.
- `PATCH /api/settings/app` — `AdminUser` + `Csrf`, validates positive int → same.

## Frontend (`frontend/src`)

- `components/NotificationBell.tsx` — mounted once in `AppLayout`,
  `fixed top-4 right-4 z-30`. `useQuery(['decommissions'])` polling
  `api.decommissionNotifications()`, `refetchOnWindowFocus` + ~5 min interval.
  - Badge = unread count; hidden when 0.
  - Click toggles a dropdown panel listing due VMs. Each row links to
    `/inventory/[vmId]` (VmDetailPage); overdue rows styled red.
  - Opening the panel fires the ack mutation (ack-all-on-open), then
    invalidates the query so the badge clears. No per-item dismiss.
  - Empty state: "No upcoming decommissions."
- `api/client.ts` additions: `decommissionNotifications()`,
  `ackDecommissions(vmIds?)`, `getAppSettings()`, `updateAppSettings(days)`.
- `routes/SettingsPage.tsx`: admin-only number input for
  `decommission_notify_days` (min 1), save via `updateAppSettings`.

## Tests

Backend (`backend/tests`, real Postgres):
- Due boundaries: exactly `today+N` in, `today+N+1` out.
- Overdue included (`days_remaining < 0`); `lifecycle=retired` and
  `status=decommissioned` excluded.
- unread vs acked; re-surface after `decommission_date` change.
- ack upsert idempotent; ack-all vs explicit `vm_ids`.
- Settings: viewer reads, admin writes, non-admin PATCH → 403, missing CSRF → 403,
  non-positive value rejected.

Frontend (Vitest, 80% thresholds):
- Bell renders unread count; hidden at 0.
- Open panel → ack fires → badge clears.
- Row navigates to VM detail; overdue row carries red style.
- SettingsPage field saves.

E2E: optional single flow (bell visible → open → navigate) — skip unless asked.

## Out of scope (YAGNI)

Email/push notifications, snooze, per-item dismiss, audit rows for acks,
lifecycle-aware nuance beyond the retired/decommissioned guard.
