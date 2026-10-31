#!/usr/bin/env bash
# Disposable full-stack harness for learner/Admin browser E2E (finalization).
#
#   up       : disposable PostgreSQL 15 (127.0.0.1:5460) restored from the
#              protected pre-import checkpoint + migrate deploy + approved V2
#              import; disposable Redis (127.0.0.1:6392); backend built to a
#              scratch dir and started on :3101; a second Next dev server of
#              the frontend (build dir .next-harness) on :3100.
#   backend  : rebuild and restart only the harness backend.
#   down     : stop both harness servers and remove both containers.
#
# Lighter commands for API/browser QA on a fresh copy of today's data:
#   containers        : start existing harness-pg / harness-redis (they have no
#                       restart policy, so a Docker restart leaves them Exited)
#   clone <db>        : pg_dump the owner's kltn_db (read-only) and restore it into
#                       harness-pg as <db>, dropping a previous <db>; flush harness Redis
#   fakes             : fake S3 on :9460 (public + private buckets under $WORK)
#   qa-backend <db>   : deterministic-AI backend (scripts/qa/writing-deterministic-server.ts)
#                       on :3101 against harness database <db>; QA_DICTIONARY_URL points
#                       dictionary lookups at a local stand-in
#   qa-frontend <dir> : frontend dev server on :3100 from <dir> (use a worktree, not
#                       the owner's checkout; build dir .next-harness, webpack)
#   stop              : stop :3100, :3101 and :9460 (containers keep running)
# Example: scripts/qa/finalization-harness.sh containers && scripts/qa/finalization-harness.sh clone toeic_sec
#          && scripts/qa/finalization-harness.sh fakes && scripts/qa/finalization-harness.sh qa-backend toeic_sec
#
# Isolation: the backend gets explicit DATABASE_URL/REDIS_URL (they override
# .env, which dotenv never overrides), and every provider or storage-write
# secret is blanked, so no Gemini, Azure, PayOS, Cloudflare AI, Pixabay,
# web-push, R2 write or backup upload can happen. Public R2 media
# (R2_PUBLIC_URL, plain GET) still loads. The private bucket points at a local
# fake S3 (scripts/qa/harness-fake-s3.ts, 127.0.0.1:9460, files under $WORK),
# so private uploads such as speaking audio stay on this machine. The owner's
# servers on :3000/:3001 are never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FE_SRC="$ROOT/../kltn-breadtrans-frontend-junior"
WORK="${HARNESS_WORK:-$TEMP/breadtrans-harness}"
PG=harness-pg
REDIS=harness-redis
DB_URL="postgresql://harness:harness-disposable@127.0.0.1:5460/harness_clone"
# Prisma never needs a shadow here; a refused sentinel, never the database itself.
SHADOW_SENTINEL="postgresql://refused:refused@127.0.0.1:9/no_shadow"
PROTECTED_SYSID=7674533776495505443
# Every external credential/endpoint the backend reads, blanked so dotenv (via
# Prisma) cannot fill it from the owner's .env (see test/safety/external-env.ts).
EXTERNAL_BLANKS="PAYOS_CLIENT_ID= PAYOS_API_KEY= PAYOS_CHECKSUM_KEY= SEPAY_API_TOKEN= SEPAY_WEBHOOK_SECRET= SEPAY_TRANSACTIONS_URL=http://127.0.0.1:9
  CLOUDFLARE_AI_API_TOKEN= CLOUDFLARE_ACCOUNT_ID= PIXABAY_API_KEY= PEXELS_API_KEY= IMAGE_SEARCH_PROVIDER= DICTIONARY_API_BASE_URL=http://127.0.0.1:9
  GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= VAPID_PRIVATE_KEY= VAPID_PUBLIC_KEY=
  R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_BUCKET_NAME= R2_ENDPOINT=
  R2_BACKUP_BUCKET_NAME= R2_BACKUP_ACCESS_KEY_ID= R2_BACKUP_SECRET_ACCESS_KEY= R2_BACKUP_ENDPOINT=
  LOCAL_S3_ENDPOINT=http://127.0.0.1:9460 LOCAL_S3_BUCKET=harness-public LOCAL_S3_ACCESS_KEY_ID=harness
  LOCAL_S3_SECRET_ACCESS_KEY=harness LOCAL_S3_PUBLIC_URL=http://127.0.0.1:9460/harness-public
  R2_PRIVATE_ENDPOINT=http://127.0.0.1:9460 R2_PRIVATE_BUCKET_NAME=harness-private
  R2_PRIVATE_ACCESS_KEY_ID=harness R2_PRIVATE_SECRET_ACCESS_KEY=harness R2_PRIVATE_FORCE_PATH_STYLE=true"
CHECKPOINT="D:/Study/KLTN/.local-backups/breadtrans-auto/kltn_db_PRE_DIAGNOSTIC_V2_IMPORT_PROTECTED_20261026_020536.dump"

kill_port() {
  local pid
  pid=$(netstat -ano | awk -v p=":$1" '$2 ~ p"$" && $4=="LISTENING"{print $5}' | head -1)
  if [ -n "${pid:-}" ]; then taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true; fi
}

start_database() {
  docker run -d --name $PG -e POSTGRES_USER=harness -e POSTGRES_PASSWORD=harness-disposable \
    -e POSTGRES_DB=harness_clone -p 127.0.0.1:5460:5432 postgres:15-alpine >/dev/null
  docker run -d --name $REDIS -p 127.0.0.1:6392:6379 redis:7-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec $PG pg_isready -U harness -d harness_clone >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
  MSYS_NO_PATHCONV=1 docker cp "$CHECKPOINT" $PG:/tmp/ckpt.dump
  MSYS_NO_PATHCONV=1 docker exec $PG pg_restore -U harness -d harness_clone --no-owner --no-acl /tmp/ckpt.dump
  echo "clone sysid: $(docker exec $PG psql -U harness -d harness_clone -tAc 'select system_identifier from pg_control_system()')"
  (cd "$ROOT" && DATABASE_URL="$DB_URL" SHADOW_DATABASE_URL="$SHADOW_SENTINEL" npx prisma migrate deploy)
  (cd "$ROOT" && B2B_TARGET_URL="$DB_URL" npx ts-node --transpile-only scripts/audit/b2b-run.ts import --rehearsal)
}

start_fake_s3() {
  kill_port 9460
  (cd "$ROOT" && nohup npx ts-node --transpile-only scripts/qa/harness-fake-s3.ts 9460 "$WORK/fake-s3" \
      > "$WORK/fake-s3.log" 2>&1 < /dev/null &)
}

# HARNESS_REAL_GRADER=1 keeps only the Gemini and Azure Speech credentials
# from .env and sets DIAGNOSTIC_GRADER_MODE=real, for a bounded real-provider
# smoke; every other provider, payment and storage secret stays blank.
grader_env() {
  if [ "${HARNESS_REAL_GRADER:-}" = "1" ]; then
    echo "DIAGNOSTIC_GRADER_MODE=real"
  else
    echo "GEMINI_API_KEYS= GEMINI_API_KEY= AZURE_SPEECH_KEY= AZURE_SPEECH_REGION= DIAGNOSTIC_GRADER_MODE=mock MOCK_AZURE_SPEECH=true"
  fi
}

start_backend() {
  kill_port 3101
  start_fake_s3
  rm -rf "$WORK/be-dist"
  (cd "$ROOT" && npx tsc -p tsconfig.build.json --outDir "$WORK/be-dist")
  (cd "$ROOT" && env \
      NODE_ENV=development PORT=3101 DATABASE_URL="$DB_URL" SHADOW_DATABASE_URL="$SHADOW_SENTINEL" \
      REDIS_URL=redis://127.0.0.1:6392 REDIS_HOST=127.0.0.1 REDIS_PORT=6392 \
      PAYOS_CLIENT_ID= PAYOS_API_KEY= PAYOS_CHECKSUM_KEY= CLOUDFLARE_AI_API_TOKEN= CLOUDFLARE_ACCOUNT_ID= \
      PIXABAY_API_KEY= IMAGE_SEARCH_PROVIDER= VAPID_PRIVATE_KEY= VAPID_PUBLIC_KEY= \
      R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_PRIVATE_ACCESS_KEY_ID= R2_PRIVATE_SECRET_ACCESS_KEY= \
      R2_BACKUP_ACCESS_KEY_ID= R2_BACKUP_SECRET_ACCESS_KEY= R2_BACKUP_ENDPOINT= \
      LOCAL_S3_ENDPOINT=http://127.0.0.1:9460 LOCAL_S3_BUCKET=harness-public LOCAL_S3_ACCESS_KEY_ID=harness \
      LOCAL_S3_SECRET_ACCESS_KEY=harness LOCAL_S3_PUBLIC_URL=http://127.0.0.1:9460/harness-public \
      R2_PRIVATE_ENDPOINT=http://127.0.0.1:9460 R2_PRIVATE_BUCKET_NAME=harness-private \
      R2_PRIVATE_ACCESS_KEY_ID=harness R2_PRIVATE_SECRET_ACCESS_KEY=harness R2_PRIVATE_FORCE_PATH_STYLE=true \
      TOEIC_LISTENING_MASTER_BASE_URL=http://127.0.0.1:9460/harness-public \
      POSTGRES_BACKUP_DIR="$WORK/backups" $(grader_env) \
      NODE_PATH="$ROOT/node_modules" \
      nohup node "$WORK/be-dist/src/main.js" > "$WORK/backend.log" 2>&1 < /dev/null &
    echo $! > "$WORK/backend.pid")
}

start_frontend() {
  kill_port 3100
  # Same project directory, separate build dir: Turbopack refuses a copied
  # tree whose node_modules is outside its root, and two servers must not
  # share .next.
  (cd "$FE_SRC" && NEXT_DIST_DIR=.next-harness NEXT_PUBLIC_API_URL=http://localhost:3101 \
      NEXT_PUBLIC_VAPID_PUBLIC_KEY= nohup npx next dev -p 3100 > "$WORK/frontend.log" 2>&1 < /dev/null &
    echo $! > "$WORK/frontend.pid")
}

wait_http() {
  for _ in $(seq 1 150); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1")" = "$2" ] && return 0
    sleep 3
  done
  echo "timeout waiting for $1" >&2
  return 1
}

harness_db_url() { echo "postgresql://harness:harness-disposable@127.0.0.1:5460/$1"; }

require_harness_db() {
  local id
  id=$(docker exec $PG psql -U harness -d "$1" -tAc 'select system_identifier from pg_control_system()')
  if [ -z "$id" ] || [ "$id" = "$PROTECTED_SYSID" ]; then
    echo "REFUSED: $1 is not a harness database (sysid '$id')" >&2
    exit 1
  fi
}

case "${1:-}" in
  containers)
    docker start $PG $REDIS >/dev/null
    for _ in $(seq 1 30); do docker exec $PG pg_isready -U harness >/dev/null 2>&1 && break; sleep 1; done
    echo "harness containers up (pg :5460, redis :6392)"
    ;;
  clone)
    db="${2:?usage: $0 clone <db>}"
    case "$db" in kltn_db|kltn_shadow|postgres|harness) echo "REFUSED: reserved name $db" >&2; exit 1;; esac
    mkdir -p "$WORK"
    docker exec kltn-postgres pg_dump -U postgres -d kltn_db -Fc > "$WORK/clone.dump"
    docker exec $PG psql -U harness -d postgres -qc "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;"
    docker exec -i $PG pg_restore -U harness -d "$db" --no-owner --no-acl < "$WORK/clone.dump"
    rm -f "$WORK/clone.dump"
    require_harness_db "$db"
    docker exec $REDIS redis-cli FLUSHALL >/dev/null
    echo "cloned kltn_db into harness database $db; harness Redis flushed"
    ;;
  fakes)
    mkdir -p "$WORK"
    start_fake_s3
    echo "fake s3 :9460 (files under $WORK/fake-s3)"
    ;;
  qa-backend)
    db="${2:?usage: $0 qa-backend <db>}"
    require_harness_db "$db"
    mkdir -p "$WORK"
    kill_port 3101
    # shellcheck disable=SC2086
    (cd "$ROOT" && env NODE_ENV=development PORT=3101 DATABASE_URL="$(harness_db_url "$db")" \
        SHADOW_DATABASE_URL="$SHADOW_SENTINEL" REDIS_URL=redis://127.0.0.1:6392 REDIS_HOST=127.0.0.1 REDIS_PORT=6392 \
        GEMINI_API_KEYS= GEMINI_API_KEY= AZURE_SPEECH_KEY= AZURE_SPEECH_REGION= MOCK_AZURE_SPEECH=true \
        DIAGNOSTIC_GRADER_MODE=mock FRONTEND_URL=http://localhost:3100 \
        R2_PUBLIC_URL="${QA_R2_PUBLIC_URL:-}" TOEIC_LISTENING_MASTER_BASE_URL="${QA_MASTER_BASE_URL:-}" \
        JWT_SECRET=harness-only-jwt-secret POSTGRES_BACKUP_DIR="$WORK/backups" \
        WRITING_QA_COUNTER_FILE="$WORK/grader-calls.json" $EXTERNAL_BLANKS \
        ${QA_DICTIONARY_URL:+DICTIONARY_API_BASE_URL=$QA_DICTIONARY_URL} \
        nohup npx ts-node --transpile-only scripts/qa/writing-deterministic-server.ts \
        > "$WORK/qa-backend.log" 2>&1 < /dev/null &)
    wait_http http://localhost:3101/writing/topics 200
    echo "qa backend :3101 on $db (log $WORK/qa-backend.log)"
    ;;
  qa-frontend)
    dir="${2:?usage: $0 qa-frontend <frontend worktree>}"
    mkdir -p "$WORK"
    kill_port 3100
    (cd "$dir" && NEXT_DIST_DIR=.next-harness NEXT_PUBLIC_API_URL=http://localhost:3101 NEXT_PUBLIC_VAPID_PUBLIC_KEY= \
        NODE_OPTIONS=--max-old-space-size=6144 nohup npx next dev --webpack -p 3100 \
        > "$WORK/qa-frontend.log" 2>&1 < /dev/null &)
    wait_http http://localhost:3100/login 200
    echo "qa frontend :3100 from $dir"
    ;;
  stop)
    kill_port 3100
    kill_port 3101
    kill_port 9460
    echo "harness servers stopped (containers kept)"
    ;;
  up)
    mkdir -p "$WORK"
    start_database
    start_backend
    start_frontend
    echo "harness up: FE http://localhost:3100  BE http://localhost:3101  logs in $WORK"
    ;;
  backend) start_backend; echo "harness backend restarted" ;;
  down)
    kill_port 3100
    kill_port 3101
    kill_port 9460
    docker rm -f $PG $REDIS >/dev/null 2>&1 || true
    echo "harness down"
    ;;
  *) echo "usage: $0 up|backend|down|containers|clone <db>|fakes|qa-backend <db>|qa-frontend <dir>|stop"; exit 1 ;;
esac
