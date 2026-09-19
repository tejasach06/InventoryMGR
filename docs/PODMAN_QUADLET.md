# Podman Quadlet Deployment

Alternative to `docker-compose.yml` for running InventoryMGR as native
systemd-managed Podman containers (rootless). Unit files live in `quadlet/`.

## Units

| File | Purpose |
|---|---|
| `inventorymgr.network` | Shared Podman network for the three services. |
| `inventorymgr-pgdata.volume` | Named volume for Postgres data. |
| `inventorymgr-db.container` | `postgres:17-alpine`. |
| `inventorymgr-backend.container` | FastAPI backend; depends on `inventorymgr-db.service`. |
| `inventorymgr-frontend.container` | Next.js frontend; depends on `inventorymgr-backend.service`. |

Backend/frontend units pull secrets via Podman secrets
(`inventorymgr-jwt-secret`, `inventorymgr-database-url`) rather than plaintext
env vars — see `[Container]` `Secret=` directives.

## First-time setup

```
just quadlet-secrets    # creates inventorymgr-jwt-secret, -postgres-password,
                         # -database-url Podman secrets (idempotent)
just build-prod          # builds backend + frontend images in parallel
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

- Backend health: `HealthCmd=curl -f http://localhost:8000/api/health`,
  published at `127.0.0.1:8000` only (bind to loopback; front a reverse proxy
  for external access).
- Frontend depends on backend being healthy before starting.
- Backup volume mounts to `%h/inventorymgr-backups` on the host.

## Rotating secrets

Podman secrets are immutable once created. To rotate:

```
podman secret rm inventorymgr-jwt-secret
just quadlet-secrets
systemctl --user restart inventorymgr-backend.service
```

Database secrets (`inventorymgr-postgres-password` /
`inventorymgr-database-url`) must be rotated together — `just quadlet-secrets`
refuses to create one without the other (see `justfile`).

## Compose vs. Quadlet

Use `docker-compose.yml` (`just up`/`just down`) for local/dev and CI E2E.
Use Quadlet for a systemd-managed host deployment with secrets and
`Requires=`/`After=` unit ordering instead of Compose's `depends_on`.
