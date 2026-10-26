# Phase B2B — Controlled Local Database Migration & DRAFT Import

**Date:** 2026-10-26
**Outcome:** the reviewed migration is applied to `kltn_db` and the approved 29-item Entry
Diagnostic is persisted as an **inactive DRAFT** (`id=5`). Nothing was activated, deleted,
restored or reset.

> **Independence caveat.** Executed and verified by the author of the migration and importer.
> Self-verification, not independent review.

No password, token or connection string appears here. Databases are identified by name, port and
cluster `system_identifier`. Full machine-readable evidence: `entry-diagnostic-phase-b2b-evidence.json`
and the snapshots and logs in `artifacts/b2b-evidence/`.

---

## 1. Authorization

The user authorized: apply exactly the reviewed migration and import the 29-item Diagnostic as
`DRAFT`, `isActive=false`, **effective only after every pre-write gate passed**. Choices: checkpoint
to R2 private bucket plus local protected copy; read-only testing via
`default_transaction_read_only=on`, no new role; authenticated HTTP smoke skipped and recorded
`NOT_VERIFIED`.

Not authorized and not done: activation, audio, AI grading, role creation, any row deletion or
rollback, any restore into `kltn_db`.

---

## 2. Pre-write gates

| Gate | Result | Evidence |
|---|---|---|
| G1 identity + pending | PASS | `localhost:5432 / kltn_db`, `sysid 7674533776495505443`, PG 15.19. 68 migration dirs, 67 applied, exactly one pending, 0 failed rows |
| G2 constraint provenance | PASS | see below |
| G3 code = rehearsed revision | PASS | migration, importer, mapper, guards and content all equal HEAD `0adb882`; sha256 locked |
| G4 no concurrent writers | PASS on third evaluation | see below |
| G5 no container/volume change | PASS | the four protected containers were never stopped or recreated |

**G2.** The user asked how a "6-statement" migration relates to the CHECK and partial unique index
B1 observed. They are not in the B1 migration and predate it:

- `DiagnosticAssessment_single_active_key` (partial unique) — created by
  `20261022130000_enforce_single_active_diagnostic`, applied 2026-10-23.
- `DiagnosticAssessment_status_matches_isActive` (CHECK) — created by
  `20261025054012_diagnostic_v2_schema_foundation`, applied 2026-10-25.

The B1 migration mentions neither name and contains no `CHECK` and no `WHERE`. B1 saw both because
its rehearsal replayed all 67 earlier migrations first.

**G4 failed twice before passing, and the phase stopped each time.**

1. The backend dev server held 9 connections and runs periodic writers — speaking worker every 3 s,
   speaking reconciliation every 30 s, payment reconciliation and system jobs every 5 minutes and
   hourly. A 25-second sample showed 0 rows changing, but a writer that happens to be idle is not
   one that cannot write.
2. After the user stopped it, an orphaned app process (PID 13232, parent already exited) started at
   09:01:37, listened on port 3001 and resumed `UPDATE "SpeakingSubmission"`. What relaunched it is
   **unknown**; Ctrl+C could not reach it because it had no parent.
3. After the user stopped it again: 0 backend processes, port 3001 closed, 0 `kltn_db` sessions,
   held across a 60-second watch and re-confirmed immediately before both the migration and the
   import.

No other Claude session was running.

---

## 3. Protected checkpoint

```
kltn_db_PRE_DIAGNOSTIC_V2_IMPORT_PROTECTED_20261026_020536.dump
683135 bytes   sha256 1194fb5b8aa59b6e785df1a8d3f7af783ef5e941e1e977028142fc9a1cfb8cdb
pg_dump -Fc    pg_restore -l PASS    class PROTECTED_BASELINE
```

- sha256 recomputed independently; it matches the sidecar.
- **Prune exemption proven by running the real `automatic_stamp_of()`** from `backup.sh`: the
  checkpoint returns `NOT_AUTO` (exempt), while the control file `kltn_db_20261026_010617.dump`
  returns `MATCH_AUTO` (prunable). The name also contains `PROTECTED`, the second guard.
- **Offsite:** uploaded to the private backup bucket, downloaded back with matching sha256; the
  public media URL for the same key returns 404.

A side effect: the backup script rewrote `artifacts/offsite-backup-verification.json` to describe
this checkpoint.

---

## 4. Restore verification

**The first drill reported FAILED**, with `Count mismatch for DiagnosticAssessment : restored=
expected=1`. That was a limitation of `db-restore-drill.ps1`, not of the restore: the script counts
only nine hard-coded tables, so any other table reads as empty. Confirmed by reading its count logic.
The second run, asserting the tables it supports, **PASSED**, and its container was destroyed.

The decisive check was stronger than either drill. The checkpoint was restored into a separate
disposable PostgreSQL 15 container, and a whole-row, order-independent md5 of **every base table**
was compared with the live snapshot taken alongside the checkpoint:

```
tables compared              136
tables with different content  0
migration history            identical
```

Nothing was restored into `kltn_db`.

---

## 5. Rehearsal on the checkpoint copy

Before touching the real database, the entire sequence ran on that restored copy (`localhost:5437`,
`sysid 7700793221349826600`):

| Step | Result |
|---|---|
| `migrate deploy` | applied exactly `20261025120000_diagnostic_source_identity` |
| import | 45 rows, DRAFT `id=5` |
| verify | 28/28 |
| re-import | 4/4 — 66 rows, 0 rewritten by `xmin` |
| service | 10/10 |
| negative | 5/5 |

The negative suite is the one that must never run against `kltn_db`:

- `startAttempt` on the DRAFT → `NotFoundException` *"Bài kiểm tra không tồn tại hoặc đã ngừng hoạt
  động"*
- `submitAssessment` on the DRAFT → `NotFoundException`
- attempt rows 0 before, 0 after
- `UPDATE isActive=true` on the DRAFT → SQLSTATE `23514` from `status_matches_isActive`

`PENDING_MIGRATION_OMIT` was not touched during rehearsal; the runner uses a plain `PrismaClient`
with no omit, which models the post-removal application without editing source the running app
loads. The rehearsal container and its volume were then removed.

---

## 6. Live migration

`npm run db:migrate:deploy` — Prisma reported `"kltn_db" at "localhost:5432"` and applied only the
reviewed migration. Exit 0.

| Check | Result |
|---|---|
| `sourceKey` columns | 3, all `text`, nullable, no default |
| indexes | +3 (`…sourceKey_key`, `…assessmentId_sourceKey_key` ×2), 0 removed |
| constraints | 0 added, 0 removed; lifecycle CHECK still present |
| `_prisma_migrations` | 68 rows; new row finished, not rolled back; checksum `ba333dac…` = file sha256; earlier 67 unchanged |
| legacy data | assessment fingerprint `aa4052…` and 20-question fingerprint `3f78b8…` unchanged |
| heap rewrite | none — legacy `xmin` unchanged |

Three table fingerprints moved during the migration: `DiagnosticAssessment` and `DiagnosticQuestion`
because each row's text now includes the new NULL column, and `_prisma_migrations` by one row. The
unchanged legacy-column fingerprints and `xmin` show the data itself did not move.

---

## 7. Removing the omit

With the migration verified and the application stopped, `PENDING_MIGRATION_OMIT` was removed.
`src/prisma/prisma.service.ts` is now byte-identical to HEAD. Two files that tested the removed
omit were deleted — both created in B2A.1 and never committed, their results already recorded in
the B2A.1 note: `src/prisma/prisma.service.spec.ts` and `scripts/audit/b2a1-verify-omit-sql.ts`.

After removal: `tsc` exit 0; 10/10 suites, **181/181** tests (187 less the 6 removed). No
compatibility layer remains.

---

## 8. Live import

**First run** — default options, so the hash manifest was verified:

```
assessmentId 5   created: assessment 1, passage 3, rubric 2, question 29, clip 10   status DRAFT, isActive false
```

**Verify** — 28/28 on a read-only session. Content, not counts:

- the 29 `sourceKey`s are exactly the 29 authored draft keys; sections 10/10/2/2/5
- every stored column equals the mapper's output for its item, with ids resolved by identity
- independently of the mapper, all 25 objective rows have the prompt, options and answer key of the
  raw draft
- 3 passages equal the authored body and the approved manifest hash; `title` NULL
- 2 rubrics equal the approved criteria
- 10 clip registrations over exactly 4 authored scripts, each matching its manifest hash; `url`
  empty, `PENDING_PHASE_E`, inactive
- no authoring-only field name in any options blob, no authored `internalLabel` text anywhere, no
  CEFR level, no audio URL

**Second run:**

```
ADDITIONAL_ROWS=0    CHANGED_ROWS=0    importer: created {} updated {}
xmin: 66 rows compared, 0 rewritten   (45 imported + legacy assessment + 20 legacy questions)
```

Two importer invocations in total, never concurrent.

---

## 9. Real service behaviour on `kltn_db`

Real `DiagnosticService`, plain client with no omit, session `default_transaction_read_only=on`
asserted before any query. 10/10:

- `getCurrentAssessment` succeeds with the DRAFT present and serves the legacy `id=1`, not `id=5`;
  20 questions; `assertQuestionBank` does not fail
- served questions expose no `correctIndex`, `explanation`, `difficulty`, `intendedLevel` or
  `sourceKey`
- `getLatestResult` succeeds and returns `null` (0 attempts)
- the DRAFT's rows through the real `sanitizeQuestion`: served key set `audioUrl, construct, id,
  options, order, passageBody, passageText, passageTitle, question, questionType, section, skill`;
  none of the 25 stored rationales is served; 10/10 Reading items serve the complete authored
  passage; Listening `audioUrl` present and null, no transcript

The negative suite was attempted against `--live` to confirm the runner refuses it. It did:
`REFUSED: negative tests run on the rehearsal database only`.

Authenticated HTTP was not exercised, by the user's choice: **`NOT_VERIFIED`**.

---

## 10. Post-write invariants

| | |
|---|---|
| tables compared | 136 |
| tables changed | 6, all expected: the five Diagnostic tables and `_prisma_migrations` |
| tables unchanged | **130**, including `User` |
| `DiagnosticAttempt` | 0 rows, unchanged |
| legacy assessment / questions | fingerprints `aa4052…` / `3f78b8…` unchanged; `xmin` unchanged |
| active assessments | `1:ACTIVE` only |
| V2 | `id=5`, `DRAFT`, `isActive=false`, 29 questions |
| sequences | each advanced by exactly the rows created; the re-import consumed none |
| `kltn_shadow` | 0 tables changed, same `system_identifier`, 0 migration rows before and after |

No rollback was needed and none was performed.

---

## 11. Corrections and self-check defects

- B2A and B2A.1 called the submit path `submitAttempt`. The real method is
  `DiagnosticService.submitAssessment`; the cited line was right.
- B2A assumed the restore drill could assert any table's count. It asserts only nine.
- A `pg_stat_user_tables` comparison joined on table name alone and produced symmetric `+x/-x`
  noise, because schema `phase3c_test` duplicates 18 table names. Re-measured by `schema.table`.
- A PowerShell regex in a quiescence check failed to parse and printed `backend_procs=0`. That value
  was discarded and the check re-run with a literal match.

Observation: `kltn_db` holds a second schema, `phase3c_test` (18 tables, no Diagnostic tables).
The migration's unqualified statements resolve through `search_path` `"$user", public` and could not
reach it; its fingerprints are unchanged.

---

## 12. Application state

**The backend dev server is stopped.** It is safe to restart with `npm run start:dev`: the generated
client and the database now both have `sourceKey`, and the omit is gone, so the P2022 drift cannot
recur.

---

## 13. Flags

```
B2B_EXPLICIT_USER_AUTHORIZATION=true
PROTECTED_CHECKPOINT_CREATED=true
PROTECTED_CHECKPOINT_RESTORE_VERIFIED=true

REAL_DB_IDENTITY_VERIFIED=true
MIGRATION_APPLIED=true
MIGRATION_HISTORY_CONSISTENT=true

IMPORTER_FIRST_RUN_PASS=true
IMPORTER_SECOND_RUN_ADDITIONAL_ROWS=0
IMPORTER_SECOND_RUN_CHANGED_ROWS=0

LEGACY_DATA_PRESERVED=true
DRAFT_CURRENT_SELECTION_SERVICE_TEST_PASS=true
DRAFT_ATTEMPT_DENIAL_SERVICE_TEST_PASS=true
LEARNER_PAYLOAD_CONFIDENTIALITY_PASS=true

PENDING_MIGRATION_OMIT_REMOVED_SAFELY=true
DIAGNOSTIC_HTTP_AUTH_SMOKE=NOT_VERIFIED
DIAGNOSTIC_SERVICE_SMOKE=PASS

REAL_DB_RESET=false
LEGACY_DATA_DELETED=false
SHADOW_DB_MUTATED=false
V2_ACTIVATED=false
TTS_CALL_COUNT=0
AI_GRADING_CALL_COUNT=0
FULL_SUITE_PASS=NOT_RUN

PHASE_B2B_VERDICT=CONTROLLED_DRAFT_PERSISTENCE_PASS
```

`DRAFT_ATTEMPT_DENIAL_SERVICE_TEST_PASS=true` comes from the rehearsal copy of the checkpoint, as
required — never from `kltn_db`.

---

## 14. What remains before activation

The assessment is persisted, not functional. Outstanding: real Listening audio and voice casting;
audio playback; productive Speaking and Writing runtime end to end; the objective permutation
grading fix; the `FOUR_SKILL_PLACEMENT_V2` scorer; the DEF-004 result-band decision; AI grading
reliability; final result calculation; readiness and activation checks; and an authenticated HTTP
smoke.

B2B stops here.
