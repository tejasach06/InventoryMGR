# PostgreSQL image agent instructions

The root `AGENTS.md` contains project-wide rules. This guide covers the custom
database image in this directory.

`Dockerfile` builds `gosu` from a pinned upstream commit with the pinned Go
image, then copies the binary into the digest-pinned PostgreSQL 17 Alpine
image. Keep PostgreSQL 17 and the Alpine distribution unless the data migration
plan explicitly changes.

When changing the image, check every consumer: `../docker-compose.yml`,
`../docker-compose.e2e-db.yml`, `../quadlet/inventorymgr-db.container`,
`../.github/workflows/images.yml`, and the PostgreSQL migration and deployment
verification scripts in `../tools/`. Preserve existing database volumes;
image changes do not authorize volume deletion or replacement.

The `.dockerignore` intentionally sends only `Dockerfile` to the build
context. Keep the image build self-contained.
