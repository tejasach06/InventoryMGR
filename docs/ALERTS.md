# Alerts

Alerts are **synchronous SQL predicates** evaluated on read (dashboard load),
not a background job or event system — no alert history/ack state is
persisted.

## Scope

- Alerts operate on VM inventory rows only (see `backend/app/api/routes/dashboard.py`
  and the alert predicates in `backend/app/services/`).
- `EXCLUDED_TAGS` (`template`, `backup`) are filtered out **case-insensitively**
  before predicates run — tagged VMs never surface an alert regardless of
  their other field values.

## Adding a new alert predicate

1. Express the condition as a SQL/SQLAlchemy predicate over `VM` (and related
   tables), not an in-Python post-filter over loaded rows — keep it
   push-down-able.
2. Apply the `EXCLUDED_TAGS` exclusion the same way existing predicates do.
3. Surface the count/list via the dashboard aggregation endpoint
   (`/api/dashboard`); the frontend renders it via `DashboardPage.tsx`.
4. Add a backend test covering: a VM that should trigger the alert, a VM that
   shouldn't, and a VM excluded solely by tag.

## Current predicate categories

Predicates are evaluated per VM record against fields such as `status`,
`environment`, `criticality`, and staleness of last-updated timestamps.
Consult `backend/app/services/dashboard.py`-adjacent code and
`backend/app/db/enums.py` (`VmStatus`, `Environment`, `Criticality`) for the
authoritative enum values a predicate can branch on.
