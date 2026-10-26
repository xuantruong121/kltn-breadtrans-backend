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
  (cd "$ROOT" && DATABASE_URL="$DB_URL" SHADOW_DATABASE_URL="$DB_URL" npx prisma migrate deploy)
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
      NODE_ENV=development PORT=3101 DATABASE_URL="$DB_URL" SHADOW_DATABASE_URL="$DB_URL" \
      REDIS_URL=redis://127.0.0.1:6392 REDIS_HOST=127.0.0.1 REDIS_PORT=6392 \
      PAYOS_CLIENT_ID= PAYOS_API_KEY= PAYOS_CHECKSUM_KEY= CLOUDFLARE_AI_API_TOKEN= CLOUDFLARE_ACCOUNT_ID= \
      PIXABAY_API_KEY= IMAGE_SEARCH_PROVIDER= VAPID_PRIVATE_KEY= VAPID_PUBLIC_KEY= \
      R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_PRIVATE_ACCESS_KEY_ID= R2_PRIVATE_SECRET_ACCESS_KEY= \
      R2_BACKUP_ACCESS_KEY_ID= R2_BACKUP_SECRET_ACCESS_KEY= R2_BACKUP_ENDPOINT= \
      LOCAL_S3_ENDPOINT=http://127.0.0.1:9460 LOCAL_S3_BUCKET=harness-public LOCAL_S3_ACCESS_KEY_ID=harness \
      LOCAL_S3_SECRET_ACCESS_KEY=harness LOCAL_S3_PUBLIC_URL=http://127.0.0.1:9460/harness-public \
      R2_PRIVATE_ENDPOINT=http://127.0.0.1:9460 R2_PRIVATE_BUCKET_NAME=harness-private \
      R2_PRIVATE_ACCESS_KEY_ID=harness R2_PRIVATE_SECRET_ACCESS_KEY=harness R2_PRIVATE_FORCE_PATH_STYLE=true \
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

case "${1:-}" in
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
  *) echo "usage: $0 up|backend|down"; exit 1 ;;
esac
