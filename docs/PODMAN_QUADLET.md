# Podman Quadlet Deployment (Design Spec)

Status: approved, not yet implemented.
Date: 2026-08-12

## Context

InventoryMGR already deploys via `podman compose` (see `justfile` targets
`up`/`down`/`logs`/`ps` and RUNBOOK.md "Deployment: Podman"). That path is
correct for local dev and e2e and is out of scope here — it stays as-is.

What's missing: a production deployment path that runs as systemd-managed,
rootless units instead of a long-lived `podman compose` process tree. Podman
Quadlet (`.container`/`.network`/`.volume` unit files under
`~/.config/containers/systemd/`) is the podman-native way to do this —
systemd owns start/stop/restart/boot instead of a compose supervisor.

## Scope

- Add: Quadlet unit files for `db`, `backend`, `frontend`, plus a shared
  network and a volume, targeting rootless systemd **user** services.
- Add: `just` targets to build images and create podman secrets for prod.
- Add: RUNBOOK.md section documenting the Quadlet deployment flow.
- Not in scope: changing docker-compose*.yml, justfile `up`/`down`/`logs`/`ps`,
  Dockerfiles' internals, PM2 path, or e2e tooling.

## Design

### 1. Image build

Quadlet's `Image=` requires a pre-built image reference — no inline build
like compose's `build:`. Add:

```
just build-prod
```
→ `podman build -t localhost/inventorymgr-backend:latest ./backend`
→ `podman build -t localhost/inventorymgr-frontend:latest --build-arg INVENTORYMGR_API_URL=... ./frontend`

### 2. Secrets

Prod must not use the compose file's inline defaults
(`POSTGRES_PASSWORD:-password`, `JWT_SECRET:-replace-with-32-byte-random-secret`).
Add:

```
just quadlet-secrets
```
→ `podman secret create inventorymgr-jwt-secret -` (reads from generated value, same generator as `just env`)
→ `podman secret create inventorymgr-postgres-password -`

Idempotent: skip creation if the secret already exists.

### 3. Quadlet units

New `quadlet/` directory, files copied to
`~/.config/containers/systemd/` on the target host:

- `inventorymgr.network` — replaces compose's implicit default network.
- `inventorymgr-pgdata.volume` — replaces compose's `pgdata` named volume.
- `inventorymgr-db.container`
  - `Image=docker.io/library/postgres:16-alpine`
  - `Volume=inventorymgr-pgdata.volume:/var/lib/postgresql/data`
  - `Network=inventorymgr.network`
  - `Secret=inventorymgr-postgres-password,type=env,target=POSTGRES_PASSWORD`
  - `HealthCmd=pg_isready -U inventorymgr`
- `inventorymgr-backend.container`
  - `Image=localhost/inventorymgr-backend:latest`
  - `Environment=APP_ENV=production`
  - `Secret=inventorymgr-jwt-secret,type=env,target=JWT_SECRET`
  - `Secret=inventorymgr-postgres-password,type=env,target=POSTGRES_PASSWORD`
  - `Network=inventorymgr.network`
  - `After=inventorymgr-db.service` / `Requires=inventorymgr-db.service`
  - `HealthCmd=curl -f http://localhost:8000/api/health` (mirrors Dockerfile HEALTHCHECK)
- `inventorymgr-frontend.container`
  - `Image=localhost/inventorymgr-frontend:latest`
  - `Network=inventorymgr.network`
  - `After=inventorymgr-backend.service` / `Requires=inventorymgr-backend.service`
  - `HealthCmd=curl -f http://localhost:3000/`

Quadlet has no compose-style `condition: service_healthy` gate — ordering is
`After=`/`Requires=` only. Each app already retries its DB connection on
startup (existing behavior), so this is sufficient; no new retry logic needed.

### 4. Rootless systemd activation

```bash
loginctl enable-linger $USER          # user services survive logout, start at boot
systemctl --user daemon-reload
systemctl --user enable --now inventorymgr-db.service
systemctl --user enable --now inventorymgr-backend.service
systemctl --user enable --now inventorymgr-frontend.service
```

### 5. Docs

Add "Deployment: Podman Quadlet (systemd, rootless)" section to
docs/RUNBOOK.md, alongside the existing "Deployment: Podman" (compose) and
"Deployment: PM2" sections, covering: build, secrets, unit install, activation,
`systemctl --user status`/`journalctl --user -u` for logs, rollback (`systemctl
--user stop` + redeploy prior image tag).

## Testing

- `podman build` both images locally, verify they run under Quadlet on a
  scratch systemd user session (or a container/VM with systemd).
- `systemctl --user status inventorymgr-*.service` all active.
- Health endpoints reachable through the shared network.
- `systemctl --user restart inventorymgr-db.service` — backend/frontend
  recover without manual intervention (existing app-level retry).
