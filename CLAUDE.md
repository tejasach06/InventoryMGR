# InventoryMGR project instructions

- Use Devbox for project commands. Prefer `devbox run just <recipe>` or `devbox run <script>` from the repository root.
- Before virtualization-domain changes, read `/mnt/d/LL_wiki/wiki/index.md` and follow the relevant Proxmox/vSphere pages needed for the change.
- Use graphify/context-mode helpers for codebase search when generated indexes exist; keep generated `graphify-out/` out of commits.
- Work checkpoint-by-checkpoint. Do not silently expand or shrink checkpoint scope.
- Checkpoint 1 is standalone inventory only: no Proxmox, vCenter, ESXi, or vSphere network calls; no credential storage; no connector sync jobs or connection-test UI.
- PostgreSQL is the selected database. Do not switch to MariaDB during this checkpoint.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
