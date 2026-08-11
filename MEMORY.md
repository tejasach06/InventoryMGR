Deployment/runtime: Use Podman rootless Compose with service-local contexts (`./backend`, `./frontend`), relative Dockerfile paths, and `.dockerignore` exclusions for `.venv`/`node_modules`. Healthchecks target `127.0.0.1`. Deploy via `deploy.sh` on `main`, pruning ignored dev files.
<!-- created=2026-08-01, last=2026-08-07 -->
§
Domain, Alerts & CSV Import: InventoryMGR is a manual VM/storage/hardware inventory (Postgres backend, no hypervisor connection). Alerts are synchronous SQL predicates with case-insensitive `EXCLUDED_TAGS` (`template`, `backup`) filtering. CSV reports export model fields (`cpu_cores`, `memory_mb`, etc.). VM CSV import is the sole importer; disks format is `name:size[:storage_name[:storage_type]]`. Proxmox identity matching requires both `external_id`/`vmid` AND `name` match.
<!-- created=2026-08-01, last=2026-08-07 -->
§
Settings, Theme & Security: Settings authentication uses `ldap3`/`cryptography` with encrypted bind credentials; admin endpoints (`/api/settings/ldap`, `/api/settings/app`) require `AdminUser` (test viewer 403). `ThemeSegmented` (Settings) is the sole theme control; login page forces dark theme.
<!-- created=2026-08-01, last=2026-08-07 -->
§
Frontend Architecture & UI Tokens: Next.js App Router (Bun/Vitest) with Geist font family (`--font-sans`, `--font-mono`, `--font-display`). Layout enforces `min-h-[100dvh]`. Shared UI primitives live in `frontend/src/components/ui.tsx`. Interactive buttons use `active:scale-[0.98]` tactile scaling. NotificationBell renders inline within the sidebar header in `Layout.tsx`.
<!-- created=2026-08-01, last=2026-08-07 -->
