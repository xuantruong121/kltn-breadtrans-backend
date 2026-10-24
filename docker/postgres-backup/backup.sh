#!/bin/sh
# Scheduled logical backup of the BreadTrans development database.
#
# Runs inside a postgres:15-alpine container so pg_dump/pg_restore major
# versions always match the server. Writes custom-format archives to the
# host-mounted /backups directory (outside the Postgres data volume).
#
# Safety rules implemented here:
#   * a dump is only accepted after `pg_restore -l` can list it;
#   * a failed or empty dump never overwrites or deletes a previous good one;
#   * retention deletion runs only after a new backup verified successfully;
#   * retention only ever matches this script's own filename pattern;
#   * the newest verified backup is never deleted;
#   * files containing PROTECTED in the name are exempt from retention.
set -u

BACKUP_DIR=/backups
INTERVAL="${BACKUP_INTERVAL_SECONDS:-21600}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DB="${PGDATABASE:-kltn_db}"

log() {
  echo "[pg-backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
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

  log "OK: $(basename "$target") (${size} bytes, sha256 ${sha})"
  return 0
}

prune() {
  # Only this script's own pattern, only older than retention, never the
  # newest file, never anything marked PROTECTED.
  newest=$(ls -1t "${BACKUP_DIR}/${DB}"_*.dump 2>/dev/null | head -n 1)
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB}_*.dump" -mtime "+${RETENTION_DAYS}" 2>/dev/null |
    while read -r old; do
      case "$old" in
        *PROTECTED*) continue ;;
      esac
      [ "$old" = "$newest" ] && continue
      base=$(basename "$old" .dump)
      log "retention: removing $(basename "$old") (older than ${RETENTION_DAYS}d)"
      rm -f "$old" "${BACKUP_DIR}/${base}.meta.json"
    done
}

mkdir -p "$BACKUP_DIR"
log "starting; db=${DB} interval=${INTERVAL}s retention=${RETENTION_DAYS}d"

while true; do
  if run_backup; then
    prune
  else
    log "backup cycle failed; no retention deletion performed"
  fi
  sleep "$INTERVAL"
done
