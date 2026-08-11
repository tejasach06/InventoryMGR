# InventoryMGR Design System

InventoryMGR uses an instrument-panel interface for fast, trustworthy infrastructure record keeping. This file records the current implementation contract; historical design decisions remain in `PRODUCT.md` and `docs/superpowers/specs/`.

## Visual Rules

- Saturated color is reserved for semantic data categories: `status`, `criticality`, `environment`, `platform`, `os_family`, and `vm_type`. Chrome surfaces stay neutral.
- Resting components are flat by default with hairline borders and ambient shadows; overlay shadows are for transient drawers and dialogs.
- Technical values such as IPs, UUIDs, memory/CPU sizes, and counts use the mono stack with tabular numbers.
- Frontend components should reuse the shared class constants in `frontend/src/components/ui.tsx` before adding one-off Tailwind recipes.

## Interaction Rules

- All frontend network requests go through `frontend/src/api/client.ts` so CSRF headers and single-shot 401 refresh retries remain centralized.
- Inventory list search, filters, sort, page number, and page size are reflected in URL `searchParams`.
- State-changing actions depend on the backend CSRF/RBAC contract rather than client-only affordances.
