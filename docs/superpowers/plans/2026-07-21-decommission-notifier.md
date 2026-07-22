# Decommission Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a top-right bell notifier listing VMs whose `decommission_date` is within (or past) a configurable window, with per-user unread tracking.

**Architecture:** Reuse the existing `Vm.decommission_date` field. Add two tables (`app_settings` scalar store, `decommission_acks` per-user read state), a notifications service + router, a scalar-settings endpoint folded into the settings router, and a `NotificationBell` component mounted once in `AppLayout`. No changes to VM/health/audit code paths.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (`Mapped`/`mapped_column`) + Alembic + Postgres; Next.js App Router + React + TanStack Query + Vitest.

## Global Constraints

- Backend layering: `api/routes/*` (HTTP) → `services/*` (logic) → `db/models.py`. Pydantic schemas live in `schemas/*`, separate from ORM models.
- Every state-changing route MUST take `Csrf` (from `api/deps.py`). RBAC via typed aliases `ViewerUser` / `AdminUser`.
- Backend tests hit **real Postgres** via `conftest.py` (no SQLite). Helpers: `create_user`, `login` (returns CSRF), `auth_headers(csrf)`, `create_vm_row(db, user, **overrides)`. `conftest` rebuilds schema from `Base.metadata` each test — new models are picked up automatically; the Alembic migration is for the real DB only.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Frontend HTTP goes only through `api` in `src/api/client.ts` — never `fetch` in a component. Vitest enforces 80% coverage on lines/statements/functions/branches; `src/app/**` is excluded from coverage (keep logic in `src/routes/` and `src/components/`).
- Single backend test: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest <path>::<name> -v` (Postgres must be up: `just db-up`).
- Single frontend test: `cd frontend && bun run test <path>`.
- Deliberate corner-cuts get a `ponytail:` comment naming the ceiling.

---

### Task 1: Data model + migration

**Files:**
- Modify: `backend/app/db/models.py` (add two models near the other tables; ensure imports)
- Create: `backend/alembic/versions/0013_decommission_notifier.py`
- Test: `backend/tests/test_notifier_models.py`

**Interfaces:**
- Produces: `AppSetting` (`app_settings`: `key` PK str, `value` str) and `DecommissionAck` (`decommission_acks`: `id` uuid PK, `user_id` FK→users cascade, `vm_id` FK→vms cascade, `acked_date` date, timestamps; unique `(user_id, vm_id)`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notifier_models.py
from datetime import date

from app.db.models import AppSetting, DecommissionAck, UserRole
from tests.conftest import create_user, create_vm_row


def test_app_setting_and_ack_persist(db_session):
    db_session.add(AppSetting(key="decommission_notify_days", value="30"))
    db_session.commit()
    assert db_session.get(AppSetting, "decommission_notify_days").value == "30"

    user = create_user(db_session, email="a@example.com", role=UserRole.viewer)
    vm = create_vm_row(db_session, user, decommission_date=date(2026, 8, 1))
    ack = DecommissionAck(user_id=user.id, vm_id=vm.id, acked_date=date(2026, 8, 1))
    db_session.add(ack)
    db_session.commit()
    db_session.refresh(ack)
    assert ack.id is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_notifier_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'AppSetting'`.

- [ ] **Step 3: Add the models**

At the top of `backend/app/db/models.py`, ensure `ForeignKey` and `UniqueConstraint` are in the `from sqlalchemy import (...)` block (add if missing). Then append near the other table classes:

```python
class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)


class DecommissionAck(Base, TimestampMixin):
    __tablename__ = "decommission_acks"
    __table_args__ = (
        UniqueConstraint("user_id", "vm_id", name="uq_decommission_ack_user_vm"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    vm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="CASCADE"), nullable=False
    )
    acked_date: Mapped[date] = mapped_column(Date, nullable=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_notifier_models.py -v`
Expected: PASS.

- [ ] **Step 5: Write the Alembic migration**

```python
# backend/alembic/versions/0013_decommission_notifier.py
"""Add app_settings + decommission_acks; seed decommission_notify_days=30.

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.String(length=255), nullable=False),
    )
    op.create_table(
        "decommission_acks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "vm_id", UUID(as_uuid=True),
            sa.ForeignKey("vms.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("acked_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "vm_id", name="uq_decommission_ack_user_vm"),
    )
    op.execute(
        "INSERT INTO app_settings (key, value) VALUES ('decommission_notify_days', '30')"
    )


def downgrade() -> None:
    op.drop_table("decommission_acks")
    op.drop_table("app_settings")
```

- [ ] **Step 6: Verify migration applies on a real DB**

Run: `cd backend && DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head`
Expected: no error; `alembic current` shows `0013`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/alembic/versions/0013_decommission_notifier.py backend/tests/test_notifier_models.py
git commit -m "feat(db): app_settings + decommission_acks tables"
```

---

### Task 2: App-settings scalar endpoint (N-day window)

**Files:**
- Create: `backend/app/services/app_settings.py`
- Modify: `backend/app/schemas/settings.py` (append two schemas)
- Modify: `backend/app/api/routes/settings.py` (append two routes)
- Test: `backend/tests/test_app_settings.py`

**Interfaces:**
- Consumes: `AppSetting` model (Task 1); `ViewerUser`, `AdminUser`, `Csrf`, `DbSession` from `api/deps.py`.
- Produces: `get_notify_days(db) -> int` and `set_notify_days(db, days) -> int` in `services/app_settings.py`; `AppSettingsRead`/`AppSettingsUpdate` schemas; routes `GET /api/settings/app`, `PATCH /api/settings/app`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_app_settings.py
from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login


def test_get_defaults_to_30(client, db_session):
    create_user(db_session, email="v@example.com", role=UserRole.viewer)
    login(client, "v@example.com")
    r = client.get("/api/settings/app")
    assert r.status_code == 200
    assert r.json()["decommission_notify_days"] == 30


def test_admin_updates_days(client, db_session):
    create_user(db_session, email="admin@example.com", role=UserRole.admin)
    csrf = login(client, "admin@example.com")
    r = client.patch(
        "/api/settings/app",
        json={"decommission_notify_days": 45},
        headers=auth_headers(csrf),
    )
    assert r.status_code == 200
    assert r.json()["decommission_notify_days"] == 45
    assert client.get("/api/settings/app").json()["decommission_notify_days"] == 45


def test_non_admin_patch_forbidden(client, db_session):
    create_user(db_session, email="e@example.com", role=UserRole.editor)
    csrf = login(client, "e@example.com")
    r = client.patch(
        "/api/settings/app", json={"decommission_notify_days": 10}, headers=auth_headers(csrf)
    )
    assert r.status_code == 403


def test_patch_requires_csrf(client, db_session):
    create_user(db_session, email="admin2@example.com", role=UserRole.admin)
    login(client, "admin2@example.com")
    r = client.patch("/api/settings/app", json={"decommission_notify_days": 10})
    assert r.status_code == 403


def test_rejects_non_positive(client, db_session):
    create_user(db_session, email="admin3@example.com", role=UserRole.admin)
    csrf = login(client, "admin3@example.com")
    r = client.patch(
        "/api/settings/app", json={"decommission_notify_days": 0}, headers=auth_headers(csrf)
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_app_settings.py -v`
Expected: FAIL — 404 (routes not defined).

- [ ] **Step 3: Write the service**

```python
# backend/app/services/app_settings.py
from sqlalchemy.orm import Session

from app.db.models import AppSetting

NOTIFY_DAYS_KEY = "decommission_notify_days"
DEFAULT_NOTIFY_DAYS = 30


def get_notify_days(db: Session) -> int:
    row = db.get(AppSetting, NOTIFY_DAYS_KEY)
    if row is None:
        return DEFAULT_NOTIFY_DAYS
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_NOTIFY_DAYS


def set_notify_days(db: Session, days: int) -> int:
    row = db.get(AppSetting, NOTIFY_DAYS_KEY)
    if row is None:
        row = AppSetting(key=NOTIFY_DAYS_KEY, value=str(days))
        db.add(row)
    else:
        row.value = str(days)
    db.commit()
    return days
```

- [ ] **Step 4: Add the schemas**

Append to `backend/app/schemas/settings.py`:

```python
class AppSettingsRead(BaseModel):
    decommission_notify_days: int


class AppSettingsUpdate(BaseModel):
    decommission_notify_days: int = Field(..., ge=1, le=3650)
```

- [ ] **Step 5: Add the routes**

Append to `backend/app/api/routes/settings.py`. Confirm the top-of-file imports include `AdminUser`, `Csrf`, `DbSession`, `ViewerUser` from `app.api.deps` (add `AdminUser` if absent), and add:

```python
from app.schemas.settings import AppSettingsRead, AppSettingsUpdate
from app.services import app_settings
```

Then the routes:

```python
@router.get("/app", response_model=AppSettingsRead)
def get_app_settings(db: DbSession, _: ViewerUser) -> AppSettingsRead:
    return AppSettingsRead(decommission_notify_days=app_settings.get_notify_days(db))


@router.patch("/app", response_model=AppSettingsRead)
def update_app_settings(
    payload: AppSettingsUpdate, db: DbSession, _: AdminUser, __: Csrf
) -> AppSettingsRead:
    days = app_settings.set_notify_days(db, payload.decommission_notify_days)
    return AppSettingsRead(decommission_notify_days=days)
```

Note: these must be registered before any `/{option_id}`-style catch-all in the same router would shadow them — `/app` is a static path and the existing dynamic routes are under `/options/...`, so ordering is not a problem here.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_app_settings.py -v`
Expected: PASS (all 5).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/app_settings.py backend/app/schemas/settings.py backend/app/api/routes/settings.py backend/tests/test_app_settings.py
git commit -m "feat(api): scalar app settings endpoint for notify window"
```

---

### Task 3: Notifications service + router (due list + ack)

**Files:**
- Create: `backend/app/services/notifications.py`
- Create: `backend/app/schemas/notifications.py`
- Create: `backend/app/api/routes/notifications.py`
- Modify: `backend/app/main.py` (import + mount router)
- Test: `backend/tests/test_notifications.py`

**Interfaces:**
- Consumes: `Vm`, `DecommissionAck`, `Lifecycle`, `VmStatus` models; `get_notify_days` (Task 2); `ViewerUser`, `Csrf`, `DbSession`.
- Produces: `list_due(db, user_id) -> list[DueVmRead]` and `ack(db, user_id, vm_ids)`; schemas `DueVmRead`, `AckRequest`; routes `GET /api/notifications/decommissions`, `POST /api/notifications/decommissions/ack`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notifications.py
from datetime import date, timedelta

from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, create_vm_row, login


def _due(client):
    return client.get("/api/notifications/decommissions").json()


def test_lists_within_window_and_overdue(client, db_session):
    user = create_user(db_session, email="v@example.com", role=UserRole.viewer)
    today = date.today()
    create_vm_row(db_session, user, name="soon", decommission_date=today + timedelta(days=5))
    create_vm_row(db_session, user, name="overdue", decommission_date=today - timedelta(days=2))
    create_vm_row(db_session, user, name="far", decommission_date=today + timedelta(days=90))
    login(client, "v@example.com")
    names = {row["name"]: row for row in _due(client)}
    assert set(names) == {"soon", "overdue"}
    assert names["overdue"]["days_remaining"] == -2
    assert names["soon"]["unread"] is True


def test_excludes_retired_and_decommissioned(client, db_session):
    user = create_user(db_session, email="v2@example.com", role=UserRole.viewer)
    today = date.today()
    create_vm_row(
        db_session, user, name="retired",
        decommission_date=today + timedelta(days=1), lifecycle="retired",
    )
    create_vm_row(
        db_session, user, name="gone",
        decommission_date=today + timedelta(days=1), status="decommissioned",
    )
    login(client, "v2@example.com")
    assert _due(client) == []


def test_ack_marks_read_and_resurfaces_on_date_change(client, db_session):
    user = create_user(db_session, email="v3@example.com", role=UserRole.viewer)
    today = date.today()
    vm = create_vm_row(db_session, user, name="x", decommission_date=today + timedelta(days=3))
    csrf = login(client, "v3@example.com")

    client.post(
        "/api/notifications/decommissions/ack", json={"vm_ids": None}, headers=auth_headers(csrf)
    )
    assert _due(client)[0]["unread"] is False

    vm.decommission_date = today + timedelta(days=7)
    db_session.commit()
    assert _due(client)[0]["unread"] is True


def test_ack_requires_csrf(client, db_session):
    create_user(db_session, email="v4@example.com", role=UserRole.viewer)
    login(client, "v4@example.com")
    r = client.post("/api/notifications/decommissions/ack", json={"vm_ids": None})
    assert r.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_notifications.py -v`
Expected: FAIL — 404.

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/notifications.py
import uuid
from datetime import date

from pydantic import BaseModel


class DueVmRead(BaseModel):
    vm_id: uuid.UUID
    name: str
    decommission_date: date
    days_remaining: int
    unread: bool


class AckRequest(BaseModel):
    vm_ids: list[uuid.UUID] | None = None
```

- [ ] **Step 4: Write the service**

```python
# backend/app/services/notifications.py
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DecommissionAck, Lifecycle, Vm, VmStatus
from app.schemas.notifications import DueVmRead
from app.services.app_settings import get_notify_days


def _due_vms(db: Session, cutoff: date) -> list[Vm]:
    stmt = (
        select(Vm)
        .where(Vm.decommission_date.is_not(None))
        .where(Vm.decommission_date <= cutoff)
        .where(Vm.lifecycle != Lifecycle.retired)
        .where(Vm.status != VmStatus.decommissioned)
        .order_by(Vm.decommission_date.asc())
    )
    return list(db.scalars(stmt).all())


def list_due(db: Session, user_id: uuid.UUID) -> list[DueVmRead]:
    today = date.today()
    cutoff = today + timedelta(days=get_notify_days(db))
    vms = _due_vms(db, cutoff)
    acks = {
        a.vm_id: a.acked_date
        for a in db.scalars(
            select(DecommissionAck).where(DecommissionAck.user_id == user_id)
        ).all()
    }
    return [
        DueVmRead(
            vm_id=vm.id,
            name=vm.name,
            decommission_date=vm.decommission_date,
            days_remaining=(vm.decommission_date - today).days,
            unread=acks.get(vm.id) != vm.decommission_date,
        )
        for vm in vms
    ]


def ack(db: Session, user_id: uuid.UUID, vm_ids: list[uuid.UUID] | None) -> None:
    today = date.today()
    cutoff = today + timedelta(days=get_notify_days(db))
    targets = {vm.id: vm.decommission_date for vm in _due_vms(db, cutoff)}
    selected = targets if vm_ids is None else {i: targets[i] for i in vm_ids if i in targets}
    existing = {
        a.vm_id: a
        for a in db.scalars(
            select(DecommissionAck).where(DecommissionAck.user_id == user_id)
        ).all()
    }
    for vm_id, dec_date in selected.items():
        if vm_id in existing:
            existing[vm_id].acked_date = dec_date
        else:
            db.add(DecommissionAck(user_id=user_id, vm_id=vm_id, acked_date=dec_date))
    db.commit()
```

`ponytail:` the two `_due_vms` queries per ack request are fine at inventory scale (hundreds of VMs); add caching only if a profile ever flags it.

- [ ] **Step 5: Write the router**

```python
# backend/app/api/routes/notifications.py
from fastapi import APIRouter, status

from app.api.deps import Csrf, DbSession, ViewerUser
from app.schemas.notifications import AckRequest, DueVmRead
from app.services import notifications

router = APIRouter()


@router.get("/decommissions", response_model=list[DueVmRead])
def list_decommissions(db: DbSession, user: ViewerUser) -> list[DueVmRead]:
    return notifications.list_due(db, user.id)


@router.post("/decommissions/ack", status_code=status.HTTP_204_NO_CONTENT)
def ack_decommissions(
    payload: AckRequest, db: DbSession, user: ViewerUser, __: Csrf
) -> None:
    notifications.ack(db, user.id, payload.vm_ids)
```

- [ ] **Step 6: Mount the router**

In `backend/app/main.py`: add with the other route imports —

```python
from app.api.routes.notifications import router as notifications_router
```

and inside `create_app()` with the other `include_router` calls —

```python
    app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_notifications.py -v`
Expected: PASS (all 4).

- [ ] **Step 8: Lint + commit**

```bash
cd backend && uv run ruff check app tests
cd .. && git add backend/app/services/notifications.py backend/app/schemas/notifications.py backend/app/api/routes/notifications.py backend/app/main.py backend/tests/test_notifications.py
git commit -m "feat(api): decommission notifications list + ack"
```

---

### Task 4: Frontend API client methods + types

**Files:**
- Modify: `frontend/src/api/client.ts` (add types + `api` methods)
- Test: `frontend/src/test/apiClient.test.ts` (add one case following existing style)

**Interfaces:**
- Produces: `DueVm` interface, `AppSettings` interface; `api.decommissionNotifications()`, `api.ackDecommissions(vmIds?)`, `api.getAppSettings()`, `api.updateAppSettings(days)`.

- [ ] **Step 1: Add types + methods**

Near the other exported interfaces in `client.ts`:

```ts
export interface DueVm {
  vm_id: string;
  name: string;
  decommission_date: string;
  days_remaining: number;
  unread: boolean;
}

export interface AppSettings {
  decommission_notify_days: number;
}
```

Inside the `api` object (before the closing `}` at the end of the object literal):

```ts
  decommissionNotifications: () => apiRequest<DueVm[]>('/notifications/decommissions'),
  ackDecommissions: (vmIds?: string[]) =>
    apiRequest<null>('/notifications/decommissions/ack', {
      method: 'POST',
      body: JSON.stringify({ vm_ids: vmIds ?? null }),
    }),
  getAppSettings: () => apiRequest<AppSettings>('/settings/app'),
  updateAppSettings: (days: number) =>
    apiRequest<AppSettings>('/settings/app', {
      method: 'PATCH',
      body: JSON.stringify({ decommission_notify_days: days }),
    }),
```

- [ ] **Step 2: Add a client test (matches existing mock-fetch style)**

Open `frontend/src/test/apiClient.test.ts`, reuse whatever mock-fetch setup it already uses, and add a case asserting the ack path + body. Intent (adapt names to the file's helpers):

```ts
it('ackDecommissions posts null vm_ids when omitted', async () => {
  const fetchMock = mockFetchOk(null); // reuse the file's existing helper/spy
  await api.ackDecommissions();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/notifications/decommissions/ack'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ vm_ids: null }) }),
  );
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `cd frontend && bun run test src/test/apiClient.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/test/apiClient.test.ts
git commit -m "feat(web): api client methods for notifier + app settings"
```

---

### Task 5: NotificationBell component + mount

**Files:**
- Create: `frontend/src/components/NotificationBell.tsx`
- Modify: `frontend/src/components/Layout.tsx` (import + render `<NotificationBell />`)
- Test: `frontend/src/test/NotificationBell.test.tsx`

**Interfaces:**
- Consumes: `api.decommissionNotifications`, `api.ackDecommissions`, `DueVm` (Task 4); TanStack Query; `next/link`; `cn` from `../lib/classNames`.
- Produces: `NotificationBell` named export mounted in `AppLayout`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/test/NotificationBell.test.tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../components/NotificationBell';
import { renderWithProviders } from './utils';
import { api } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: { ...actual.api, decommissionNotifications: vi.fn(), ackDecommissions: vi.fn() },
  };
});

const due = [
  { vm_id: '1', name: 'web-01', decommission_date: '2026-08-01', days_remaining: 5, unread: true },
  { vm_id: '2', name: 'db-02', decommission_date: '2026-07-10', days_remaining: -3, unread: false },
];

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.mocked(api.decommissionNotifications).mockResolvedValue(due as never);
    vi.mocked(api.ackDecommissions).mockResolvedValue(null as never);
  });

  it('hides the badge when nothing is unread', async () => {
    vi.mocked(api.decommissionNotifications).mockResolvedValueOnce([] as never);
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(api.decommissionNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId('notif-badge')).toBeNull();
  });

  it('opens panel, lists VMs, marks overdue red, and acks on open', async () => {
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('notif-badge')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('web-01')).toBeInTheDocument();
    expect(screen.getByText('db-02').closest('a')).toHaveClass('text-red-600');
    await waitFor(() => expect(api.ackDecommissions).toHaveBeenCalledWith());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/NotificationBell.test.tsx`
Expected: FAIL — cannot resolve `../components/NotificationBell`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/NotificationBell.tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { cn } from '../lib/classNames';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ['decommissions'],
    queryFn: api.decommissionNotifications,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });
  const unread = data.filter((d) => d.unread).length;

  const ack = useMutation({
    mutationFn: () => api.ackDecommissions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['decommissions'] }),
  });

  // ack-all-on-open: mark everything currently listed as read when the panel opens
  useEffect(() => {
    if (open && unread > 0 && !ack.isPending) ack.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="fixed right-4 top-4 z-30">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span data-testid="notif-badge" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900" role="menu">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming decommissions</p>
          {data.length === 0 ? (
            <p className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">No upcoming decommissions.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {data.map((d) => (
                <li key={d.vm_id}>
                  <Link
                    href={`/inventory/${d.vm_id}`}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800',
                      d.days_remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200',
                    )}
                  >
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="flex-shrink-0 text-xs">
                      {d.days_remaining < 0 ? `${-d.days_remaining}d overdue` : `in ${d.days_remaining}d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in AppLayout**

In `frontend/src/components/Layout.tsx`: add `import { NotificationBell } from './NotificationBell';` and render `<NotificationBell />` as the first child inside the outermost `<div className="min-h-screen ...">` (it is `position: fixed`, so tree placement does not affect layout):

```tsx
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:flex">
      <NotificationBell />
      <aside ...>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && bun run test src/test/NotificationBell.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck + commit**

```bash
cd frontend && bun run typecheck
cd .. && git add frontend/src/components/NotificationBell.tsx frontend/src/components/Layout.tsx frontend/src/test/NotificationBell.test.tsx
git commit -m "feat(web): decommission notification bell"
```

---

### Task 6: Settings page — notify-window field

**Files:**
- Modify: `frontend/src/routes/SettingsPage.tsx` (add a "Notifications" tab + field)
- Test: `frontend/src/test/SettingsPage.test.tsx` (add one case)

**Interfaces:**
- Consumes: `api.getAppSettings`, `api.updateAppSettings` (Task 4).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/SettingsPage.test.tsx`, following the file's existing `api` mock (ensure `getAppSettings`/`updateAppSettings` are mocked — extend the existing `vi.mock('../api/client', ...)` block to include them):

```tsx
it('saves the decommission notify window', async () => {
  vi.mocked(api.getAppSettings).mockResolvedValue({ decommission_notify_days: 30 });
  vi.mocked(api.updateAppSettings).mockResolvedValue({ decommission_notify_days: 60 });
  renderWithProviders(<SettingsPage />);
  fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
  const input = await screen.findByLabelText(/days before decommission/i);
  fireEvent.change(input, { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: /save window/i }));
  await waitFor(() => expect(api.updateAppSettings).toHaveBeenCalledWith(60));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun run test src/test/SettingsPage.test.tsx`
Expected: FAIL — no "Notifications" tab / label.

- [ ] **Step 3: Add the Notifications panel component**

In `SettingsPage.tsx`, add above the `SettingsPage` function (imports `useQuery`, `useMutation`, `useQueryClient`, `api`, `detailMessage`, `inputClass`, `primaryButtonClass`, `Spinner`, `useState`, `useMemo` are already imported in this file):

```tsx
function NotificationsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'app'], queryFn: api.getAppSettings });
  const [days, setDays] = useState('');
  useMemo(() => {
    if (settingsQuery.data) setDays(String(settingsQuery.data.decommission_notify_days));
  }, [settingsQuery.data]);
  const save = useMutation({
    mutationFn: () => api.updateAppSettings(Number(days)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  return (
    <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="animate-fade-in">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (Number(days) >= 1) save.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="notify-days">
            Days before decommission to warn
          </label>
          <input id="notify-days" type="number" min={1} className={inputClass + ' max-w-32'} value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={save.isPending || Number(days) < 1}>
          {save.isPending ? <><Spinner /> Saving…</> : 'Save window'}
        </button>
        {save.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(save.error)}</span> : null}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab**

In `SettingsPage`, widen the tab state type and add the tab + panel:

1. Change `const [activeTab, setActiveTab] = useState<DropdownCategory | 'users'>('cpu');` to `useState<DropdownCategory | 'users' | 'notifications'>('cpu');`.
2. After the existing Users `<button ...>Users</button>` tab, add:

```tsx
              <button
                key="notifications"
                type="button"
                role="tab"
                id="tab-notifications"
                aria-selected={activeTab === 'notifications'}
                aria-controls="panel-notifications"
                onClick={() => setActiveTab('notifications')}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  activeTab === 'notifications'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                Notifications
              </button>
```

3. In the panel switch, insert the notifications branch:

```tsx
            {activeTab === 'users' ? (
              <div role="tabpanel" id="panel-users" aria-labelledby="tab-users" className="animate-fade-in">
                <UsersPanel />
              </div>
            ) : activeTab === 'notifications' ? (
              <NotificationsPanel />
            ) : (
              <CategoryPanel category={activeTab} options={grouped[activeTab]} />
            )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && bun run test src/test/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
cd frontend && bun run typecheck
cd .. && git add frontend/src/routes/SettingsPage.tsx frontend/src/test/SettingsPage.test.tsx
git commit -m "feat(web): settings field for decommission notify window"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the whole gate**

Run: `just verify`
Expected: ruff + pytest + lint + typecheck + vitest + playwright all green. Fix any Vitest coverage gaps (80% thresholds) by extending the Task 5/6 tests — do not lower thresholds.

- [ ] **Step 2: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 3: Commit any verification fixups**

```bash
git add -A && git commit -m "test: cover decommission notifier edge cases"
```

---

## Self-review notes

- Spec "due rule" (date ≤ today+N, exclude retired/decommissioned, overdue included) → Task 3 `test_lists_within_window_and_overdue` + `test_excludes_retired_and_decommissioned`.
- Spec "unread keyed to acked date, re-surface on date change" → Task 3 `test_ack_marks_read_and_resurfaces_on_date_change`.
- Spec "configurable N via new settings row + UI" → Task 1 (table+seed), Task 2 (endpoint), Task 6 (UI).
- Spec "bell top-right, badge, ack-all-on-open, overdue red, links to detail" → Task 5.
- Type consistency: `DueVm`/`DueVmRead` fields (`vm_id`, `name`, `decommission_date`, `days_remaining`, `unread`) identical across backend schema, client type, and component. `decommission_notify_days` identical across model seed, service key, schema, endpoint, and UI.
