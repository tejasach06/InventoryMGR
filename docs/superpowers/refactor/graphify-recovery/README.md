# Graphify Index Recovery

- Source commit: `00fd118601069a0842e4c3f3a888e3119b7ae4f0`
- Current graph node count: `4393`
- Plain update command: `graphify update .`
- Plain update status: `0`
- Forced replacement used: `no`
- Decision: `NO_FORCE_NEEDED`

Plain `graphify update .` completed successfully on the current graph without the lower-node-count refusal. This is stronger evidence than forced recovery: the stale-index blocker is already resolved by the current graph, so the isolated extraction and `graphify update . --force` path was not used.

Representative query validation succeeded and produced non-empty evidence files under `/tmp/inventorymgr-graphify-recovery/`:

- Backend audit and health route/service query: `/tmp/inventorymgr-graphify-recovery/query-backend.txt` (`997` bytes)
- Inventory URL filters and table query: `/tmp/inventorymgr-graphify-recovery/query-frontend.txt` (`6432` bytes)
- CSV parsing preview and commit query: `/tmp/inventorymgr-graphify-recovery/query-csv.txt` (`6548` bytes)

The query outputs cite current source paths including `backend/app/api/routes/vms.py`, `backend/app/services/vms.py`, `frontend/src/routes/InventoryPage.tsx`, `frontend/src/lib/inventoryFilters.ts`, `backend/app/services/csv_import.py`, `backend/app/services/csv_import_parsing.py`, `backend/app/api/routes/imports.py`, and `frontend/src/routes/ImportCsvPage.tsx`.

Plain update log: `/tmp/inventorymgr-graphify-recovery/plain-update.log`.
