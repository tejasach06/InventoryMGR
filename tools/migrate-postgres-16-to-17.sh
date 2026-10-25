#!/usr/bin/env bash
# Run as the rootless Quadlet owner: tools/migrate-postgres-16-to-17.sh --confirm
# Stops application writers before snapshotting. Never deletes/reuses the PG16
# volume. PG17 is promoted only after a strict restore and per-database/table
# count comparison. Both database volumes and private evidence remain for review.
set +x
set -euo pipefail
umask 077

log() { printf '[migrate] %s\n' "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }
[[ $# == 1 && $1 == --confirm ]] || die "Maintenance requires explicit --confirm; read the migration runbook first."
for command in podman systemctl flock mktemp cp cmp; do
  command -v "$command" >/dev/null || die "Required command unavailable: $command"
done

QUADLET_DIR="${HOME}/.config/containers/systemd"
OLD_VOLUME=inventorymgr-pgdata
NEW_VOLUME=inventorymgr-pgdata-pg17
TARGET_IMAGE=docker.io/library/postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb
OVERRIDE_DIR="${QUADLET_DIR}/inventorymgr-db.container.d"
OVERRIDE="${OVERRIDE_DIR}/99-pg17-migration.conf"
[[ -f "${QUADLET_DIR}/inventorymgr-db.container" ]] || die "Expected user database Quadlet not found."
[[ ! -e "$OVERRIDE" && ! -L "$OVERRIDE" ]] || die "Migration override already exists; review the previous run before retrying."
exec 9>"${QUADLET_DIR}/.inventorymgr-pg-migration.lock"
flock -n 9 || die "Another migration holds the maintenance lock."
BACKUP_DIR=$(mktemp -d "${HOME}/inventorymgr-pg-migration-XXXXXXXX")
DUMP_FILE="${BACKUP_DIR}/inventorymgr-full.sql"
SNAPSHOT_VOLUME="inventorymgr-pg16-snapshot-${BACKUP_DIR##*-}"
BOOTSTRAP="inventorymgr_migrate_${BACKUP_DIR##*-}"
BOOTSTRAP="${BOOTSTRAP//-/_}"
DB_STOPPED=0
CONFIG_OWNED=0
SNAPSHOT_OWNED=0
COMMITTED=0
SUCCESS=0
ACTIVE_SERVICES=()
MASKED_SERVICES=()
CIDFILES=()

write_override() {
  local image=$1 volume=$2
  printf '[Container]\nImage=%s\nVolume=\nVolume=%s:/var/lib/postgresql/data\n' "$image" "$volume" > "${BACKUP_DIR}/override.next"
  mv "${BACKUP_DIR}/override.next" "$OVERRIDE"
}

wait_ready() {
  local container=$1 user=$2 i
  for ((i=0; i<60; i++)); do
    if podman exec "$container" pg_isready -U "$user" -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

remove_owned_containers() {
  local cidfile cid failed=0
  for cidfile in "${CIDFILES[@]}"; do
    [[ -s "$cidfile" ]] || continue
    IFS= read -r cid < "$cidfile" || [[ -n "$cid" ]] || { failed=1; continue; }
    if [[ "$cid" =~ ^[a-f0-9]{12,64}$ ]]; then
      if podman container exists "$cid"; then
        podman rm -f "$cid" >> "${BACKUP_DIR}/cleanup.log" 2>&1 || failed=1
      else
        [[ $? == 1 ]] || failed=1
      fi
    else
      failed=1
    fi
  done
  return "$failed"
}

resume_writers() {
  local service
  for service in "${MASKED_SERVICES[@]}"; do
    systemctl --user unmask --runtime "$service" >> "${BACKUP_DIR}/services.log" 2>&1 || return 1
  done
  for service in "${ACTIVE_SERVICES[@]}"; do
    systemctl --user start "$service" >> "${BACKUP_DIR}/services.log" 2>&1 || return 1
  done
}

finish() {
  local status=$? recovered=1
  trap - EXIT INT TERM
  set +e
  remove_owned_containers || { log "Owned container cleanup failed; inspect private cleanup.log and *.cid files."; status=1; }
  if (( SNAPSHOT_OWNED )); then
    podman volume rm "$SNAPSHOT_VOLUME" >> "${BACKUP_DIR}/cleanup.log" 2>&1 || {
      log "Owned PG16 snapshot cleanup failed; original and target volumes remain untouched."
      status=1
    }
  fi
  if (( ! SUCCESS && ! COMMITTED )); then
    if (( DB_STOPPED )); then
      systemctl --user stop inventorymgr-db.service >> "${BACKUP_DIR}/services.log" 2>&1 || recovered=0
    fi
    if (( CONFIG_OWNED )); then
      cp "${BACKUP_DIR}/pg16-recovery.conf" "$OVERRIDE" || recovered=0
      systemctl --user daemon-reload >> "${BACKUP_DIR}/services.log" 2>&1 || recovered=0
    fi
    if (( DB_STOPPED && recovered )); then
      systemctl --user start inventorymgr-db.service >> "${BACKUP_DIR}/services.log" 2>&1 &&
        wait_ready inventorymgr-db inventorymgr || recovered=0
    fi
    if (( recovered )); then
      resume_writers || { log "Recovery could not resume every originally active service."; status=1; }
    else
      log "PG16 recovery failed; writers remain masked. Use the saved recovery config before unmasking."
    fi
    log "No cutover committed. PG16 volume preserved; any PG17 volume is unapproved staging data."
  elif (( ! SUCCESS )); then
    log "PG17 cutover committed; do NOT roll back automatically after writers may have resumed."
  fi
  log "Private evidence and recovery instructions: $BACKUP_DIR"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Do not inspect environment variables or secret data. Podman passes the existing
# secret as a file; neither the shell nor command arguments contain its contents.
systemctl --user is-active --quiet inventorymgr-db.service || die "Database service must be running PG16."
SOURCE_IMAGE=$(podman inspect inventorymgr-db --format '{{.Image}}')
SOURCE_VERSION=$(podman exec inventorymgr-db psql -X -U inventorymgr -d postgres -At -v ON_ERROR_STOP=1 -c 'SHOW server_version_num;' 2> "${BACKUP_DIR}/source.log")
[[ "$SOURCE_VERSION" =~ ^16[0-9]{4}$ ]] || die "Running database is not PostgreSQL 16."
SOURCE_VOLUME=$(podman inspect inventorymgr-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
[[ "$SOURCE_VOLUME" == "$OLD_VOLUME" ]] || die "Unexpected source mount; refusing migration."
podman secret inspect inventorymgr-postgres-password >/dev/null 2>&1 || die "Required Podman password secret unavailable."
for volume in "$NEW_VOLUME" "$SNAPSHOT_VOLUME"; do
  if podman volume exists "$volume"; then
    die "Staging volume already exists: $volume. Review it; this script never deletes prior staging."
  else
    [[ $? == 1 ]] || die "Could not establish staging-volume absence."
  fi
done
for service in inventorymgr-backend.service inventorymgr-frontend.service; do
  state=$(systemctl --user show "$service" -p ActiveState --value)
  case "$state" in
    active) ACTIVE_SERVICES+=("$service") ;;
    inactive|failed) ;;
    *) die "Service is transitioning; wait before retrying: $service" ;;
  esac
  enabled=$(systemctl --user is-enabled "$service" 2>/dev/null || true)
  [[ "$enabled" != masked && "$enabled" != masked-runtime ]] || die "Service is already masked: $service"
done
printf '%s\n' "${ACTIVE_SERVICES[@]}" > "${BACKUP_DIR}/originally-active-services"
printf '%s\n' "$SOURCE_IMAGE" > "${BACKUP_DIR}/source-image"
printf '[Container]\nImage=%s\nVolume=\nVolume=%s:/var/lib/postgresql/data\n' "$SOURCE_IMAGE" "$OLD_VOLUME" > "${BACKUP_DIR}/pg16-recovery.conf"
cat > "${BACKUP_DIR}/RECOVERY.txt" <<EOF
Before writers resume, recovery is safe: stop inventorymgr-db.service; install
pg16-recovery.conf at $OVERRIDE; daemon-reload; start inventorymgr-db.service.
Wait for PG16 readiness, then unmask --runtime both application services and start
ONLY services listed in originally-active-services (all systemctl commands --user).
After PG17 writers resume, stop writers and reconcile new data before any rollback.
Never mount PG16 with a PG17 image. Do not delete either volume before review.
Original PG16 volume: $OLD_VOLUME
PG17 staging/promoted volume: $NEW_VOLUME
EOF

# Pin the real PG16 image for recovery even when the installed Quadlet already
# names PG17. This override is kept on failure rather than restoring an unsafe tag.
mkdir -p "$OVERRIDE_DIR"
CONFIG_OWNED=1
cp "${BACKUP_DIR}/pg16-recovery.conf" "$OVERRIDE"
systemctl --user daemon-reload >> "${BACKUP_DIR}/services.log" 2>&1
log "Freezing application writers before snapshot or dump."
for service in inventorymgr-frontend.service inventorymgr-backend.service; do
  MASKED_SERVICES+=("$service")
  systemctl --user mask --runtime "$service" >> "${BACKUP_DIR}/services.log" 2>&1
  systemctl --user stop "$service" >> "${BACKUP_DIR}/services.log" 2>&1
done
DB_STOPPED=1
systemctl --user stop inventorymgr-db.service >> "${BACKUP_DIR}/services.log" 2>&1
[[ $(podman inspect inventorymgr-db --format '{{.State.Running}}' 2>/dev/null || true) != true ]] || die "Source database still running."

# A stopped, read-only source mount is copied to an owned isolated snapshot.
# PG16 recovery/WAL and dump activity therefore never modify the original volume.
SNAPSHOT_OWNED=1
podman volume create "$SNAPSHOT_VOLUME" >> "${BACKUP_DIR}/containers.log" 2>&1
CIDFILES+=("${BACKUP_DIR}/copy.cid")
podman run --cidfile "${BACKUP_DIR}/copy.cid" --network none \
  -v "${OLD_VOLUME}:/from:ro" -v "${SNAPSHOT_VOLUME}:/to" \
  --entrypoint /bin/sh "$SOURCE_IMAGE" -c 'cp -a /from/. /to/' >> "${BACKUP_DIR}/containers.log" 2>&1
CIDFILES+=("${BACKUP_DIR}/source.cid")
podman run -d --cidfile "${BACKUP_DIR}/source.cid" --network none \
  -v "${SNAPSHOT_VOLUME}:/var/lib/postgresql/data" "$SOURCE_IMAGE" >> "${BACKUP_DIR}/containers.log" 2>&1
SOURCE_CID=$(< "${BACKUP_DIR}/source.cid")
wait_ready "$SOURCE_CID" inventorymgr || die "Isolated PG16 snapshot did not become ready."

manifest() {
  local container=$1 prefix=$2 database
  podman exec "$container" psql -X -U inventorymgr -d postgres -At -v ON_ERROR_STOP=1 \
    -c 'SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname COLLATE "C";' \
    > "${prefix}.databases" 2>> "${BACKUP_DIR}/validation.log" || return 1
  [[ -s "${prefix}.databases" ]] || return 1
  while IFS= read -r database; do
    [[ "$database" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || return 1
    podman exec -i "$container" psql -X -U inventorymgr --dbname="$database" -At -v ON_ERROR_STOP=1 \
      > "${prefix}.${database}.counts" 2>> "${BACKUP_DIR}/validation.log" <<'SQL' || return 1
SELECT format('SELECT %L, count(*) FROM %I.%I;',
              quote_ident(n.nspname) || '.' || quote_ident(c.relname), n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"
\gexec
SQL
  done < "${prefix}.databases"
}

manifest "$SOURCE_CID" "${BACKUP_DIR}/source" || die "Source data manifest failed."
log "Dumping isolated PG16 snapshot; application writers remain stopped."
podman exec "$SOURCE_CID" pg_dumpall -U inventorymgr --quote-all-identifiers > "$DUMP_FILE" 2> "${BACKUP_DIR}/dump.log"
[[ -s "$DUMP_FILE" ]] || die "Logical dump is empty."
ROLE_EXISTS=$(podman exec "$SOURCE_CID" psql -X -U inventorymgr -d postgres -At -v ON_ERROR_STOP=1 \
  -c "SELECT 1 FROM pg_roles WHERE rolname = '$BOOTSTRAP';" 2>> "${BACKUP_DIR}/source.log")
[[ -z "$ROLE_EXISTS" ]] || die "Temporary bootstrap role collides with a source role."
podman volume create "$NEW_VOLUME" >> "${BACKUP_DIR}/containers.log" 2>&1
CIDFILES+=("${BACKUP_DIR}/target.cid")
podman run -d --cidfile "${BACKUP_DIR}/target.cid" --network none \
  --secret inventorymgr-postgres-password,target=pg-migration-password \
  -e "POSTGRES_USER=$BOOTSTRAP" -e POSTGRES_DB=postgres \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/pg-migration-password \
  -v "${NEW_VOLUME}:/var/lib/postgresql/data" "$TARGET_IMAGE" >> "${BACKUP_DIR}/containers.log" 2>&1
TARGET_CID=$(< "${BACKUP_DIR}/target.cid")
wait_ready "$TARGET_CID" "$BOOTSTRAP" || die "Isolated PG17 did not become ready."
log "Restoring with SQL errors fatal; no promotion on incomplete restore."
podman exec -i "$TARGET_CID" psql -X -U "$BOOTSTRAP" -d postgres -v ON_ERROR_STOP=1 \
  < "$DUMP_FILE" > "${BACKUP_DIR}/restore.log" 2>&1
manifest "$TARGET_CID" "${BACKUP_DIR}/target" || die "Target data manifest failed."
cmp -s "${BACKUP_DIR}/source.databases" "${BACKUP_DIR}/target.databases" || die "Database lists differ; refusing promotion."
while IFS= read -r database; do
  cmp -s "${BACKUP_DIR}/source.${database}.counts" "${BACKUP_DIR}/target.${database}.counts" || die "Table counts differ; refusing promotion."
done < "${BACKUP_DIR}/source.databases"
# Separate bootstrap identity avoids pg_dumpall's CREATE ROLE collision. Retain
# its initdb-owned objects, but remove its password, login and elevated privileges.
podman exec "$TARGET_CID" psql -X -U inventorymgr -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE \"$BOOTSTRAP\" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;" \
  >> "${BACKUP_DIR}/restore.log" 2>&1
TARGET_IMAGE_ID=$(podman inspect "$TARGET_CID" --format '{{.Image}}')
remove_owned_containers || die "Could not remove owned migration containers before cutover."

log "Validated restore; switching only the database Quadlet image and volume."
write_override "$TARGET_IMAGE_ID" "$NEW_VOLUME"
systemctl --user daemon-reload >> "${BACKUP_DIR}/services.log" 2>&1
systemctl --user start inventorymgr-db.service >> "${BACKUP_DIR}/services.log" 2>&1
wait_ready inventorymgr-db inventorymgr || die "Promoted database did not become ready; reverting before releasing writers."
PROMOTED_VOLUME=$(podman inspect inventorymgr-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
[[ "$PROMOTED_VOLUME" == "$NEW_VOLUME" ]] || die "Quadlet did not select the validated target volume."
PROMOTED_VERSION=$(podman exec inventorymgr-db psql -X -U inventorymgr -d postgres -At -v ON_ERROR_STOP=1 \
  -c 'SHOW server_version_num;' 2>> "${BACKUP_DIR}/validation.log")
[[ "$PROMOTED_VERSION" =~ ^17[0-9]{4}$ ]] || die "Promoted service is not PostgreSQL 17."
# The irreversible boundary is writer release, not starting the isolated target.
COMMITTED=1
resume_writers || die "PG17 is promoted but some originally active application services did not resume; do not roll back without reconciling writes."
SUCCESS=1
log "SUCCESS. Originally active services resumed. PG16 and PG17 volumes both retained."
log "Do not delete either volume, the override, or the private dump until explicit operator review."
