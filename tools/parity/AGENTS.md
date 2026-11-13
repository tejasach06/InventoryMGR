# Parity harness agent instructions

The root `AGENTS.md` contains project-wide rules. This guide covers the Rust
regression harness in this directory.

The harness compares the native API and migration behavior with frozen
baselines. Treat `http_baseline.json`, `openapi_baseline.json`,
`migration_catalog.json`, `migration_head.txt`, and
`historical_initial.sql` as compatibility fixtures. Do not update a baseline
to hide a behavior change; review and explain each expected difference.

For migration changes, verify empty and recognized historical upgrade paths,
including row preservation. Run the migration parity command from the root
guide with this directory's locked Rust dependencies. `just verify` also runs
the HTTP and restore-concurrency parity checks and the browser E2E suite.
