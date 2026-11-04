#!/usr/bin/env bash
# Harness fixture only: stand-in audio for TOEIC exams 1 and 3 in the fake
# private bucket (:9460). A quiet tone, NOT the exam audio, so a suite can
# prove playback, seeking and access rules, never what a learner hears.
# The exam 1 master stand-in has the registry's duration
# (src/modules/toeic/listening-master/exam-1.ts), so timeline and seek checks
# see the real length. The real objects live only in the owner's R2.
#
#   HARNESS_DB=<db> bash scripts/qa/harness-toeic-standin-audio.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
DB="${HARNESS_DB:-qa_suites}"
case "$DB" in kltn_db|kltn_shadow) echo "REFUSED: $DB" >&2; exit 1;; esac
WORK="${TEMP:-/tmp}/breadtrans-harness"
BUCKET="$WORK/fake-s3/harness-private"
OUT="$WORK/toeic-standins"
FF=$(node -p "require('ffmpeg-static')")
mkdir -p "$OUT"
[ -f "$OUT/clip.mp3" ] || "$FF" -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=4" \
  -af volume=0.05 -ac 1 -b:a 32k "$OUT/clip.mp3"
DURATION=$(grep -o 'durationSeconds: [0-9.]*' src/modules/toeic/listening-master/exam-1.ts | head -1 | awk '{print $2}')
FILE=$(grep -o "key: 'catalog/toeic/exam-1/listening-master/[^']*'" src/modules/toeic/listening-master/exam-1.ts | head -1 | sed "s/.*\///; s/'//")
[ -n "$DURATION" ] && [ -n "$FILE" ] || { echo "cannot read the exam 1 master registry" >&2; exit 1; }
[ -f "$OUT/master-$DURATION.mp3" ] || "$FF" -hide_banner -loglevel error -f lavfi \
  -i "sine=frequency=330:duration=$DURATION" -af volume=0.05 -ac 1 -b:a 32k "$OUT/master-$DURATION.mp3"
MASTER_KEY="premium/listening/toeic/exam-1/listening-master/$FILE"
mkdir -p "$BUCKET/$(dirname "$MASTER_KEY")"
cp "$OUT/master-$DURATION.mp3" "$BUCKET/$MASTER_KEY"
n=0
while IFS= read -r key; do
  key="${key%$'\r'}"
  [ -z "$key" ] && continue
  mkdir -p "$BUCKET/$(dirname "$key")"
  cp "$OUT/clip.mp3" "$BUCKET/$key"
  n=$((n + 1))
done < <(docker exec harness-pg psql -U harness -d "$DB" -Atc \
  "select distinct \"audioUrl\" from \"ToeicQuestionGroup\" where \"examId\" in (1, 3) and \"audioUrl\" like 'premium/%'")
echo "stand-in master ($DURATION s) + $n clips under $BUCKET"
