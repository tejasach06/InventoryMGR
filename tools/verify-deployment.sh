#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET=tejas@192.168.0.21
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
RUN_LABEL=inventorymgr.verification.run
PHASE=preflight
WORK=
ROOT=
REMOTE=
RUN=
MODE=
BACKEND=
COMPOSE_FRONTEND=
QUADLET_FRONTEND=
DB_IMAGE=
OWNED_CONTAINERS=()
OWNED_FILES=()
OWNED_SECRETS=()
OWNED_IMAGES=()
OWNED_NETWORKS=()
OWNED_VOLUMES=()
SECRETS=()
QUADLET_STAGED=0
BACKUP_OWNED=0
BACKUP_ID=
CLEANUP_ERRORS=0

fail() { printf 'ERROR [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
note() { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "$PHASE" "$*"; }
need() { command -v "$1" >/dev/null || fail "Missing prerequisite: $1"; }
phase() { PHASE=$1; note "$2"; }
bounded() { timeout --signal=TERM --kill-after=15s "$@"; }
record() { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$WORK/ownership.tsv"; }
image_id() { podman image inspect --format '{{.Id}}' "$1"; }
container_id() { podman container inspect --format '{{.Id}}' "$1"; }

port_free() { [[ -z $(ss -H -ltn "sport = :$1") ]]; }

fixed_preflight() {
    local name unit path
    for name in inventorymgr-db inventorymgr-backend inventorymgr-frontend; do
        ! podman container exists "$name" || fail "Container name occupied (including stopped): $name"
    done
    ! podman network exists inventorymgr || fail 'Network inventorymgr already exists'
    ! podman volume exists inventorymgr-pgdata || fail 'Volume inventorymgr-pgdata already exists'
    for name in inventorymgr-jwt-secret inventorymgr-postgres-password inventorymgr-database-url; do
        ! podman secret exists "$name" || fail "Secret already exists: $name"
    done
    for name in localhost/inventorymgr-backend:latest localhost/inventorymgr-frontend:latest; do
        ! podman image exists "$name" || fail "Image tag already exists: $name"
    done
    [[ ! -e $HOME/inventorymgr-backups && ! -L $HOME/inventorymgr-backups ]] || fail 'Backup directory already exists'
    for name in inventorymgr-network inventorymgr-pgdata-volume inventorymgr-db inventorymgr-backend inventorymgr-frontend; do
        unit=$name.service
        [[ $(systemctl --user show "$unit" -p LoadState --value) == not-found ]] || fail "Unit already registered: $unit"
    done
    while IFS= read -r path; do
        [[ -z $path ]] || fail "Quadlet definition or drop-in already exists: $path"
    done < <(find "$HOME/.config/containers/systemd" /etc/containers/systemd/users /usr/share/containers/systemd/users \
        -name 'inventorymgr*' -print 2>/dev/null || true)
    port_free 3000 || fail 'Port 3000 is occupied'
    port_free 8000 || fail 'Port 8000 is occupied'
}

remote_preflight() {
    local tool free_kb
    [[ $(id -un) == tejas ]] || fail 'Aspire worker must run as tejas'
    for tool in podman systemctl journalctl curl jq python3 openssl ss flock timeout sha256sum tar; do need "$tool"; done
    [[ $(podman info --format '{{.Host.Security.Rootless}}') == true ]] || fail 'Rootless Podman required'
    systemctl --user show-environment >/dev/null || fail 'User systemd bus unavailable; provision the login session first'
    bounded 30s podman compose version >/dev/null 2>&1 || fail 'Podman Compose provider unavailable'
    python3 -c 'import yaml' || fail 'Compose configuration requires the provider Python YAML module'
    fixed_preflight
    free_kb=$(df -Pk "$HOME" | awk 'NR==2 {print $4}')
    (( free_kb >= 10485760 )) || fail 'At least 10 GiB free in Aspire home is required'
    local state=$HOME/.local/state/inventorymgr-deployment-verification
    if [[ -d $state ]]; then
        local manifest pid old_run
        for manifest in "$state"/*/ownership.tsv; do
            [[ -f $manifest ]] || continue
            [[ $manifest != "${WORK:-}/ownership.tsv" ]] || continue
            pid=$(awk -F '\t' '$1=="worker" {print $3; exit}' "$manifest")
            old_run=$(basename "$(dirname "$manifest")")
            if [[ $pid =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && [[ $(tr '\0' ' ' < "/proc/$pid/cmdline") == *"$old_run"* ]]; then
                fail "Active verification worker $pid: $manifest"
            fi
            fail "Abandoned ownership manifest requires ID-checked recovery: $manifest; no resources were reclaimed"
        done
    fi
}

redact() {
    local line secret
    while IFS= read -r line || [[ -n $line ]]; do
        for secret in "${SECRETS[@]}"; do
            [[ -z $secret ]] || line=${line//"$secret"/[REDACTED]}
        done
        printf '%s\n' "$line"
    done
}

capture() {
    local out=$1
    shift
    { bounded 15s "$@" 2>&1 || printf '\nDiagnostic command unavailable or timed out: %s\n' "$?"; } \
        | tail -n 100 | head -c 5242880 | redact > "$WORK/evidence/$out"
}

remember_container() {
    local name=$1 id
    if podman container exists "$name"; then
        id=$(container_id "$name")
        if [[ ! " ${OWNED_CONTAINERS[*]} " == *" $name:$id "* ]]; then
            OWNED_CONTAINERS+=("$name:$id")
            record container "$name" "$id"
        fi
    fi
}

compose() {
    bounded 900s env -i HOME="$HOME" PATH="$PATH" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
        podman compose --project-name "imgr-$RUN" --file "$WORK/compose.yml" "$@"
}

remember_compose() {
    local name
    while IFS= read -r name; do
        [[ -z $name ]] || remember_container "$name"
    done < <(podman ps -a --filter "label=$RUN_LABEL=$RUN" --format '{{.Names}}')
}

remember_quadlet() {
    local name
    for name in inventorymgr-db inventorymgr-backend inventorymgr-frontend; do
        if podman container exists "$name" && [[ $(podman inspect --format '{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}' "$name") == "$name.service" ]]; then
            remember_container "$name"
        fi
    done
    if podman network exists inventorymgr && [[ ! " ${OWNED_NETWORKS[*]} " == *' inventorymgr:'* ]]; then
        OWNED_NETWORKS+=("inventorymgr:$(podman network inspect inventorymgr --format '{{.ID}}')")
        record network inventorymgr "${OWNED_NETWORKS[-1]#*:}"
    fi
    if podman volume exists inventorymgr-pgdata && [[ ! " ${OWNED_VOLUMES[*]} " == *' inventorymgr-pgdata:'* ]]; then
        OWNED_VOLUMES+=("inventorymgr-pgdata:$(podman volume inspect inventorymgr-pgdata --format '{{.CreatedAt}}')")
        record volume inventorymgr-pgdata "${OWNED_VOLUMES[-1]#*:}"
    fi
}

collect() {
    local entry name
    capture containers.txt podman ps -a --format '{{.ID}} {{.Names}} {{.Status}}'
    for entry in "${OWNED_CONTAINERS[@]}"; do
        name=${entry%%:*}
        capture "$name-state.json" podman inspect --format '{{json .State}}' "$name"
        capture "$name.log" podman logs --tail 100 "$name"
    done
    if (( QUADLET_STAGED )); then
        for name in inventorymgr-db inventorymgr-backend inventorymgr-frontend; do
            capture "$name-unit.txt" systemctl --user show "$name.service" \
                -p ActiveState -p SubState -p Result -p ExecMainCode -p ExecMainStatus -p NRestarts -p FragmentPath
            capture "$name-journal.log" journalctl --user --unit "$name.service" --since "$STARTED" --no-pager -n 100
        done
    fi
}

cleanup_problem() { printf 'CLEANUP: %s\n' "$*" >&2; CLEANUP_ERRORS=$((CLEANUP_ERRORS + 1)); }

cleanup_mode() {
    local entry name id path expected current
    if (( QUADLET_STAGED )); then
        remember_quadlet
        for name in inventorymgr-frontend inventorymgr-backend inventorymgr-db inventorymgr-network inventorymgr-pgdata-volume; do
            bounded 60s systemctl --user stop "$name.service" || cleanup_problem "Unable to stop $name.service"
        done
    fi
    if [[ -f $WORK/compose.yml ]]; then
        remember_compose
        compose down --volumes --remove-orphans > "$WORK/evidence/compose-down.log" 2>&1 || cleanup_problem 'Compose down failed'
        rm -f "$WORK/compose.yml"
    fi
    for entry in "${OWNED_CONTAINERS[@]}"; do
        name=${entry%%:*}; id=${entry#*:}
        if podman container exists "$name"; then
            current=$(container_id "$name")
            if [[ $current == "$id" ]]; then
                bounded 60s podman stop --time 30 "$id" >/dev/null || cleanup_problem "Unable to stop $name"
                bounded 30s podman rm "$id" >/dev/null || cleanup_problem "Unable to remove $name"
            else
                cleanup_problem "Container ID changed: $name; left untouched"
            fi
        fi
    done
    for entry in "${OWNED_FILES[@]}"; do
        path=${entry%%:*}; expected=${entry#*:}
        if [[ -f $path ]]; then
            current=$(sha256sum "$path"); current=${current%% *}
            if [[ $current == "$expected" ]]; then rm -- "$path"; else cleanup_problem "Staged file changed: $path"; fi
        fi
    done
    if (( QUADLET_STAGED )); then
        bounded 30s systemctl --user daemon-reload || cleanup_problem 'User manager reload failed'
        for name in inventorymgr-frontend inventorymgr-backend inventorymgr-db inventorymgr-network inventorymgr-pgdata-volume; do
            systemctl --user reset-failed "$name.service" 2>/dev/null || true
            [[ $(systemctl --user show "$name.service" -p LoadState --value) == not-found ]] || cleanup_problem "Generated unit remains: $name"
        done
    fi
    for entry in "${OWNED_NETWORKS[@]}"; do
        name=${entry%%:*}; id=${entry#*:}
        if podman network exists "$name"; then
            if [[ $(podman network inspect "$name" --format '{{.ID}}') == "$id" ]]; then
                bounded 30s podman network rm "$name" >/dev/null || cleanup_problem "Network remains: $name"
            else cleanup_problem "Network ID changed: $name"; fi
        fi
    done
    for entry in "${OWNED_VOLUMES[@]}"; do
        name=${entry%%:*}; id=${entry#*:}
        if podman volume exists "$name"; then
            if [[ $(podman volume inspect "$name" --format '{{.CreatedAt}}') == "$id" ]]; then
                bounded 30s podman volume rm "$name" >/dev/null || cleanup_problem "Volume remains: $name"
            else cleanup_problem "Volume identity changed: $name"; fi
        fi
    done
    for entry in "${OWNED_SECRETS[@]}"; do
        name=${entry%%:*}; id=${entry#*:}
        if podman secret exists "$name"; then
            if [[ $(podman secret inspect --format '{{.ID}}' "$name") == "$id" ]]; then
                bounded 30s podman secret rm "$id" >/dev/null || cleanup_problem "Secret remains: $name"
            else cleanup_problem "Secret ID changed: $name"; fi
        fi
    done
    if (( BACKUP_OWNED )); then
        if [[ $(stat -c '%d:%i' "$HOME/inventorymgr-backups") == "$BACKUP_ID" ]]; then
            bounded 30s podman unshare rm -rf -- "$HOME/inventorymgr-backups" || cleanup_problem 'Backup directory remains'
        else cleanup_problem 'Backup directory identity changed; left untouched'; fi
    fi
    if [[ -d $WORK/backups ]]; then
        bounded 30s podman unshare rm -rf -- "$WORK/backups" || cleanup_problem 'Compose backup directory remains'
    fi
    OWNED_CONTAINERS=(); OWNED_FILES=(); OWNED_SECRETS=(); OWNED_NETWORKS=(); OWNED_VOLUMES=()
    QUADLET_STAGED=0; BACKUP_OWNED=0
}

worker_finish() {
    local rc=$? original=$PHASE entry name id
    trap - EXIT INT TERM HUP
    set +e
    remember_compose
    (( ! QUADLET_STAGED )) || remember_quadlet
    collect
    cleanup_mode
    for entry in "${OWNED_IMAGES[@]}"; do
        name=${entry%%|*}; id=${entry#*|}
        if podman image exists "$name"; then
            if [[ $(image_id "$name") == "$id" ]]; then
                bounded 60s podman image rm "$name" >/dev/null || cleanup_problem "Image remains: $name"
            else cleanup_problem "Image identity changed: $name"; fi
        fi
    done
    rm -f "$WORK/credentials" "$WORK/images.tar"
    podman ps -a --format '{{.ID}} {{.Names}}' | sort > "$WORK/evidence/containers-after.txt"
    if ! cmp -s "$WORK/evidence/containers-before.txt" "$WORK/evidence/containers-after.txt"; then cleanup_problem 'Container identities differ from baseline'; fi
    if (( rc == 0 && CLEANUP_ERRORS > 0 )); then rc=1; fi
    printf 'mode=%s\nphase=%s\nexit_status=%s\ncleanup_errors=%s\n' "$MODE" "$original" "$rc" "$CLEANUP_ERRORS" > "$WORK/evidence/result.env"
    if (( CLEANUP_ERRORS == 0 )); then mv "$WORK/ownership.tsv" "$WORK/evidence/ownership.tsv"; fi
    if (( rc == 0 )); then printf '%s\n' "$(date -u +%FT%TZ)" > "$WORK/evidence/SUCCESS"; fi
    note "Remote result=$rc cleanup_errors=$CLEANUP_ERRORS evidence=$WORK/evidence"
    exit "$rc"
}

wait_sql() {
    bounded 10s podman exec "$DB" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atqc "SELECT 1"' >/dev/null 2>&1
}

wait_for() {
    local end=$((SECONDS + 900))
    until "$@"; do (( SECONDS < end )) || fail "Readiness timed out: $1"; sleep 2; done
}

http_checks() {
    local body status
    body=$(bounded 8s curl --noproxy '*' -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/health") || return
    jq -e '.status == "ok"' <<< "$body" >/dev/null || return
    body=$(bounded 8s curl --noproxy '*' -fsS --max-time 5 "http://127.0.0.1:$WEB_PORT/api/health") || return
    jq -e '.status == "ok"' <<< "$body" >/dev/null || return
    status=$(bounded 8s curl --noproxy '*' -sS -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/") || return
    if [[ $status == 200 ]]; then return; fi
    [[ $status == 307 || $status == 302 ]] || return 1
    [[ $(bounded 8s curl --noproxy '*' -sS -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/login") == 200 ]]
}

check_services() {
    local name state expected
    for name in "$DB" "$API" "$WEB"; do
        state=$(podman inspect "$name" --format '{{.State.Status}} {{.State.Health.Status}} {{.RestartCount}}')
        [[ $state == 'running healthy 0' ]] || return 1
    done
    [[ $(podman inspect "$API" --format '{{.Image}}') == "$BACKEND" ]] || fail 'Backend image identity mismatch'
    expected=$COMPOSE_FRONTEND; [[ $CURRENT == compose ]] || expected=$QUADLET_FRONTEND
    [[ $(podman inspect "$WEB" --format '{{.Image}}') == "$expected" ]] || fail 'Frontend image identity mismatch'
    if [[ $CURRENT == quadlet ]]; then
        for name in "$DB" "$API" "$WEB"; do
            [[ $(systemctl --user show "$name.service" -p ActiveState --value) == active ]] || return 1
            [[ $(systemctl --user show "$name.service" -p NRestarts --value) == 0 ]] || return 1
        done
    fi
}

assert_runtime() {
    local version actual name end
    actual=$(bounded 10s podman exec "$DB" psql -U inventorymgr -d inventorymgr -Atqc 'SELECT version_num FROM alembic_version')
    [[ $actual == 0024 ]] || fail "Unexpected migration ledger: $actual"
    for name in pg_dump pg_restore; do
        version=$(bounded 10s podman exec "$API" "$name" --version)
        [[ $version == *'(PostgreSQL) 17.'* ]] || fail "Wrong PostgreSQL client version: $version"
    done
    [[ $(bounded 10s podman exec "$API" id -u) == 1000 ]] || fail 'Backend is not UID 1000'
    [[ $(podman inspect "$WEB" --format '{{.Config.User}}') == 1000:1000 ]] || fail 'Frontend is not UID 1000'
    wait_for check_services
    end=$((SECONDS + 60))
    while (( SECONDS < end )); do
        check_services || fail 'Service exited, restarted, or became unhealthy during observation'
        http_checks || fail 'HTTP checks failed during observation'
        sleep 5
    done
    note "$CURRENT: migration=0024 clients=17 image_ids=matched stable=60s"
}

run_compose() {
    phase compose 'Starting transferred images with a private Compose project'
    CURRENT=compose
    mkdir "$WORK/backups"
    python3 - "$WORK" "$RUN" <<'PY'
import os, pathlib, secrets, socket, sys, yaml
work=pathlib.Path(sys.argv[1]); run=sys.argv[2]
cfg=yaml.safe_load((work/'docker-compose.yml').read_text())
sockets=[]
for _ in range(3):
    s=socket.socket(); s.bind(('127.0.0.1',0)); sockets.append(s)
ports=[s.getsockname()[1] for s in sockets]
password=secrets.token_hex(32); jwt=secrets.token_hex(32)
(work/'credentials').write_text(password+'\n'+jwt+'\n')
for service,port in zip(('db','backend','frontend'),ports):
    c=cfg['services'][service]
    c['ports']=[f'127.0.0.1:{port}:{dict(db=5432,backend=8000,frontend=3000)[service]}']
    c['labels']={'inventorymgr.verification.run':run}
    c.pop('develop',None)
    if service!='db':
        c.pop('build',None)
        c['image']=os.environ['BACKEND_TAG' if service=='backend' else 'COMPOSE_TAG']
        c['pull_policy']='never'
cfg['services']['db']['environment']={'POSTGRES_USER':'inventorymgr','POSTGRES_DB':'inventorymgr','POSTGRES_PASSWORD':password}
cfg['services']['db']['healthcheck']['test']=['CMD-SHELL','pg_isready -U inventorymgr']
b=cfg['services']['backend']; b['userns_mode']='keep-id:uid=1000,gid=1000'
b['environment']={'APP_ENV':'development','DATABASE_URL':f'postgresql://inventorymgr:{password}@db:5432/inventorymgr','JWT_SECRET':jwt,'BACKUP_DIR':'/var/lib/inventorymgr/backups','SESSION_COOKIE_NAME':f'imgr_{run}','CSRF_COOKIE_NAME':f'csrf_{run}'}
b['volumes']=[str(work/'backups')+':/var/lib/inventorymgr/backups:z']
f=cfg['services']['frontend']; f['environment']={'INVENTORYMGR_API_URL':'http://backend:8000','CSRF_COOKIE_NAME':f'csrf_{run}'}
cfg['volumes']['pgdata']={'labels':{'inventorymgr.verification.run':run}}
cfg['networks']={'default':{'labels':{'inventorymgr.verification.run':run}}}
(work/'compose.yml').write_text(yaml.safe_dump(cfg,sort_keys=False))
(work/'ports').write_text('\n'.join(map(str,ports)))
PY
    mapfile -t SECRETS < "$WORK/credentials"
    mapfile -t ports < "$WORK/ports"
    API_PORT=${ports[1]}; WEB_PORT=${ports[2]}
    record compose "imgr-$RUN" "$WORK/compose.yml"
    compose up --no-build -d db > "$WORK/evidence/compose-start.log" 2>&1
    remember_compose
    DB=$(podman ps -a --filter "label=$RUN_LABEL=$RUN" --filter 'label=com.docker.compose.service=db' --format '{{.Names}}')
    [[ -n $DB ]] || fail 'Compose database identity unavailable'
    wait_for wait_sql
    compose up --no-build -d >> "$WORK/evidence/compose-start.log" 2>&1
    remember_compose
    API=$(podman ps -a --filter "label=$RUN_LABEL=$RUN" --filter 'label=com.docker.compose.service=backend' --format '{{.Names}}')
    WEB=$(podman ps -a --filter "label=$RUN_LABEL=$RUN" --filter 'label=com.docker.compose.service=frontend' --format '{{.Names}}')
    [[ -n $API && -n $WEB ]] || fail 'Compose application identities unavailable'
    wait_for http_checks
    assert_runtime
    collect
    phase compose-restart 'Restarting application containers against the same volume'
    compose restart backend frontend > "$WORK/evidence/compose-restart.log" 2>&1
    wait_for http_checks
    assert_runtime
    collect
    phase compose-cleanup 'Removing only the verification Compose project'
    cleanup_mode
    (( CLEANUP_ERRORS == 0 )) || fail 'Compose cleanup failed; Quadlet will not start'
    port_free "$API_PORT" && port_free "$WEB_PORT" || fail 'Compose listener remains'
    printf 'compose=passed\n' >> "$WORK/evidence/checks.env"
}

create_secret() {
    local name=$1 value=$2 id
    ! podman secret exists "$name" || fail "Secret collision: $name"
    record intent-secret "$name"
    id=$(printf '%s' "$value" | podman secret create --label "$RUN_LABEL=$RUN" "$name" -)
    OWNED_SECRETS+=("$name:$id"); record secret "$name" "$id"
}

run_quadlet() {
    phase quadlet-preflight 'Checking fixed Quadlet resources again'
    fixed_preflight
    CURRENT=quadlet; DB=inventorymgr-db; API=inventorymgr-backend; WEB=inventorymgr-frontend; API_PORT=8000; WEB_PORT=3000
    local password jwt name path sum id generator
    password=$(openssl rand -hex 32); jwt=$(openssl rand -hex 32)
    SECRETS=("$password" "$jwt")
    create_secret inventorymgr-jwt-secret "$jwt"
    create_secret inventorymgr-postgres-password "$password"
    create_secret inventorymgr-database-url "postgresql://inventorymgr:$password@inventorymgr-db:5432/inventorymgr"
    record intent-directory "$HOME/inventorymgr-backups"
    mkdir "$HOME/inventorymgr-backups"; BACKUP_OWNED=1
    BACKUP_ID=$(stat -c '%d:%i' "$HOME/inventorymgr-backups")
    record directory "$HOME/inventorymgr-backups" "$BACKUP_ID"
    podman unshare chown 1000:1000 "$HOME/inventorymgr-backups"
    bounded 30s podman run --rm --pull=never --network none --entrypoint /bin/sh \
        -v "$HOME/inventorymgr-backups:/probe:Z" "$BACKEND_TAG" -c 'test "$(id -u)" = 1000 && touch /probe/.write-probe && rm /probe/.write-probe'
    for name in backend frontend; do
        path=localhost/inventorymgr-$name:latest
        ! podman image exists "$path" || fail "Image collision: $path"
        id=$BACKEND; [[ $name != frontend ]] || id=$QUADLET_FRONTEND
        podman tag "$id" "$path"; OWNED_IMAGES+=("$path|$id"); record image "$path" "$id"
    done
    generator=$(command -v podman-system-generator || true)
    if [[ -z $generator ]]; then
        for path in /usr/lib/systemd/system-generators/podman-system-generator /usr/libexec/podman/quadlet; do
            [[ ! -x $path ]] || { generator=$path; break; }
        done
    fi
    [[ -n $generator ]] || fail 'Quadlet generator not found'
    QUADLET_UNIT_DIRS="$WORK/quadlet" bounded 30s "$generator" --user --dryrun > "$WORK/evidence/quadlet-generator.log" 2>&1
    for name in inventorymgr-db inventorymgr-backend inventorymgr-frontend; do
        grep -q "$name.service" "$WORK/evidence/quadlet-generator.log" || fail "Unit was not generated: $name"
    done
    mkdir -p "$HOME/.config/containers/systemd"
    QUADLET_STAGED=1
    for path in "$WORK"/quadlet/*; do
        name=$HOME/.config/containers/systemd/$(basename "$path")
        [[ ! -e $name && ! -L $name ]] || fail "Quadlet source collision: $name"
        sum=$(sha256sum "$path"); sum=${sum%% *}
        cp --no-clobber "$path" "$name"
        OWNED_FILES+=("$name:$sum"); record file "$name" "$sum"
    done
    bounded 30s systemctl --user daemon-reload
    phase quadlet-start 'Starting systemd units with explicit readiness gates'
    bounded 900s systemctl --user start inventorymgr-db.service
    remember_quadlet
    wait_for wait_sql
    bounded 900s systemctl --user start inventorymgr-backend.service
    remember_quadlet
    wait_for curl --noproxy '*' -fsS --max-time 5 -o /dev/null http://127.0.0.1:8000/api/health
    bounded 900s systemctl --user start inventorymgr-frontend.service
    remember_quadlet
    wait_for http_checks
    assert_runtime
    collect
    phase quadlet-cleanup 'Stopping supervision before removing owned resources'
    cleanup_mode
    (( CLEANUP_ERRORS == 0 )) || fail 'Quadlet cleanup failed'
    port_free 3000 && port_free 8000 || fail 'Quadlet listener remains'
    printf 'quadlet=passed\n' >> "$WORK/evidence/checks.env"
}

worker() {
    RUN=$1; MODE=$2; WORK=$3
    [[ $RUN =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || fail 'Invalid run ID'
    [[ $MODE == all || $MODE == compose || $MODE == quadlet ]] || fail 'Invalid worker mode'
    [[ $WORK == "$HOME/.local/state/inventorymgr-deployment-verification/$RUN" ]] || fail 'Invalid work directory'
    need flock
    mkdir -p "$HOME/.local/state/inventorymgr-deployment-verification"
    exec 9> "$HOME/.local/state/inventorymgr-deployment-verification/lock"
    flock -n 9 || fail 'Another deployment verifier holds the Aspire lock'
    mkdir -p "$WORK/evidence"
    STARTED=$(date -u '+%Y-%m-%d %H:%M:%S')
    record worker "$RUN" "$$"
    trap worker_finish EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
    source "$WORK/images.env"
    podman ps -a --format '{{.ID}} {{.Names}}' | sort > "$WORK/evidence/containers-before.txt"
    remote_preflight
    phase image-load 'Loading transferred images'
    sha256sum -c "$WORK/images.sha256" > "$WORK/evidence/archive-checksum.txt"
    bounded 600s podman load --input "$WORK/images.tar" > "$WORK/evidence/image-load.log" 2>&1
    local tag id expected
    for tag in "$BACKEND_TAG" "${COMPOSE_TAG:-}" "${QUADLET_TAG:-}"; do
        [[ -n $tag ]] || continue
        id=$(image_id "$tag")
        expected=$BACKEND; [[ $tag != "${COMPOSE_TAG:-}" ]] || expected=$COMPOSE_FRONTEND; [[ $tag != "${QUADLET_TAG:-}" ]] || expected=$QUADLET_FRONTEND
        [[ $id == "$expected" ]] || fail "Transferred image mismatch: $tag"
        OWNED_IMAGES+=("$tag|$id"); record image "$tag" "$id"
    done
    export BACKEND_TAG COMPOSE_TAG QUADLET_TAG
    if ! podman image exists "$DB_IMAGE"; then
        bounded 600s podman pull "$DB_IMAGE" > "$WORK/evidence/postgres-pull.log" 2>&1
        OWNED_IMAGES+=("$DB_IMAGE|$(image_id "$DB_IMAGE")")
    fi
    [[ $MODE == quadlet ]] || run_compose
    [[ $MODE == compose ]] || run_quadlet
    phase complete 'Deployment checks passed; final cleanup and baseline comparison follow'
}

controller_finish() {
    local rc=$? remote_rc=0
    trap - EXIT INT TERM HUP
    set +e
    if [[ -n $REMOTE ]]; then
        bounded 60s "${SSH[@]}" "$TARGET" "test ! -d '$REMOTE/evidence' || tar -C '$REMOTE/evidence' -cf - ." > "$WORK/remote-evidence.tar"
        remote_rc=$?
        if (( remote_rc == 0 )); then
            mkdir -p "$WORK/aspire"
            tar -xf "$WORK/remote-evidence.tar" -C "$WORK/aspire"
            if [[ -f $WORK/aspire/result.env ]]; then
                bounded 30s "${SSH[@]}" "$TARGET" "test -e '$REMOTE/ownership.tsv' || rm -rf -- '$REMOTE'" || remote_rc=$?
            fi
        fi
        if (( remote_rc != 0 )); then printf 'Evidence retrieval failed; remote artifacts retained: %s:%s\n' "$TARGET" "$REMOTE" >&2; fi
    fi
    if (( rc == 0 )) && [[ -f $WORK/aspire/SUCCESS ]] && (( remote_rc == 0 )); then
        printf '%s\n' "$(date -u +%FT%TZ)" > "$WORK/SUCCESS"
    elif (( rc == 0 )); then rc=1; fi
    printf 'mode=%s\nphase=%s\nexit_status=%s\nevidence=%s\n' "$MODE" "$PHASE" "$rc" "$WORK" > "$WORK/result.env"
    rm -rf -- "$WORK/stage"
    rm -f "$WORK/images.tar" "$WORK/inputs.tar"
    if (( rc != 0 )); then
        for log in "$WORK"/*build.log "$WORK/worker.log"; do
            [[ ! -f $log ]] || { printf '\n--- %s (last 100 lines) ---\n' "$log" >&2; tail -n 100 "$log" >&2; }
        done
    fi
    note "Result=$rc evidence=$WORK"
    if [[ -f $WORK/aspire/result.env ]]; then cat "$WORK/aspire/result.env"; fi
    exit "$rc"
}

source_checksums() {
    git -C "$ROOT" ls-files -z --cached --others --exclude-standard -- backend-rust frontend docker-compose.yml quadlet \
        | sort -zu | (cd "$ROOT" && xargs -0 sha256sum)
}

controller() {
    MODE=${1:-all}
    case $MODE in
        --help|-h) printf 'Usage: %s [compose|quadlet|all]\nBuild on VM101; verify transferred images on tejas@192.168.0.21.\n' "$0"; return;;
        compose|quadlet|all) ;;
        *) fail 'Usage: verify-deployment.sh [compose|quadlet|all]';;
    esac
    ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
    cd "$ROOT"
    local tool
    for tool in podman ssh scp flock timeout git jq openssl sha256sum tar; do need "$tool"; done
    [[ $(podman info --format '{{.Host.Security.Rootless}}') == true ]] || fail 'Rootless Podman required on VM101'
    mkdir -p "$ROOT/.audit"
    exec 8> "$ROOT/.audit/deployment-verification.lock"
    flock -n 8 || fail 'Another verifier holds the VM101 repository lock'
    RUN=$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)
    WORK=$ROOT/.audit/deployment-$RUN
    mkdir "$WORK"
    trap controller_finish EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    mkdir "$WORK/stage"
    git rev-parse HEAD > "$WORK/revision.txt"
    git diff --quiet && printf 'false\n' > "$WORK/dirty.txt" || printf 'true\n' > "$WORK/dirty.txt"
    source_checksums > "$WORK/source-before.sha256"
    phase preflight "Checking $TARGET before building"
    bounded 60s "${SSH[@]}" "$TARGET" 'bash -s -- --preflight' < "$ROOT/tools/verify-deployment.sh"
    BACKEND_TAG=localhost/inventorymgr-verify-backend:$RUN
    COMPOSE_TAG=; QUADLET_TAG=
    phase build 'Building backend runtime image'
    bounded 1800s podman build --label "$RUN_LABEL=$RUN" -t "$BACKEND_TAG" "$ROOT/backend-rust" > "$WORK/backend-build.log" 2>&1
    BACKEND=$(image_id "$BACKEND_TAG")
    local tags=("$BACKEND_TAG")
    if [[ $MODE != quadlet ]]; then
        COMPOSE_TAG=localhost/inventorymgr-verify-compose:$RUN
        phase build 'Building Compose frontend runtime image'
        bounded 1800s podman build --label "$RUN_LABEL=$RUN" -t "$COMPOSE_TAG" --build-arg INVENTORYMGR_API_URL=http://backend:8000 "$ROOT/frontend" > "$WORK/compose-frontend-build.log" 2>&1
        COMPOSE_FRONTEND=$(image_id "$COMPOSE_TAG"); tags+=("$COMPOSE_TAG")
    fi
    if [[ $MODE != compose ]]; then
        QUADLET_TAG=localhost/inventorymgr-verify-quadlet:$RUN
        phase build 'Building Quadlet frontend runtime image'
        bounded 1800s podman build --label "$RUN_LABEL=$RUN" -t "$QUADLET_TAG" --build-arg INVENTORYMGR_API_URL=http://inventorymgr-backend:8000 "$ROOT/frontend" > "$WORK/quadlet-frontend-build.log" 2>&1
        QUADLET_FRONTEND=$(image_id "$QUADLET_TAG"); tags+=("$QUADLET_TAG")
    fi
    source_checksums > "$WORK/source-after.sha256"
    cmp -s "$WORK/source-before.sha256" "$WORK/source-after.sha256" || fail 'Source changed during image builds'
    DB_IMAGE=$(awk -F= '/^Image=.*postgres/ {print $2}' "$ROOT/quadlet/inventorymgr-db.container")
    [[ $DB_IMAGE == docker.io/library/postgres:17-alpine@sha256:* ]] || fail 'Pinned PostgreSQL image not found'
    cp "$ROOT/tools/verify-deployment.sh" "$WORK/stage/worker.sh"
    cp "$ROOT/docker-compose.yml" "$WORK/stage/docker-compose.yml"
    cp -r "$ROOT/quadlet" "$WORK/stage/quadlet"
    for tool in BACKEND BACKEND_TAG COMPOSE_FRONTEND COMPOSE_TAG QUADLET_FRONTEND QUADLET_TAG DB_IMAGE; do
        printf '%s=%q\n' "$tool" "${!tool}" >> "$WORK/stage/images.env"
    done
    cp "$WORK/stage/images.env" "$WORK/image-identities.env"
    phase transfer 'Exporting and transferring immutable image archive'
    bounded 600s podman save --multi-image-archive --format docker-archive --output "$WORK/images.tar" "${tags[@]}"
    local checksum remote_home
    checksum=$(sha256sum "$WORK/images.tar"); checksum=${checksum%% *}
    printf '%s  images.tar\n' "$checksum" > "$WORK/stage/images.sha256"
    tar -C "$WORK/stage" -cf "$WORK/inputs.tar" .
    remote_home=$(bounded 30s "${SSH[@]}" "$TARGET" 'printf %s "$HOME"')
    [[ $remote_home == /home/tejas ]] || fail "Unexpected remote home: $remote_home"
    REMOTE=$remote_home/.local/state/inventorymgr-deployment-verification/$RUN
    bounded 30s "${SSH[@]}" "$TARGET" "umask 077; mkdir -p '$remote_home/.local/state/inventorymgr-deployment-verification'; mkdir '$REMOTE'"
    bounded 600s scp -q -o BatchMode=yes -o ConnectTimeout=10 "$WORK/images.tar" "$WORK/inputs.tar" "$TARGET:$REMOTE/"
    bounded 30s "${SSH[@]}" "$TARGET" "tar -xf '$REMOTE/inputs.tar' -C '$REMOTE'; rm '$REMOTE/inputs.tar'"
    phase deploy "Verifying $MODE on Aspire"
    "${SSH[@]}" "$TARGET" "cd '$REMOTE' && bash worker.sh --worker '$RUN' '$MODE' '$REMOTE'" > "$WORK/worker.log" 2>&1
}

case ${1:-} in
    --preflight) remote_preflight; note 'Aspire preflight passed';;
    --worker) shift; worker "$@";;
    *) controller "$@";;
esac
