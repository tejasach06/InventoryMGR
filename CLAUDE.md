# InventoryMGR project instructions

- Use Devbox for project commands. Prefer `devbox run just <recipe>` or `devbox run <script>` from the repository root.
- Before virtualization-domain changes, read `/mnt/d/LL_wiki/wiki/index.md` and follow the relevant Proxmox/vSphere pages needed for the change.
- Use graphify/context-mode helpers for codebase search when generated indexes exist; keep generated `graphify-out/` out of commits.
- Work checkpoint-by-checkpoint. Do not silently expand or shrink checkpoint scope.
- Checkpoint 1 is standalone inventory only: no Proxmox, vCenter, ESXi, or vSphere network calls; no credential storage; no connector sync jobs or connection-test UI.
- PostgreSQL is the selected database. Do not switch to MariaDB during this checkpoint.
