# Podman Quadlet Deployment

Alternative to `docker-compose.yml` for running InventoryMGR as native
systemd-managed Podman containers (rootless). Unit files live in `quadlet/`.

## Units

| File | Purpose |
|---|---|
| `inventorymgr.network` | Shared Podman network for the three services. |
| `inventorymgr-pgdata.volume` | Named volume for Postgres data. |
| `inventorymgr-db.container` | `postgres:17-alpine`. |
| `inventorymgr-backend.container` | Rust backend; depends on `inventorymgr-db.service`. |
| `inventorymgr-frontend.container` | Next.js frontend; depends on `inventorymgr-backend.service`. |

The database consumes `inventorymgr-postgres-password`. The backend consumes
`inventorymgr-jwt-secret` and `inventorymgr-database-url` as environment secrets.
The frontend has no `Secret=` directives.

## First-time setup

```
just quadlet-secrets    # creates inventorymgr-jwt-secret, -postgres-password,
                         # -database-url Podman secrets (idempotent)
just build-prod          # builds backend then frontend
```

Then copy `quadlet/*.container`, `*.network`, `*.volume` into
`~/.config/containers/systemd/` (rootless) and:

```
systemctl --user daemon-reload
systemctl --user start inventorymgr-db.service
systemctl --user start inventorymgr-backend.service
systemctl --user start inventorymgr-frontend.service
```

Quadlet generates the corresponding `.service` units from the unit files
automatically on `daemon-reload`.

## Health & ports

- Backend health: `HealthCmd=curl -f http://127.0.0.1:8000/api/health`,
  published at `127.0.0.1:8000` only (bind to loopback; front a reverse proxy
  for external access).
- `Requires=` and `After=` order service startup; they do not wait for container
  health. Wait for database readiness, then backend readiness, before starting
  the next consumer. Restart policies can conceal a cold-start failure.
- The backup mount uses `%h/inventorymgr-backups`. The backend runs as container
  UID/GID 1000. For a new rootless mount, set ownership in the Podman user
  namespace (`podman unshare chown 1000:1000 <new-directory>`); do not change an
  existing backup directory or make it world-writable.

## Rotating secrets

Podman secrets are immutable once created. To rotate:

```
podman secret rm inventorymgr-jwt-secret
just quadlet-secrets
systemctl --user restart inventorymgr-backend.service
```

Database secrets (`inventorymgr-postgres-password` /
`inventorymgr-database-url`) must be rotated together . `just quadlet-secrets`
refuses to create one without the other (see `justfile`).

## Compose vs. Quadlet

Use `docker-compose.yml` (`just up`/`just down`) for local/dev and CI E2E.
Use Quadlet for a systemd-managed host deployment with secrets and
`Requires=`/`After=` unit ordering instead of Compose's `depends_on`.

## Deployment verification

Run `just test-deploy-quadlet` from VM101 to build images and verify the unchanged
checked-in units under Aspire's existing rootless user. The verifier refuses
occupied fixed names or ports, creates fresh secrets and storage, checks image
identity and frontend API routing, captures diagnostics, and stops units before
removing only its own resources. This uses explicit readiness-gated startup; it
does not prove unattended boot ordering.

`just test-deploy` verifies Compose first, cleans it up, then verifies Quadlet.
See [the runbook](./RUNBOOK.md#deployment-verification) for prerequisites and
failure recovery.
