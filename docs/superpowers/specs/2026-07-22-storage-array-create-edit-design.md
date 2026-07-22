# Storage Array Create + Edit UI

**Date:** 2026-07-22
**Status:** Design — awaiting review

## Problem

The storage feature shipped with a list page and a detail page, but no way to
**create** a storage array or **edit** an array's own fields. Volumes, LUNs, and
NFS shares are already editable inline on the detail page; only the array-level
entity is read-only in the UI.

## Key finding

The gap is **frontend-only**. The backend and API client already support the
full lifecycle:

- Backend: `create_array` (POST `/storage/arrays`, `EditorUser` + `Csrf`),
  `update_array` (PATCH `/storage/arrays/{id}`), `delete_array`.
- API client (`frontend/src/api/client.ts`): `createArray(payload)`,
  `updateArray(id, Partial<ArrayPayload>)`, `deleteArray(id)`, plus the
  `ArrayPayload` type.

Only the UI wiring is missing. No backend, migration, or client change.

## Design

### 1. Shared `ArrayForm` component

One form reused by both create and edit, avoiding two divergent forms. Fields
map to `ArrayPayload`:

| Field | Input | Required |
|---|---|---|
| name | text | yes |
| vendor | select (synology / netapp) | yes |
| model | text | no |
| mgmt_host | text | no |
| datacenter | text | no |
| total_capacity_gb | number | no |
| used_capacity_gb | number | no |
| description | textarea | no |
| notes | textarea | no |

- Submit disabled until `name` and `vendor` are set. Backend also validates.
- Numeric fields coerced via `Number(v) || 0`.
- Errors surfaced with `detailMessage(err)`, matching existing storage forms.
- Reuses existing input styling from the storage detail forms.

### 2. List page (`StoragePage.tsx`) — create

- `+ New array` button in `PageHeader` actions, rendered only when `canEdit`.
- Toggles an inline card holding a blank `ArrayForm`.
- On submit: `api.createArray(payload)` → invalidate `['arrays']` → collapse
  form → navigate to `/storage/{newId}`.

### 3. Detail page (`StorageDetailPage.tsx`) — edit

- `Edit` button on the Capacity card, rendered only when `canEdit`.
- Swaps the Capacity display into `ArrayForm` prefilled from the loaded `array`.
- On submit: `api.updateArray(id, patch)` → invalidate `['array', id]` and
  `['arrays']` → collapse back to the display.
- Cancel restores the display without a request.

### RBAC

`canEdit = user.role === 'editor' || 'admin'`, the existing rule already used
for volume/LUN/share forms and the delete-array button. Viewers see neither the
`+ New array` nor `Edit` button.

## Testing

Keep vitest global coverage at 80% (lines/statements/functions/branches).

- `StoragePage.test.tsx`: `+ New array` visible for editor, hidden for viewer;
  submitting the form calls `createArray` and refetches the list.
- `StorageDetailPage.test.tsx`: `Edit` toggles the form; submitting calls
  `updateArray` with the patched fields; cancel restores display.

## Out of scope / skipped

- Modal or `Drawer` presentation — inline card is less code and matches the
  page's existing forms.
- Field-level client validation beyond required `name` + `vendor` — backend
  validates the rest.
- Any backend, migration, `client.ts`, or volume/LUN/share change.
