# Phase 4 Inventory Page Structural Refactor

## Scope

Resolved REF-003 by consolidating inventory URL/filter conversion in `frontend/src/lib/inventoryFilters.ts` and extracting the currently rendered desktop table and responsive card into `frontend/src/components/VmTable.tsx` and `frontend/src/components/VmCard.tsx`.

`frontend/src/routes/InventoryPage.tsx` remains responsible for URL synchronization, TanStack Query and mutations, selection, select-all-matching, bulk editing, alerts, pagination orchestration, role gating, and page composition. No backend, API, route, schema, persistence, product behavior, accessibility behavior, or visual design changed.

## Verification

- `cd frontend && bun run test` — PASS
- `cd frontend && bun run lint && bun run typecheck` — PASS
- `cd frontend && bunx playwright test e2e/inventory.spec.ts` — PASS
- `graphify update .` — PASS

Characterization covers repeated URL filters, page/size-to-limit/offset conversion, three-state sorting, bulk filter payloads, selection semantics, accessible table headers and checkbox names, inline edit PATCH shape, responsive card/table rendering, IP-role columns, loading/errors, and role gating.
