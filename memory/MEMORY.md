InventoryMGR tracks manually entered or CSV-imported VM, storage, and hardware inventory. It does not connect to hypervisors. The production backend is native Rust under `backend-rust/`. Python under `backend/` is a test-only HTTP and migration parity oracle.

The frontend uses Next.js App Router, React, TanStack Query, and nub. Shared UI primitives are in `frontend/src/components/ui.tsx`.

Rootless Podman Compose and Quadlet use service-local backend and frontend build contexts. `deploy.sh` targets `main`. Do not deploy during verification.

Run `just verify` for backend tests, frontend checks, HTTP parity, migration startup scenarios, restore concurrency, and isolated browser workflows. Run `just audit` for dependency advisories and accepted-risk checks. Passing parity does not replace successful workflow assertions.

CSV import requires preview before commit. Disk cells use `name:size[:storage_name[:storage_type]]`. Proxmox matching requires both identity and name.

Alerts exclude `template` and `backup` tags case-insensitively. App and LDAP settings require an administrator. LDAP bind credentials are encrypted at rest.

Keep environment files, build outputs, audit scratch, database dumps, browser reports, and local agent state out of Git. Keep source, lockfiles, native migrations, deployment configuration, and reproducible verification tools in Git.
