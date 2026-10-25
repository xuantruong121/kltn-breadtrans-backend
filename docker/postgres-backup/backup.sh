#!/bin/sh
# Scheduled logical backup of the BreadTrans development database.
#
# Runs inside a postgres:15-alpine container so pg_dump/pg_restore major
# versions always match the server. Writes custom-format archives to the
# host-mounted /backups directory (outside the Postgres data volume).
#
# Scheduling is driven by the last VERIFIED automatic backup that exists in the
# persistent backup directory, not by how long this container has been up. A
# host reboot therefore no longer restarts the clock: if the newest automatic
# backup is already older than the interval the next one runs immediately, and
# if it is newer only the remaining time is waited.
#
# This worker only runs while Docker/the host runs. It cannot create backups
# while the machine is powered off; it catches the missed period up on the next
# start instead. See docs/database-safety.md.
#
# Safety rules implemented here:
#   * a dump is only accepted after `pg_restore -l` can list it;
#   * a failed or empty dump never overwrites or deletes a previous good one;
#   * retention deletion runs only after a new backup verified successfully;
#   * retention only ever matches this script's own automatic filename pattern
#     (<db>_YYYYMMDD_HHMMSS.dump), so every labelled or manual dump is exempt;
#   * the newest verified backup is never deleted;
#   * files containing PROTECTED in the name are exempt from retention;
#   * a failed cycle never advances the schedule and never prunes.
set -u

BACKUP_DIR=/backups
INTERVAL="${BACKUP_INTERVAL_SECONDS:-21600}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DB="${PGDATABASE:-kltn_db}"

# Readiness retry: Docker's restart policy can start this container before
# Postgres accepts connections, and `depends_on` is not re-evaluated on a
# daemon restart. Waiting briefly is far better than losing a whole cycle.
READY_RETRY_SECONDS="${POSTGRES_READY_RETRY_SECONDS:-30}"
READY_MAX_ATTEMPTS="${POSTGRES_READY_MAX_ATTEMPTS:-20}"
# A failed cycle retries on this short window instead of the full interval.
FAILURE_RETRY_SECONDS="${BACKUP_FAILURE_RETRY_SECONDS:-300}"

# Persistent record of the last verified automatic backup. It lives in the
# mounted backup directory, so it survives container recreation. The dump files
# themselves remain the authoritative source; this is a cross-check.
STATE_FILE="${BACKUP_DIR}/.last-automatic-success"

# Tolerance for a clock that moves backwards (NTP correction, VM resume).
CLOCK_SKEW_TOLERANCE=300

log() {
  echo "[pg-backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

now_epoch() {
  date -u '+%s'
}

# Scheduling math is done in epoch seconds only; the human-readable stamp is
# used for filenames and logs, never for arithmetic.
stamp_to_epoch() {
  date -u -D '%Y%m%d_%H%M%S' -d "$1" '+%s' 2>/dev/null
}

# An automatic backup is exactly <db>_YYYYMMDD_HHMMSS.dump. Anything with a
# label (PROTECTED, PRE_*, POST_*, handoff, baseline, manual snapshots) is a
# different class of file: it never drives the schedule and is never pruned.
automatic_stamp_of() {
  base=$(basename "$1" .dump)
  stamp=${base#"${DB}_"}
  [ "$stamp" = "$base" ] && return 1
  echo "$stamp" | grep -Eq '^[0-9]{8}_[0-9]{6}$' || return 1
  echo "$stamp"
}

# Newest verified automatic backup, as epoch seconds; 0 when there is none.
last_automatic_success_epoch() {
  newest=0
  for dump in "${BACKUP_DIR}/${DB}"_*.dump; do
    [ -f "$dump" ] || continue
    [ -s "$dump" ] || continue
    stamp=$(automatic_stamp_of "$dump") || continue
    epoch=$(stamp_to_epoch "$stamp") || continue
    [ -n "$epoch" ] || continue
    if [ "$epoch" -gt "$newest" ]; then newest=$epoch; fi
  done

  # The marker file can only move the answer forward, never hide a real file.
  if [ -r "$STATE_FILE" ]; then
    marker=$(tr -dc '0-9' <"$STATE_FILE" 2>/dev/null || echo '')
    if [ -n "$marker" ] && [ "$marker" -gt "$newest" ]; then newest=$marker; fi
  fi

  echo "$newest"
}

record_success() {
  # Written after verification only, so the schedule cannot advance on a
  # failed or unverified dump.
  echo "$1" >"$STATE_FILE" 2>/dev/null ||
    log "WARNING: could not write ${STATE_FILE}; dump files remain authoritative"
}

# Bounded readiness wait. Returns 0 as soon as Postgres answers.
wait_for_postgres() {
  attempt=1
  while [ "$attempt" -le "$READY_MAX_ATTEMPTS" ]; do
    if pg_isready -q; then
      [ "$attempt" -gt 1 ] && log "postgres ready after ${attempt} attempts"
      return 0
    fi
    log "postgres not ready; retry ${attempt}/${READY_MAX_ATTEMPTS} in ${READY_RETRY_SECONDS}s"
    attempt=$((attempt + 1))
    [ "$attempt" -le "$READY_MAX_ATTEMPTS" ] && sleep "$READY_RETRY_SECONDS"
  done
  log "FAILURE: postgres still not ready after ${READY_MAX_ATTEMPTS} attempts; keeping existing backups untouched"
  return 1
}

run_backup() {
  stamp=$(date -u '+%Y%m%d_%H%M%S')
  target="${BACKUP_DIR}/${DB}_${stamp}.dump"
  tmp="${target}.partial"

  if ! pg_isready -q; then
    log "FAILURE: postgres is not ready; keeping existing backups untouched"
    return 1
  fi

  if ! pg_dump -Fc -f "$tmp" "$DB"; then
    log "FAILURE: pg_dump failed; removing partial file, keeping previous backups"
    rm -f "$tmp"
    return 1
  fi

  if [ ! -s "$tmp" ]; then
    log "FAILURE: dump is zero bytes; discarding"
    rm -f "$tmp"
    return 1
  fi

  # A dump is not trusted until its archive table of contents is readable.
  if ! pg_restore -l "$tmp" >/dev/null 2>&1; then
    log "FAILURE: pg_restore -l could not read the archive; discarding"
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$target"
  size=$(wc -c <"$target" | tr -d ' ')
  sha=$(sha256sum "$target" | cut -d' ' -f1)

  # Cluster-global roles are not inside a single-database pg_dump.
  globals="${BACKUP_DIR}/globals_${stamp}.sql"
  if ! pg_dumpall --globals-only -f "$globals" 2>/dev/null; then
    log "WARNING: globals dump failed (application restore does not require it)"
    rm -f "$globals"
    globals=""
  fi

  cat >"${BACKUP_DIR}/${DB}_${stamp}.meta.json" <<EOF
{
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "database": "${DB}",
  "postgresVersion": "$(psql -tAc 'SHOW server_version' 2>/dev/null | tr -d ' ')",
  "format": "custom (pg_dump -Fc)",
  "dumpFile": "$(basename "$target")",
  "globalsFile": "$([ -n "$globals" ] && basename "$globals" || echo null)",
  "bytes": ${size},
  "sha256": "${sha}",
  "archiveVerified": true,
  "source": "automatic"
}
EOF

  # Verified: the schedule may now advance from this backup's own stamp.
  success_epoch=$(stamp_to_epoch "$stamp")
  [ -n "$success_epoch" ] && record_success "$success_epoch"

  log "OK: $(basename "$target") (${size} bytes, sha256 ${sha})"
  return 0
}

prune() {
  # Only this script's own automatic pattern, only older than retention, never
  # the newest file, never anything marked PROTECTED. Labelled dumps such as
  # PRE_*/POST_*/handoff/baseline do not match the automatic pattern at all,
  # so they are structurally exempt rather than exempt by keyword.
  newest=""
  newest_epoch=0
  for dump in "${BACKUP_DIR}/${DB}"_*.dump; do
    [ -f "$dump" ] || continue
    stamp=$(automatic_stamp_of "$dump") || continue
    epoch=$(stamp_to_epoch "$stamp") || continue
    if [ -n "$epoch" ] && [ "$epoch" -gt "$newest_epoch" ]; then
      newest_epoch=$epoch
      newest=$dump
    fi
  done

  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB}_*.dump" -mtime "+${RETENTION_DAYS}" 2>/dev/null |
    while read -r old; do
      case "$old" in
        *PROTECTED*) continue ;;
      esac
      # Structural guard: a labelled dump never matches the automatic pattern.
      automatic_stamp_of "$old" >/dev/null || continue
      [ "$old" = "$newest" ] && continue
      base=$(basename "$old" .dump)
      log "retention: removing $(basename "$old") (older than ${RETENTION_DAYS}d)"
      rm -f "$old" "${BACKUP_DIR}/${base}.meta.json"
    done
}

mkdir -p "$BACKUP_DIR"
log "starting; db=${DB} interval=${INTERVAL}s retention=${RETENTION_DAYS}d readyRetry=${READY_RETRY_SECONDS}s x${READY_MAX_ATTEMPTS} failureRetry=${FAILURE_RETRY_SECONDS}s"

while true; do
  last_success=$(last_automatic_success_epoch)
  now=$(now_epoch)

  if [ "$last_success" -eq 0 ]; then
    log "no previous automatic backup found; backing up as soon as postgres is ready"
  elif [ "$last_success" -gt $((now + CLOCK_SKEW_TOLERANCE)) ]; then
    # Never sleep an absurd duration because the clock moved backwards.
    log "WARNING: newest automatic backup is dated $((last_success - now))s in the future (clock moved backwards?); treating backup as due now"
  else
    age=$((now - last_success))
    if [ "$age" -lt "$INTERVAL" ]; then
      remaining=$((INTERVAL - age))
      log "last automatic backup was ${age}s ago; next due in ${remaining}s"
      sleep "$remaining"
      continue
    fi
    log "last automatic backup was ${age}s ago (interval ${INTERVAL}s); backup is overdue"
  fi

  if wait_for_postgres && run_backup; then
    prune
  else
    log "backup cycle failed; no retention deletion performed; retrying in ${FAILURE_RETRY_SECONDS}s"
    sleep "$FAILURE_RETRY_SECONDS"
  fi
done
