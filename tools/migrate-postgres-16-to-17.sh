#!/usr/bin/env bash
# Migrates the Quadlet-managed inventorymgr-db from PostgreSQL 16 to 17.
#
# PostgreSQL major versions are not on-disk compatible: swapping the image
# tag alone (as this repo's docker-compose.yml and quadlet/inventorymgr-db.container
# already do, pinned to postgres:17-alpine) does NOT upgrade existing data
# files. This script dumps the running 16 instance, stands up a fresh 17
# volume, restores into it, and only then repoints the service. The old
# volume is renamed, never deleted, so a rollback is always one command away.
#
# Run this ON THE PRODUCTION HOST, as the user that owns the Quadlet units
# (rootless podman, `systemctl --user`). Requires: podman, systemctl --user,
# the inventorymgr-db.service currently running PostgreSQL 16.
#
# Usage: tools/migrate-postgres-16-to-17.sh
set -euo pipefail

QUADLET_DIR="${HOME}/.config/containers/systemd"
BACKUP_DIR="${HOME}/inventorymgr-pg-migration-$(date +%Y%m%d-%H%M%S)"
OLD_VOLUME="inventorymgr-pgdata"
NEW_VOLUME="inventorymgr-pgdata-pg17"
DUMP_FILE="${BACKUP_DIR}/inventorymgr-full.sql"

log() { echo "[migrate] $*" >&2; }
die() { log "FATAL: $*"; exit 1; }

command -v podman >/dev/null || die "podman not found"
systemctl --user is-active --quiet inventorymgr-db.service \
  || die "inventorymgr-db.service is not running; nothing to migrate"

CURRENT_IMAGE=$(podman inspect inventorymgr-db --format '{{.ImageName}}' 2>/dev/null || true)
log "Current db image: ${CURRENT_IMAGE:-unknown}"
case "$CURRENT_IMAGE" in
  *postgres:16*) : ;;
  *postgres:17*) die "inventorymgr-db is already on Postgres 17 (image: $CURRENT_IMAGE). Nothing to do." ;;
  *) log "WARNING: could not confirm current image is postgres:16 (got '$CURRENT_IMAGE'). Continuing anyway." ;;
esac

mkdir -p "$BACKUP_DIR"
log "Backup directory: $BACKUP_DIR"

# --- Step 1: full logical dump of the running PG16 instance ---
log "Dumping all databases and roles from running PG16 container..."
podman exec inventorymgr-db pg_dumpall -U inventorymgr > "$DUMP_FILE"
[ -s "$DUMP_FILE" ] || die "Dump file is empty; aborting before touching anything"
log "Dump complete: $(du -h "$DUMP_FILE" | cut -f1)"

# --- Step 2: stop the stack ---
log "Stopping inventorymgr services..."
systemctl --user stop inventorymgr-frontend.service inventorymgr-backend.service inventorymgr-db.service

# --- Step 3: create a fresh PG17 volume, never touch the old one ---
log "Creating fresh volume for PG17: $NEW_VOLUME"
podman volume inspect "$NEW_VOLUME" >/dev/null 2>&1 && die "$NEW_VOLUME already exists; delete it first or investigate a prior partial run"
podman volume create "$NEW_VOLUME" >/dev/null

log "Starting a temporary PG17 container against the new volume..."
podman run -d --name inventorymgr-db-pg17-migrate \
  -e POSTGRES_USER=inventorymgr \
  -e POSTGRES_DB=inventorymgr \
  -e POSTGRES_PASSWORD="$(podman secret inspect inventorymgr-postgres-password --showsecret --format '{{.SecretData}}' 2>/dev/null || read -rsp 'POSTGRES_PASSWORD (secret not readable via podman secret inspect on this podman version, enter manually): ' pw && echo "$pw")" \
  -v "${NEW_VOLUME}:/var/lib/postgresql/data" \
  docker.io/library/postgres:17-alpine >/dev/null

log "Waiting for temporary PG17 container to accept connections..."
for i in $(seq 1 30); do
  podman exec inventorymgr-db-pg17-migrate pg_isready -U inventorymgr >/dev/null 2>&1 && break
  sleep 2
  [ "$i" -eq 30 ] && die "Temporary PG17 container never became ready"
done

# --- Step 4: restore the dump into the fresh PG17 instance ---
log "Restoring dump into PG17..."
podman exec -i inventorymgr-db-pg17-migrate psql -U inventorymgr -d postgres < "$DUMP_FILE"

# --- Step 5: sanity check row counts on a known table before cutover ---
log "Row count check (users table) on restored PG17 data:"
podman exec inventorymgr-db-pg17-migrate psql -U inventorymgr -d inventorymgr -tAc "SELECT count(*) FROM users;" \
  || die "Restored PG17 instance failed sanity query; NOT cutting over. Old volume ($OLD_VOLUME) is untouched."

log "Stopping and removing temporary PG17 container (volume persists)..."
podman stop inventorymgr-db-pg17-migrate >/dev/null
podman rm inventorymgr-db-pg17-migrate >/dev/null

# --- Step 6: repoint the volume, keep the old one for rollback ---
log "Renaming old volume for safekeeping: ${OLD_VOLUME} -> ${OLD_VOLUME}-pg16-backup"
podman volume inspect "${OLD_VOLUME}-pg16-backup" >/dev/null 2>&1 && die "${OLD_VOLUME}-pg16-backup already exists from a prior run; resolve manually"
podman volume create "${OLD_VOLUME}-pg16-backup" >/dev/null
# Podman has no native "volume rename"; copy contents via a throwaway container instead.
podman run --rm -v "${OLD_VOLUME}:/from:ro" -v "${OLD_VOLUME}-pg16-backup:/to" docker.io/library/alpine \
  sh -c "cp -a /from/. /to/"

log "Pointing inventorymgr-pgdata.volume unit at the migrated PG17 volume..."
podman volume rm "$OLD_VOLUME"
podman run --rm -v "${NEW_VOLUME}:/from:ro" -v "${OLD_VOLUME}:/to" docker.io/library/alpine \
  sh -c "cp -a /from/. /to/" || {
  log "Could not repopulate ${OLD_VOLUME}; recreating it directly as the volume name instead."
  podman volume create "$OLD_VOLUME" >/dev/null
  podman run --rm -v "${NEW_VOLUME}:/from:ro" -v "${OLD_VOLUME}:/to" docker.io/library/alpine sh -c "cp -a /from/. /to/"
}

log "Restarting stack (quadlet units already pin postgres:17-alpine on docker-compose.yml / quadlet/inventorymgr-db.container)..."
systemctl --user start inventorymgr-db.service
sleep 3
systemctl --user start inventorymgr-backend.service inventorymgr-frontend.service

log "Verifying health endpoints..."
sleep 5
curl -fsS http://127.0.0.1:8000/api/health || die "Backend health check failed post-cutover; investigate before removing backups"
curl -fsS -o /dev/null http://127.0.0.1:3000/ || die "Frontend health check failed post-cutover; investigate before removing backups"

log "SUCCESS. Migration complete."
log "  - Dump kept at: $DUMP_FILE"
log "  - Pre-migration PG16 volume preserved as: ${OLD_VOLUME}-pg16-backup (podman volume rm it once you're confident, not before)"
log "  - Scratch volume: $NEW_VOLUME (safe to remove: podman volume rm $NEW_VOLUME)"
