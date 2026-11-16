#!/bin/sh
# Restore drill (owner 2026-11-16): proves the newest automatic backup can be
# restored, on a throwaway server, never on the development database.
#
# Runs inside the backup container (postgres:15-alpine, same tools as the
# dump). The target is the `postgres-drill` service: its data lives on tmpfs
# and it publishes no port. Before anything is restored the drill checks that
# the target's system_identifier differs from the source's, so a wrong host
# setting can never restore over kltn_db.
#
# Usage:
#   restore-drill.sh --loop          weekly, Sunday 04:00 Vietnam time, with
#                                    catch-up when the machine was off
#   restore-drill.sh --now [FILE]    once, on FILE or the newest automatic dump
#
# Result: ${BACKUP_DIR}/restore-drill-<stamp>.json with status OK, WARN or FAIL.
#   FAIL: the restore errors, the drill target is the source, or the restored
#         database has no tables, no finished migration or lacks a key table.
#   WARN: a key table's row count differs from the live database by more than
#         5%, or the newest migration differs (a migration ran after the dump).
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB="${PGDATABASE:-kltn_db}"
DRILL_HOST="${DRILL_PGHOST:-postgres-drill}"
DRILL_USER="${DRILL_PGUSER:-postgres}"
DRILL_PASSWORD="${DRILL_PGPASSWORD:-drill}"
DRILL_AT="${RESTORE_DRILL_AT:-04:00}"
DRILL_WEEKDAY="${RESTORE_DRILL_WEEKDAY:-0}" # 0 = Sunday, local time
UTC_OFFSET_MINUTES="${BACKUP_UTC_OFFSET_MINUTES:-420}"
STATE_FILE="${BACKUP_DIR}/.last-restore-drill"
KEY_TABLES="User Submission SpeakingSubmission PlanPurchase PlanPayment MarketOrder BanhTransaction"
TOLERANCE_PERCENT=5

log() { echo "[restore-drill $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

now_epoch() {
  if [ -n "${DRILL_FAKE_NOW:-}" ]; then echo "$DRILL_FAKE_NOW"; else date -u '+%s'; fi
}

# Epoch of the most recent weekly slot at or before $1.
current_slot_epoch() {
  at_h=$(echo "${DRILL_AT%%:*}" | sed 's/^0*//')
  at_m=$(echo "${DRILL_AT##*:}" | sed 's/^0*//')
  offset=$((UTC_OFFSET_MINUTES * 60))
  local_days=$(( ($1 + offset) / 86400 ))
  weekday=$(( (local_days + 4) % 7 )) # 1970-01-01 was a Thursday
  back=$(( (weekday - DRILL_WEEKDAY + 7) % 7 ))
  slot=$(( (local_days - back) * 86400 - offset + (${at_h:-0} * 60 + ${at_m:-0}) * 60 ))
  [ "$slot" -gt "$1" ] && slot=$((slot - 7 * 86400))
  echo "$slot"
}

newest_automatic_dump() {
  ls "${BACKUP_DIR}/${DB}"_*.dump 2>/dev/null |
    grep -E "/${DB}_[0-9]{8}_[0-9]{6}\.dump$" | sort | tail -1
}

src_sql() { psql -tAX -d "$DB" -c "$1" 2>/dev/null; }
drill_sql() {
  PGPASSWORD="$DRILL_PASSWORD" psql -tAX -h "$DRILL_HOST" -U "$DRILL_USER" -d "$1" -c "$2" 2>/dev/null
}

run_drill() {
  file="$1"
  stamp=$(date -u '+%Y%m%d_%H%M%S')
  result="${BACKUP_DIR}/restore-drill-${stamp}.json"
  status=OK
  notes=""
  note() { notes="${notes}${notes:+, }\"$1\""; }
  checks=""

  finish() {
    cat >"$result" <<EOF
{
  "startedAt": "$started",
  "finishedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "dumpFile": "$(basename "$file")",
  "drillHost": "${DRILL_HOST}",
  "status": "${status}",
  "notes": [${notes}],
  "checks": {${checks}}
}
EOF
    echo "$(now_epoch)" >"$STATE_FILE" 2>/dev/null || true
    log "${status}: $(basename "$file") -> $(basename "$result")"
  }

  started=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  if [ ! -s "$file" ]; then
    status=FAIL; note "dump file missing or empty"; finish; return 1
  fi

  src_id=$(src_sql 'select system_identifier from pg_control_system()')
  drill_id=$(drill_sql postgres 'select system_identifier from pg_control_system()')
  if [ -z "$drill_id" ]; then
    status=FAIL; note "drill server ${DRILL_HOST} not reachable"; finish; return 1
  fi
  if [ -n "$src_id" ] && [ "$src_id" = "$drill_id" ]; then
    status=FAIL; note "drill target is the source cluster (${src_id}); refused"; finish; return 1
  fi

  target="drill_${stamp}"
  if ! drill_sql postgres "create database ${target}" >/dev/null; then
    status=FAIL; note "could not create ${target}"; finish; return 1
  fi

  if ! PGPASSWORD="$DRILL_PASSWORD" pg_restore --no-owner --no-privileges --exit-on-error \
    -h "$DRILL_HOST" -U "$DRILL_USER" -d "$target" "$file" 2>"${BACKUP_DIR}/.restore-drill.err"; then
    status=FAIL
    note "pg_restore failed: $(head -c 300 "${BACKUP_DIR}/.restore-drill.err" | tr '"\n' "' ")"
  else
    tables=$(drill_sql "$target" "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
    checks="\"tables\": ${tables:-0}"
    [ "${tables:-0}" -gt 0 ] || { status=FAIL; note "no tables restored"; }

    restored_mig=$(drill_sql "$target" "select migration_name from _prisma_migrations where finished_at is not null order by migration_name desc limit 1")
    live_mig=$(src_sql "select migration_name from _prisma_migrations where finished_at is not null order by migration_name desc limit 1")
    checks="${checks}, \"latestMigration\": \"${restored_mig}\""
    if [ -z "$restored_mig" ]; then
      status=FAIL; note "no finished migration in the restore"
    elif [ -n "$live_mig" ] && [ "$restored_mig" != "$live_mig" ]; then
      [ "$status" = OK ] && status=WARN
      note "newest migration differs from live (${live_mig})"
    fi

    for t in $KEY_TABLES; do
      restored=$(drill_sql "$target" "select count(*) from \"${t}\"")
      live=$(src_sql "select count(*) from \"${t}\"")
      if [ -z "$restored" ]; then
        status=FAIL; note "table ${t} missing in the restore"; continue
      fi
      checks="${checks}, \"${t}\": {\"restored\": ${restored}, \"live\": ${live:-null}}"
      if [ -n "$live" ] && [ "$live" -gt 0 ]; then
        diff=$((restored > live ? restored - live : live - restored))
        if [ $((diff * 100)) -gt $((live * TOLERANCE_PERCENT)) ]; then
          [ "$status" = OK ] && status=WARN
          note "${t}: ${restored} restored vs ${live} live"
        fi
      fi
    done
  fi

  drill_sql postgres "drop database if exists ${target}" >/dev/null ||
    note "could not drop ${target}"
  rm -f "${BACKUP_DIR}/.restore-drill.err"
  finish
  [ "$status" != FAIL ]
}

case "${1:-}" in
  --now)
    file="${2:-$(newest_automatic_dump)}"
    [ -n "$file" ] || { log "FAIL: no automatic dump in ${BACKUP_DIR}"; exit 1; }
    run_drill "$file"
    exit $?
    ;;
  --loop)
    log "starting; weekly day ${DRILL_WEEKDAY} at ${DRILL_AT} (UTC+$((UTC_OFFSET_MINUTES / 60))) on ${DRILL_HOST}"
    while true; do
      now=$(now_epoch)
      slot=$(current_slot_epoch "$now")
      last=$( { tr -dc "0-9" <"$STATE_FILE"; } 2>/dev/null || echo 0)
      if [ "${last:-0}" -ge "$slot" ]; then
        remaining=$((slot + 7 * 86400 - now))
        log "drill for the slot at $(date -u -d "@${slot}" '+%Y-%m-%dT%H:%M:%SZ') already done; next in ${remaining}s"
        [ -n "${DRILL_DECIDE_ONLY:-}" ] && exit 0
        sleep "$remaining"
        continue
      fi
      log "no drill since the slot at $(date -u -d "@${slot}" '+%Y-%m-%dT%H:%M:%SZ'); drill is due"
      [ -n "${DRILL_DECIDE_ONLY:-}" ] && exit 0
      # Give the daily backup a head start after a cold start.
      sleep 120
      file=$(newest_automatic_dump)
      if [ -n "$file" ]; then run_drill "$file"; else log "no automatic dump yet; retrying in 1h"; sleep 3600; fi
    done
    ;;
  *)
    echo "usage: restore-drill.sh --loop | --now [FILE]" >&2
    exit 2
    ;;
esac
