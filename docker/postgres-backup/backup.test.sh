#!/bin/sh
# Tests for the backup scheduler's decision logic.
#
# Runs against a throwaway fixture directory inside the container, so no real
# dump is read, written, renamed or deleted. Only the pure functions are
# exercised: pg_dump is never invoked and the database is never touched.
#
# Usage (from the repo root):
#   docker run --rm \
#     -v "$PWD/docker/postgres-backup:/t:ro" \
#     postgres:15-alpine sh /t/backup.test.sh
set -u

PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  echo "  ok   - $1"
}
no() {
  FAIL=$((FAIL + 1))
  echo "  FAIL - $1"
  echo "         expected: $2"
  echo "         actual  : $3"
}
is() {
  if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "$3" "$2"; fi
}

# Load the scheduler's functions without running its main loop. The script ends
# in `while true`, so everything above that line is sourced instead.
SRC=/t/backup.sh
FIXTURE=$(mktemp -d)
sed '/^while true; do$/,$d' "$SRC" >"${FIXTURE}/lib.sh"

export PGDATABASE=kltn_db
BACKUP_DIR="${FIXTURE}/backups"
mkdir -p "$BACKUP_DIR"
# shellcheck disable=SC1090
. "${FIXTURE}/lib.sh"
# Sourcing re-pins BACKUP_DIR to /backups, so point it back at the fixture.
BACKUP_DIR="${FIXTURE}/backups"
STATE_FILE="${BACKUP_DIR}/.last-automatic-success"

mk() { printf 'x' >"${BACKUP_DIR}/$1"; }
reset_fixture() {
  rm -rf "$BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
}

echo "automatic filename classification"
is "automatic dump is recognised" \
  "$(automatic_stamp_of "${BACKUP_DIR}/kltn_db_20261025_011937.dump" || echo NONE)" \
  "20261025_011937"
for labelled in \
  kltn_db_CANONICAL_BASELINE_PROTECTED_20261023_080526.dump \
  kltn_db_PRE_WHOLE_QUIZ_ARTIFACT_RECOVERY_20261024_024548.dump \
  kltn_db_PRE_SEMANTIC_MEDIA_RECOVERY_20261023_193612.dump \
  kltn_db_PRE_FOUNDATION_CONTENT_RECOVERY_20261023_124538.dump \
  kltn_db_AUTO_R2_VERIFY_20261023_154754.dump \
  kltn_db_CLAUDE_HANDOFF_PROTECTED_20261023_080201.dump; do
  is "labelled dump is NOT automatic: ${labelled}" \
    "$(automatic_stamp_of "${BACKUP_DIR}/${labelled}" || echo NONE)" "NONE"
done

echo
echo "last automatic success discovery"
reset_fixture
is "no backups at all yields 0" "$(last_automatic_success_epoch)" "0"

reset_fixture
mk kltn_db_CANONICAL_BASELINE_PROTECTED_20261023_080526.dump
mk kltn_db_PRE_WHOLE_QUIZ_ARTIFACT_RECOVERY_20261024_024548.dump
mk kltn_db_AUTO_R2_VERIFY_20261023_154754.dump
is "protected and labelled dumps alone still yield 0" \
  "$(last_automatic_success_epoch)" "0"

reset_fixture
mk kltn_db_20261023_073044.dump
mk kltn_db_20261025_011937.dump
mk kltn_db_PRE_WHOLE_QUIZ_ARTIFACT_RECOVERY_20261024_024548.dump
expected=$(stamp_to_epoch 20261025_011937)
is "newest automatic dump wins, labelled newer dump ignored" \
  "$(last_automatic_success_epoch)" "$expected"

reset_fixture
mk kltn_db_20261023_073044.dump
older=$(stamp_to_epoch 20261023_073044)
newer=$((older + 9999))
echo "$newer" >"$STATE_FILE"
is "marker file can move the answer forward" \
  "$(last_automatic_success_epoch)" "$newer"
echo "1" >"$STATE_FILE"
is "marker file can never hide a real dump" \
  "$(last_automatic_success_epoch)" "$older"
rm -f "$STATE_FILE"

reset_fixture
mk kltn_db_20261025_011937.dump
: >"${BACKUP_DIR}/kltn_db_20261026_000000.dump"
is "a zero-byte dump never counts as a success" \
  "$(last_automatic_success_epoch)" "$(stamp_to_epoch 20261025_011937)"

echo
echo "daily slot (00:00 Vietnam time = 17:00 UTC the day before)"
e() { stamp_to_epoch "$1"; }
is "afternoon: the slot is this local day's midnight"   "$(current_slot_epoch "$(e 20261116_100000)")" "$(e 20261115_170000)"
is "exactly at midnight: the slot is now"   "$(current_slot_epoch "$(e 20261115_170000)")" "$(e 20261115_170000)"
is "one second before midnight: the slot is the previous midnight"   "$(current_slot_epoch "$(e 20261115_165959)")" "$(e 20261114_170000)"
BACKUP_AT=08:05
is "BACKUP_AT=08:05 at 07:00 local: yesterday's 08:05"   "$(current_slot_epoch "$(e 20261116_000000)")" "$(e 20261115_010500)"
BACKUP_AT=00:00

echo
echo "due / wait decision (the reboot regression, daily)"
# Mirrors the main loop's arithmetic exactly.
decide() {
  last=$1
  now=$2
  slot=$(current_slot_epoch "$now")
  if [ "$last" -eq 0 ]; then
    echo "DUE_NO_HISTORY"
  elif [ "$last" -gt $((now + CLOCK_SKEW_TOLERANCE)) ]; then
    echo "DUE_CLOCK_SKEW"
  elif [ "$last" -ge "$slot" ]; then
    echo "WAIT_$((slot + 86400 - now))"
  else
    echo "DUE_SINCE_SLOT"
  fi
}
NOW=$(e 20261116_100000) # 17:00 Vietnam time
is "no history is immediately due" "$(decide 0 "$NOW")" "DUE_NO_HISTORY"
is "backup made today (11:14 VN) waits for the next midnight"   "$(decide "$(e 20261116_041405)" "$NOW")" "WAIT_25200"
is "last backup yesterday evening (17:14 VN) is due now"   "$(decide "$(e 20261115_101409)" "$NOW")" "DUE_SINCE_SLOT"
is "machine switched on at 08:00 VN after a night off is due at once"   "$(decide "$(e 20261115_101409)" "$(e 20261116_010000)")" "DUE_SINCE_SLOT"
is "a backup made at midnight waits a full day"   "$(decide "$(e 20261115_170000)" "$(e 20261115_170500)")" "WAIT_86100"
is "a backup dated far in the future is due, never an absurd sleep"   "$(decide $((NOW + 86400)) "$NOW")" "DUE_CLOCK_SKEW"
is "a backup dated slightly ahead stays within skew tolerance"   "$(decide $((NOW + 60)) "$NOW")" "WAIT_25200"

echo
echo "prune safety"
reset_fixture
mk kltn_db_20261025_011937.dump
mk kltn_db_CANONICAL_BASELINE_PROTECTED_20261023_080526.dump
mk kltn_db_PRE_WHOLE_QUIZ_ARTIFACT_RECOVERY_20261024_024548.dump
mk kltn_db_AUTO_R2_VERIFY_20261023_154754.dump
# Age every file well past retention so only the guards can save them.
find "$BACKUP_DIR" -type f -exec touch -d '2020-01-01' {} +
RETENTION_DAYS=14
before=$(ls -1 "$BACKUP_DIR" | wc -l)
prune >/dev/null 2>&1
after=$(ls -1 "$BACKUP_DIR" | wc -l)
is "the only automatic dump is kept because it is the newest" \
  "$([ -f "${BACKUP_DIR}/kltn_db_20261025_011937.dump" ] && echo kept || echo gone)" "kept"
is "PROTECTED baseline survives retention" \
  "$([ -f "${BACKUP_DIR}/kltn_db_CANONICAL_BASELINE_PROTECTED_20261023_080526.dump" ] && echo kept || echo gone)" "kept"
is "PRE_* recovery dump without the PROTECTED token survives retention" \
  "$([ -f "${BACKUP_DIR}/kltn_db_PRE_WHOLE_QUIZ_ARTIFACT_RECOVERY_20261024_024548.dump" ] && echo kept || echo gone)" "kept"
is "AUTO_R2_VERIFY manual snapshot survives retention" \
  "$([ -f "${BACKUP_DIR}/kltn_db_AUTO_R2_VERIFY_20261023_154754.dump" ] && echo kept || echo gone)" "kept"
is "nothing at all was deleted" "$after" "$before"

reset_fixture
mk kltn_db_20261001_000000.dump
mk kltn_db_20261002_000000.dump
mk kltn_db_20261025_011937.dump
find "$BACKUP_DIR" -type f -exec touch -d '2020-01-01' {} +
prune >/dev/null 2>&1
is "an old automatic dump IS pruned when a newer automatic one exists" \
  "$([ -f "${BACKUP_DIR}/kltn_db_20261001_000000.dump" ] && echo kept || echo gone)" "gone"
is "the newest automatic dump is never pruned" \
  "$([ -f "${BACKUP_DIR}/kltn_db_20261025_011937.dump" ] && echo kept || echo gone)" "kept"

rm -rf "$FIXTURE"
echo
echo "passed=${PASS} failed=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
