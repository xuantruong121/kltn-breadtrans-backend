#!/usr/bin/env bash
# Capacity run for 1000 learners on a VPS-sized share of this machine
# (owner 2026-11-09). Postgres and Redis are the harness containers; the API and
# Caddy run from compose.capacity.yml with CPU/RAM limits.
#
#   run-capacity.sh up <harness-db> [S|M] [pool] [two]
#        S = 2 vCPU / 4 GB ("Cheap 4"), M = 4 vCPU / 8 GB.
#        pool = Prisma connection_limit per API (default 20, as production; 5 is
#        what Prisma picks by itself on 2 CPUs). two = a second API behind Caddy.
#   run-capacity.sh run <label> [ramp|spike]   k6 + samples -> out/<label>/
#   run-capacity.sh down                        stop, lift the limits
#
# Refuses any database that is not a harness copy. Never touches :3000/:3001.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/out"
PROTECTED_SYSID=7674533776495505443
PG=harness-pg
REDIS=harness-redis
STATE="$OUT/.state"
mkdir -p "$OUT"

# logs / down need the variables compose interpolates, not their values.
compose_quiet() {
  (cd "$DIR" && CAP_DATABASE_URL="${CAP_DATABASE_URL:-x}" CAP_MASTER_DIR="${CAP_MASTER_DIR:-x}" \
    CAP_VAPID_PUBLIC="${CAP_VAPID_PUBLIC:-x}" CAP_VAPID_PRIVATE="${CAP_VAPID_PRIVATE:-x}" \
    MSYS_NO_PATHCONV=1 docker compose -f compose.capacity.yml "$@")
}

scale() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%g", a * b }'; }

require_harness_db() {
  local id
  id=$(docker exec $PG psql -U harness -d "$1" -tAc 'select system_identifier from pg_control_system()')
  if [ -z "$id" ] || [ "$id" = "$PROTECTED_SYSID" ]; then
    echo "REFUSED: $1 is not a harness database (sysid '$id')" >&2
    exit 1
  fi
}

case "${1:-}" in
  up)
    DB="${2:?harness db name}"
    PROFILE="${3:-S}"
    POOL="${4:-20}"
    TWO="${5:-}"
    require_harness_db "$DB"
    K=1; [ "$PROFILE" = "M" ] && K=2
    # Like a VPS, every backend container shares the same 2 (S) or 4 (M) CPUs
    # and takes what it needs; k6 runs on the other CPUs. CAP_SPLIT=1 instead
    # gives each container a fixed share (the first runs; it starves the API
    # while Postgres, Redis and Caddy leave theirs idle).
    if [ "$K" = 1 ]; then CPUSET=0,1; K6_CPUSET=2-$(( $(docker info --format '{{.NCPU}}') - 1 )); else CPUSET=0-3; K6_CPUSET=4-$(( $(docker info --format '{{.NCPU}}') - 1 )); fi
    if [ "${CAP_SPLIT:-}" = 1 ]; then
      docker update --cpus "$(scale 0.6 $K)" --memory "$(scale 1400 $K)m" --memory-swap "$(scale 1400 $K)m" $PG >/dev/null
      docker update --cpus "$(scale 0.15 $K)" --memory "$(scale 400 $K)m" --memory-swap "$(scale 400 $K)m" $REDIS >/dev/null
    else
      docker update --cpus "$((2 * K))" --cpuset-cpus "$CPUSET" --memory "$(scale 1400 $K)m" --memory-swap "$(scale 1400 $K)m" $PG >/dev/null
      docker update --cpus "$((2 * K))" --cpuset-cpus "$CPUSET" --memory "$(scale 400 $K)m" --memory-swap "$(scale 400 $K)m" $REDIS >/dev/null
      export CAP_CPUSET="$CPUSET"
    fi
    export CAP_DATABASE_URL="postgresql://harness:harness-disposable@host.docker.internal:5460/$DB?schema=public&connection_limit=$POOL&pool_timeout=10"
    # By default no local TOEIC master build is mounted: like production, the
    # API finds the master in the private bucket (seed-capacity.ts puts it in
    # the fake one). CAP_LOCAL_MASTER=1 mounts the local build instead.
    mkdir -p "$OUT/no-local-master"
    if [ "${CAP_LOCAL_MASTER:-}" = 1 ]; then
      export CAP_MASTER_DIR="${CAP_MASTER_DIR:-D:/Study/KLTN/Project/kltn-breadtrans-backend/artifacts/toeic-listening-master}"
    else
      export CAP_MASTER_DIR="$(cd "$OUT/no-local-master" && (pwd -W 2>/dev/null || pwd))"
    fi
    if [ "${CAP_SPLIT:-}" = 1 ]; then
      export CAP_API_CPUS="$(scale 1.1 $K)" CAP_CADDY_CPUS="$(scale 0.15 $K)"
    else
      export CAP_API_CPUS=0 CAP_CADDY_CPUS=0
    fi
    export CAP_API_MEM="$(scale 1400 $K)m"
    VAPID=$(cd "$DIR/../.." && node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
    export CAP_VAPID_PUBLIC="${VAPID% *}" CAP_VAPID_PRIVATE="${VAPID#* }"
    if [ "$TWO" = "two" ]; then
      # Two APIs share the API budget; Postgres keeps its share.
      [ "${CAP_SPLIT:-}" = 1 ] && export CAP_API_CPUS="$(scale 0.55 $K)"
      export CAP_API_MEM="$(scale 700 $K)m" CAP_CADDYFILE=Caddyfile.capacity-two
      (cd "$DIR" && MSYS_NO_PATHCONV=1 docker compose -f compose.capacity.yml --profile two-apis up -d api api-2 caddy)
    else
      (cd "$DIR" && MSYS_NO_PATHCONV=1 docker compose -f compose.capacity.yml up -d api caddy)
    fi
    echo "DB=$DB PROFILE=$PROFILE POOL=$POOL TWO=${TWO:-no} CPUS=${CAP_SPLIT:+split}${CAP_SPLIT:-shared:$CPUSET} K6_CPUSET=$K6_CPUSET" > "$STATE"
    for _ in $(seq 1 60); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3201/api/health)" = 200 ] && { echo "capacity API up ($PROFILE, pool $POOL${TWO:+, two APIs})"; exit 0; }
      sleep 3
    done
    echo "capacity API did not come up" >&2
    compose_quiet logs --tail 40 api >&2
    exit 1
    ;;
  run)
    LABEL="${2:?label}"
    MODE="${3:-ramp}"
    # shellcheck disable=SC1090
    . "$STATE"
    R="$OUT/$LABEL"
    mkdir -p "$R"
    cp "$STATE" "$R/setup.txt"
    STARTED=$(date +%s)
    # Samples every 5 s: container CPU / memory / network, and Postgres connections.
    (
      echo "time,container,cpu,mem,net" > "$R/samples.csv"
      echo "time,state,count" > "$R/pg.csv"
      while [ ! -f "$R/.done" ]; do
        t=$(date +%s)
        docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}}" \
          $(docker ps --format '{{.Names}}' | grep -E 'breadtrans-capacity|harness-pg|harness-redis') 2>/dev/null |
          sed "s/^/$t,/" >> "$R/samples.csv" || true
        docker exec $PG psql -U harness -d "$DB" -tAc \
          "select coalesce(state,'none'), count(*) from pg_stat_activity where datname = '$DB' group by 1" 2>/dev/null |
          sed "s/|/,/; s/^/$t,/" >> "$R/pg.csv" || true
        sleep 5
      done
    ) &
    SAMPLER=$!
    set +e
    MSYS_NO_PATHCONV=1 docker run --rm --network breadtrans-capacity_default --cpuset-cpus "$K6_CPUSET" \
      -v "$(cd "$DIR" && pwd -W 2>/dev/null || pwd):/scripts" \
      -e BASE_URL=http://caddy:80 -e DATA=/scripts/out/capacity-data.json \
      -e JWT_SECRET=capacity-isolated-jwt-secret -e MODE="$MODE" -e T0="$(date +%s%3N)" \
      -e AUDIO_MODE="${AUDIO_MODE:-url}" -e STEP_SECONDS="${STEP_SECONDS:-180}" -e HOLD_SECONDS="${HOLD_SECONDS:-600}" -e MAX_VUS="${MAX_VUS:-1000}" \
      grafana/k6 run --quiet --summary-export "/scripts/out/$LABEL/summary.json" \
      --out "csv=/scripts/out/$LABEL/metrics.csv.gz" /scripts/learner-realistic.js \
      > "$R/k6.txt" 2>&1
    K6=$?
    set -e
    touch "$R/.done"
    wait $SAMPLER 2>/dev/null || true
    rm -f "$R/.done"
    for c in $(docker ps --format '{{.Names}}' | grep -E 'breadtrans-capacity-api'); do
      docker logs --since "$STARTED" "$c" 2>&1 | sed 's/\[[0-9;]*m//g' |
        grep -E 'PHASE812_RUNTIME|ERROR|Error|Timed out fetching|P20[0-9][0-9]' || true
    done > "$R/api.log"
    echo "k6 exit $K6 -> $R"
    ;;
  down)
    compose_quiet --profile two-apis down || echo "compose down failed; removing the containers directly" >&2
    # Whatever compose left behind (it failed silently once and kept the stack up).
    left=$(docker ps -aq --filter label=com.docker.compose.project=breadtrans-capacity)
    [ -n "$left" ] && docker rm -f $left >/dev/null && echo "removed leftover capacity containers"
    docker network rm breadtrans-capacity_default >/dev/null 2>&1 || true
    docker update --cpus "$(docker info --format "{{.NCPU}}")" --cpuset-cpus "0-$(( $(docker info --format "{{.NCPU}}") - 1 ))" --memory 8g --memory-swap 8g $PG $REDIS >/dev/null || true
    rm -f "$STATE"
    echo "capacity stack down; harness Postgres/Redis limits lifted"
    ;;
  *)
    sed -n 2,14p "$0"
    exit 1
    ;;
esac
