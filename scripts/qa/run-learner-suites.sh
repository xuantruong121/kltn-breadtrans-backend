#!/usr/bin/env bash
# Learner QA suites on the disposable harness, one after another, with the
# backend restarted in the mode each group needs. Writes a pass/fail table.
#
#   bash scripts/qa/run-learner-suites.sh <harness db> [out.md]
#
# Preconditions: harness containers up (finalization-harness.sh containers),
# <db> a harness clone (finalization-harness.sh clone <db>), and the harness
# frontend on :3100 (finalization-harness.sh qa-frontend <fe worktree>).
# The backend on :3101 is restarted by this script and left on the default
# mode at the end. Nothing here reaches kltn_db, the owner's ports, R2, PayOS,
# Azure or Gemini.
#
# Result per suite, from its exit code: 0 PASS, 3 NOT_RUN (the suite says why),
# anything else FAIL. Logs go to $WORK/suites/<name>.log.
set -uo pipefail
DB="${1:?usage: $0 <harness db> [out.md]}"
case "$DB" in kltn_db|kltn_shadow|postgres) echo "REFUSED: $DB" >&2; exit 1;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
WORK="${TEMP:-/tmp}/breadtrans-harness"
LOGS="$WORK/suites"
OUT="${2:-$LOGS/summary.md}"
WAV10="$WORK/qa-10s.wav"
WAV34="$WORK/qa-34s.wav"
HARNESS="bash scripts/qa/finalization-harness.sh"
mkdir -p "$LOGS"
for f in "$WAV10" "$WAV34"; do [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }; done
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3100/login)" = "200" ] \
  || { echo "harness frontend :3100 is not up" >&2; exit 1; }
export HARNESS_DB="$DB"

rows=()
run() {
  local name="$1"; shift
  local started=$SECONDS code result
  "$@" > "$LOGS/$name.log" 2>&1
  code=$?
  case "$code" in 0) result=PASS;; 3) result=NOT_RUN;; *) result=FAIL;; esac
  local passes fails
  passes=$(grep -cE '^PASS' "$LOGS/$name.log" || true)
  fails=$(grep -cE '^FAIL' "$LOGS/$name.log" || true)
  rows+=("| $name | $result | $passes | $fails | $((SECONDS - started)) s |")
  echo "$result  $name  (pass $passes, fail $fails)"
}
backend() {
  # shellcheck disable=SC2086
  env "$@" $HARNESS qa-backend "$DB" > "$LOGS/backend-$(date +%s).log" 2>&1 \
    || { echo "backend did not start: $*" >&2; exit 1; }
}
ts() { npx ts-node --transpile-only "$@"; }

echo "== default mode (mock graders)"
bash scripts/qa/harness-toeic-standin-audio.sh > "$LOGS/standin-audio.log" 2>&1
backend NONE=1
run practice-entitlements ts scripts/qa/finalization-practice-entitlements.ts "$WAV10"
run four-skill-journeys ts scripts/qa/finalization-four-skill-journeys.ts "$WAV10"
run practice-api ts scripts/qa/finalization-practice-api.ts
run dashboard-browser ts scripts/qa/cp57-dashboard-browser.ts
run diagnostic-v2-browser ts scripts/qa/finalization-diagnostic-v2-browser.ts
run cp60-acc-mock env STATE="$LOGS/cp60-state.json" QA_WAV="$WAV10" npx ts-node --transpile-only scripts/qa/cp60-acc-gaps-api.ts mock
run cp60-acc-nav env STATE="$LOGS/cp60-state.json" SHOTS="$LOGS" npx ts-node --transpile-only scripts/qa/cp60-acc-nav-browser.ts nav
run toeic-content-access ts scripts/qa/toeic-exam-content-access-api.ts
run toeic-paper-browser ts scripts/qa/finalization-toeic-paper-browser.ts
run toeic-result-browser ts scripts/qa/finalization-toeic-result-browser.ts "$WAV10"
run toeic-room-browser ts scripts/qa/assessment-room-browser.ts "$WAV10"
run toeic-exam-time ts scripts/qa/toeic-exam-time.ts
run toeic-exam-time-browser ts scripts/qa/toeic-exam-time-browser.ts
run reward-policy ts scripts/qa/finalization-reward-policy-api.ts "$WAV10" "$WAV34"
run learner-cta-truth ts scripts/qa/learner-cta-truth.ts "$WAV10"
run learner-dashboard-clicks ts scripts/qa/learner-dashboard-clicks.ts
# Hundreds of learners exist by now; a fresh process resets the in-memory
# request throttle, which would otherwise answer 429.
backend NONE=1
run daily-practice-reachability ts scripts/qa/daily-practice-reachability.ts
run learner-crawl ts scripts/qa/finalization-learner-crawl.ts "$LOGS/learner-crawl.json"

echo "== diagnostic grader unavailable"
backend QA_GRADER_MODE=off
run cp60-acc-failed env STATE="$LOGS/cp60-state.json" QA_WAV="$WAV10" npx ts-node --transpile-only scripts/qa/cp60-acc-gaps-api.ts failed
run cp60-acc-nav-failed env STATE="$LOGS/cp60-state.json" SHOTS="$LOGS" npx ts-node --transpile-only scripts/qa/cp60-acc-nav-browser.ts failed
backend NONE=1
run cp60-acc-recover env STATE="$LOGS/cp60-state.json" QA_WAV="$WAV10" npx ts-node --transpile-only scripts/qa/cp60-acc-gaps-api.ts recover

echo "== PayOS stand-in"
backend QA_PAYOS=fake
run plans-api ts scripts/qa/finalization-plans-api.ts
run subscription-payos ts scripts/qa/finalization-subscription-payos.ts
run plan-renewal-browser ts scripts/qa/plan-renewal-browser.ts
run plan-expiry-reminder ts scripts/qa/plan-expiry-reminder-api.ts

echo "== writing grader refusing"
backend WRITING_QA_PROVIDER_MODE=failure
run writing-browser ts scripts/qa/finalization-writing-browser.ts

echo "== Azure answered from a scenario file (diag_clone, copied from $DB)"
# speaking-live-azure-server.ts accepts harness_clone or diag_clone only.
pid=$(netstat -ano | awk '$2 ~ ":3101$" && $4=="LISTENING"{print $5}' | head -1)
[ -n "${pid:-}" ] && taskkill //PID "$pid" //T //F > /dev/null 2>&1
sleep 2
docker exec harness-pg psql -U harness -d postgres -qc \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB','diag_clone') and pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS diag_clone;" -c "CREATE DATABASE diag_clone TEMPLATE $DB;" > /dev/null
mkdir -p "$LOGS/audio" && cp "$WAV10" "$LOGS/audio/a-full.wav"
echo '{}' > "$LOGS/fake-azure.json"
LIVE_GEMINI_FAKE_JSON='{"clarity":"Good","feedback":"Đoạn nhận xét cố định QA: bạn đọc rõ ràng và tự nhiên.","suggestions":["Gợi ý cố định QA: giữ nhịp đọc đều."]}' \
  QA_FAKE_AZURE="$LOGS/fake-azure.json" $HARNESS qa-backend diag_clone > "$LOGS/backend-azure.log" 2>&1 \
  || { echo "fake Azure backend did not start" >&2; exit 1; }
run cp60-feedback-ui env HARNESS_DB=diag_clone AUDIO_DIR="$LOGS/audio" FAKE_FILE="$LOGS/fake-azure.json" SHOTS="$LOGS" npx ts-node --transpile-only scripts/qa/cp60-feedback-ui-browser.ts
run cp60-speaking-metric-safety env HARNESS_DB=diag_clone AUDIO_DIR="$LOGS/audio" FAKE_FILE="$LOGS/fake-azure.json" SHOTS="$LOGS" npx ts-node --transpile-only scripts/qa/cp60-speaking-metric-safety-browser.ts

backend NONE=1
{
  echo "# Learner suites on harness database $DB"
  echo
  echo "Run $(date '+%Y-%m-%d %H:%M'). PASS = exit 0; NOT_RUN = the suite reported why; FAIL = anything else."
  echo "TOEIC audio on the harness is a stand-in tone (harness-toeic-standin-audio.sh), not the exam audio."
  echo
  echo "| Suite | Result | PASS lines | FAIL lines | Time |"
  echo "|---|---|---|---|---|"
  printf '%s\n' "${rows[@]}"
} > "$OUT"
echo "summary: $OUT"
grep -q '| FAIL |' "$OUT" && exit 1 || exit 0
