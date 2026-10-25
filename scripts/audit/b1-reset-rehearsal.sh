#!/usr/bin/env bash
# Reset the DISPOSABLE Phase B1 rehearsal database to its pre-import state:
# an empty schema at full migration head, plus a V1-shaped fixture.
#
# This drops and recreates a database. It is deliberately hard-coded to the
# disposable container and refuses anything else, and it verifies the server's
# system_identifier before dropping, because a port is not proof of identity.
set -euo pipefail

CONTAINER=kltn-b1-rehearsal-47285
DB=b1_rehearsal
USER_NAME=b1user
PORT=5434
# Captured read-only from the protected clusters.
PROTECTED_IDS="7674533776495505443 7699757546958700579"

sid=$(docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres -At \
        -c "SELECT system_identifier FROM pg_control_system()")
for p in $PROTECTED_IDS; do
  if [ "$sid" = "$p" ]; then
    echo "REFUSED: $CONTAINER reports a protected system_identifier ($sid)" >&2
    exit 1
  fi
done
label=$(docker inspect -f '{{ index .Config.Labels "breadtrans.disposable" }}' "$CONTAINER")
if [ "$label" != "true" ]; then
  echo "REFUSED: $CONTAINER is not labelled disposable" >&2
  exit 1
fi
echo "resetting $DB on $CONTAINER (system_identifier=$sid, disposable=$label)"

docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" \
  -c "CREATE DATABASE $DB OWNER $USER_NAME;"

DATABASE_URL="postgresql://$USER_NAME:b1rehearsal@localhost:$PORT/$DB" \
  npx prisma migrate deploy >/dev/null

# V1-shaped fixture. Authored here, never copied from the real database.
docker exec -i "$CONTAINER" psql -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "DiagnosticAssessment"
  (id, title, description, "isActive", "updatedAt", "contentVersion", "scoringVersion", status)
VALUES
  (1, 'Legacy entry test (B1 fixture)', 'V1-shaped fixture row', true,
   CURRENT_TIMESTAMP, 1, 'OBJECTIVE_POOLED_V1', 'ACTIVE');

INSERT INTO "DiagnosticQuestion"
  ("assessmentId", skill, question, options, "correctIndex", "order")
SELECT 1,
       'Reading',
       'Legacy fixture question ' || n,
       jsonb_build_array('A' || n, 'B' || n, 'C' || n, 'D' || n),
       n % 4,
       n
FROM generate_series(1, 20) AS n;

SELECT setval('"DiagnosticAssessment_id_seq"',
              (SELECT max(id) FROM "DiagnosticAssessment"));
SQL

docker exec "$CONTAINER" psql -U "$USER_NAME" -d "$DB" -At -c \
  "SELECT (SELECT count(*) FROM \"DiagnosticAssessment\") || '|' ||
          (SELECT count(*) FROM \"DiagnosticQuestion\") || '|' ||
          (SELECT count(*) FROM \"DiagnosticQuestion\" WHERE \"sourceKey\" IS NULL) || '|' ||
          (SELECT count(*) FROM information_schema.columns
             WHERE column_name = 'sourceKey'
               AND table_name IN ('DiagnosticAssessment','DiagnosticQuestion',
                                  'DiagnosticReadingPassage'))"
