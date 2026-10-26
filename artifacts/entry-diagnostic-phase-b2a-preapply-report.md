# Phase B2A — Protected Database Pre-Apply Gate

**Date:** 2026-10-26
**Mode:** READ-ONLY. No migration applied, no row imported, no database mutated.
**Scope:** Final safety inspection before asking for authorization to change `kltn_db`.

> **Independence caveat.** B2A was executed by the author of the B1 migration, mapper and
> importer. It re-checks B1's claims against the real repository and the real database, but it is
> not an independent review. Section 8 of the B1 report records three checks this same author
> wrote incorrectly during B1, and §6 below records a fourth gap found in B1's own test design.

No password or connection string appears in this report. Databases are identified by name, port
and cluster `system_identifier`.

---

## 1. Repository state — the code under review is the committed code

`HEAD = 0adb882` *"feat: add diagnostic V2 content importer, mapper, and database migration
support"*. That commit contains the B1 migration, importer, mapper, guard tests, audit harnesses
and all B0/B1 artifacts.

`git status` reports exactly one modified tracked file: `docker-compose.yml`, changed in a
separate maintenance task that set container restart policies to `always`. It touches no
migration, importer, content or schema file.

So the SQL and TypeScript reviewed below are committed revisions, not uncommitted working
copies. Confirmation that they are the revisions that passed B1: **9/9 diagnostic suites and
178/178 tests pass at HEAD** — the same totals the B1 report recorded — and `tsc --noEmit`
exits 0.

---

## 2. The real database — identity and baseline

Read-only inspection of `kltn_db`:

```
current_database   = kltn_db
current_user       = postgres
server_version     = 15.19
system_identifier  = 7674533776495505443
connection         = local socket inside container kltn-postgres (host port 5432)
is_in_recovery     = false
migrations_finished= 67      migrations_failed = 0
latest_migration   = 20261025054012_diagnostic_v2_schema_foundation
public_tables      = 118
```

`system_identifier` is the cluster's own identity and changes only on `initdb`. It matches the
value recorded in Phase B1 exactly, so this is the same cluster — not a rebuilt one.

Baseline, compared against B1:

| | B1 reported | B2A measured | |
|---|---|---|---|
| DiagnosticAssessment | 1 | 1 | match |
| DiagnosticQuestion | 20 | 20 | match |
| DiagnosticAttempt | 0 | 0 | match |
| DiagnosticReadingPassage | — | 0 | V2 rows absent |
| DiagnosticListeningClip | — | 0 | V2 rows absent |
| DiagnosticRubric | — | 0 | V2 rows absent |
| `sourceKey` columns | 0 | 0 | B1 migration not applied |

The one assessment row: `id=1, isActive=true, status=ACTIVE, contentVersion=1,
scoringVersion=OBJECTIVE_POOLED_V1, blueprintVersion=V1_LEGACY_20_ITEM,
title="Kiểm tra trình độ đầu vào"`.

Legacy question shape, which matters because the migration must survive it: all 20 rows store
`options` as a **JSON array** (0 object rows), all are `taskType=MCQ`, all have
`intendedLevel` NULL, all 20 carry an `explanation`. Orphans: 0 questions without an assessment,
0 attempts without an assessment, 0 `LearningActivity` DIAGNOSTIC rows without an attempt.

**No difference from the B1 baseline was found.**

---

## 3. B1-INC-001 — new read-only evidence

The historical plan file claims an assessment `id=2` titled *"Entry Diagnostic v2"* once existed.
B1 could not corroborate it. B2A found independent evidence in the sequence:

```
DiagnosticAssessment_id_seq.last_value = 4   is_called = true
max(DiagnosticAssessment.id)           = 1
DiagnosticQuestion_id_seq.last_value   = 60
distinct DiagnosticQuestion.assessmentId = [1]
```

The sequence has issued identifiers up to 4 while only `id=1` survives. Rows 2, 3 and 4 were
therefore created and later removed. That corroborates the plan file's claim **without relying on
the file itself**.

This is row deletion, not a database reset: `system_identifier` is unchanged, all 67 migrations
remain applied, 118 tables and 7 users are present.

**Risk to the controlled import: none identified.** The importer matches on `sourceKey`, not on
`id`. No surviving row carries a `sourceKey` — the column does not exist yet — so the first
import cannot collide with a historical identity. A new assessment takes `id=5` from the
sequence; no gap is reused and no identifier is reassigned.

Nothing was recreated, restored, renumbered or edited to reconcile the plan file. The verified
database state is authoritative; the plan file is stale documentation.

```
B1_INC_001_CLASSIFICATION=STALE_DOCUMENT_CORROBORATED_BY_SEQUENCE_GAP_NO_SURVIVING_ROWS
B1_INC_001_BLOCKS_CONTROLLED_IMPORT=false
```

---

## 4. Migration SQL review

`prisma/migrations/20261025120000_diagnostic_source_identity/migration.sql` — 6 statements:

```sql
ALTER TABLE "DiagnosticAssessment"     ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "DiagnosticQuestion"       ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "DiagnosticReadingPassage" ADD COLUMN "sourceKey" TEXT;
CREATE UNIQUE INDEX "DiagnosticAssessment_sourceKey_key"
  ON "DiagnosticAssessment"("sourceKey");
CREATE UNIQUE INDEX "DiagnosticQuestion_assessmentId_sourceKey_key"
  ON "DiagnosticQuestion"("assessmentId", "sourceKey");
CREATE UNIQUE INDEX "DiagnosticReadingPassage_assessmentId_sourceKey_key"
  ON "DiagnosticReadingPassage"("assessmentId", "sourceKey");
```

- **`DESTRUCTIVE_STATEMENTS_COUNT=0`** — scanned for `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`,
  `ALTER COLUMN`, `SET NOT NULL`, `CASCADE`.
- **`UNINTENDED_DATA_REWRITE_COUNT=0`** — each `ADD COLUMN` is `TEXT` with no `DEFAULT` and no
  `NOT NULL`, which PostgreSQL performs as a catalog-only change. No heap rewrite, no `UPDATE`.
- **Scope verified, not assumed.** The B0 proposal named three models. Reading
  `prisma/schema.prisma` confirms that is still correct: `DiagnosticRubric` already has
  `@@unique([skill, rubricVersion])` and `DiagnosticListeningClip` already has
  `@@unique([questionId, version])`, so neither needs a new column.
- **No duplicate constraint.** Existing indexes are `pkey`, `(assessmentId, order)`,
  `(assessmentId, skillCode)` and `(passageId)` on `DiagnosticQuestion`; `pkey` and
  `(assessmentId, order)` on `DiagnosticReadingPassage`; `pkey`, `single_active_key` and
  `status_idx` on `DiagnosticAssessment`. None covers `sourceKey`.
- **Ownership scope** is per assessment for questions and passages, global for the assessment —
  matching how the importer resolves references.
- **Transaction behaviour.** Prisma wraps a migration file in one transaction, and all six are
  transactional DDL in PostgreSQL, so a mid-file failure rolls back and leaves no partial column.
- **Rollback.** Forward-only; Prisma has no down-migration. Reversal would be three `DROP INDEX`
  plus three `DROP COLUMN` on columns only the V2 importer writes. Not required for B2B and not
  authorized here.

Recorded rather than assumed: `CREATE UNIQUE INDEX` is issued **without** `CONCURRENTLY` and takes
an `ACCESS EXCLUSIVE` lock. On 1 assessment row, 20 question rows and 0 passage rows this is
sub-millisecond. Acceptable.

```
MIGRATION_SQL_REVIEW_PASS=true
```

---

## 5. Constraint compatibility with existing data

Both lifecycle constraints already exist in the real database:

| Name | Kind | Definition |
|---|---|---|
| `DiagnosticAssessment_status_matches_isActive` | CHECK | `CHECK (((status = 'ACTIVE') = "isActive"))` |
| `DiagnosticAssessment_single_active_key` | partial unique index | `UNIQUE ("isActive") WHERE ("isActive" = true)` |

`DiagnosticAssessmentStatus` enum: `DRAFT, READY, ACTIVE, ARCHIVED`.

**Is the CHECK appropriate for the real lifecycle?** Yes. `isActive` is a derived boolean — true
exactly when `status = 'ACTIVE'`. The CHECK stops the two columns drifting apart, which is the
failure mode that would otherwise let a DRAFT be served to learners. All three non-ACTIVE states
map correctly to `isActive = false`: a draft is not live, a ready-but-unreleased form is not live,
an archived form is not live.

A future need for two simultaneously live forms (A/B delivery) would be blocked by
`single_active_key`, not by this CHECK — a deliberate product constraint, and no such requirement
exists in the approved scope. Neither constraint was weakened, and the B1 migration introduces no
new CHECK or partial index.

**Existing rows satisfy everything proposed.** All current rows will hold `sourceKey = NULL`, and
PostgreSQL treats each NULL as distinct in a btree unique index, so neither the single assessment
nor the 20 questions can collide. `rowsRequiringBackfill = 0`, `rowsViolatingAnyProposedConstraint
= 0`. The imported row will be `status=DRAFT, isActive=false`: it satisfies the CHECK, and the
partial index excludes it because its predicate is `isActive = true`, so the existing ACTIVE row
is untouched.

Empirical precedent: B1 Test A applied this exact migration over a V1-shaped fixture (1
assessment, 20 questions, `options` as a JSON array) and returned `1|20|20|3`. The real database
has the same shape.

```
EXISTING_DATA_CONSTRAINT_COMPATIBILITY_PASS=true
```

---

## 6. Importer and test audit

`contentVersion=6`, 29 items (Listening 10, Reading 10, Speaking 2, Writing 2, LanguageUse 5),
25 objective, 4 authored clips, 3 passages, rubrics `SPEAKING/SPK_RUBRIC_V3` and
`WRITING/WRT_RUBRIC_V3`. Validator in `--check` mode: `HASH_MISMATCH_COUNT=0`,
`POST_REVISION_HASH_CHECK_PASS=true`, `MECHANICAL_VALIDATION_PASS=true`, `MANIFEST_WRITTEN=false`.
`git status` shows no `artifacts/` file modified.

Safety properties, each verified by reading the committed source:

| Property | Evidence |
|---|---|
| Hashes checked before import | `loadApprovedContent(dir, verifyHashes = true)`; manifest read before any row is touched |
| Duplicate keys rejected **before** the transaction | `assertUniqueSourceKeys` at line 201; `$transaction` opens at line 210 |
| Explicit allowlist | `assertNoAuthoringFields` rejects any authoring field or non-column key |
| Explicit DRAFT/inactive | `isActive: false`, `status: 'DRAFT'` literal at 216–217, re-asserted at 424 before commit |
| No unnecessary updates | `differs()` uses an order-independent canonical serialisation |
| No blanket deletes | no `delete`, `deleteMany`, `executeRaw`, `queryRaw`, `TRUNCATE` or `DROP` in the source |
| No auto-activation | `isActive` is never written `true` on any path |
| No spread into a Prisma payload | spread appears only when concatenating draft arrays into a work list |
| Safe failure reporting | every refusal names the offending identity |

**The three B1 defects are genuinely fixed at HEAD:**

- **B1-001** — `assertUniqueSourceKeys` (importer:150) called at :201, before the transaction.
  10 unit cases covering duplicates across sections, within a section, between a task and an
  item, passages, clips, rubric `skill@version`, and a missing identity.
- **B1-002** — `canonical()` (importer:125) used by `differs()` at :141. Proved by xmin across
  45 rows, 0 rewritten.
- **B1-003** — `titledPassage` (mapper:201) applied at :276. 5 unit cases including one that
  reproduces the defect and one proving idempotence across re-imports.

```
IMPORTER_SOURCE_MATCHES_B1_EVIDENCE=true
```

---

## 7. Listening media registration

4 authored clips, 10 Listening questions, **10 clip registry rows** — the count taken from B1
evidence, not invented.

`DiagnosticListeningClip.questionId` is a required 1:1 foreign key keyed
`@@unique([questionId, version])`, so one row cannot serve several questions without a migration.
The importer loops over the 10 Listening *items* and derives `storageKey` and `scriptSha256` from
the resolved **clip**, so questions on the same authored clip necessarily receive identical
`storageKey`, `url`, `script`, `scriptSha256`, `locale` and `accent` — 4 distinct script hashes
across 10 rows. An unresolved `mediaDraftKey` throws with the key named.

**No ten-file TTS assumption:** every row has `url: ''`, `storageKey` ending `.pending`,
`generationSource: 'PENDING_PHASE_E'` and `isActive: false`. No audio is generated, uploaded or
referenced. Duplicate media ownership: 0, prevented by the existing unique key.

**No learner-facing transcript.** The script lives in `DiagnosticListeningClip`, not in
`DiagnosticQuestion.options`. B1's learner payload check recorded the complete served key set
(§9) and no transcript field appears in it.

Phase E later sets `url`, `storageKey` and `isActive` on existing rows, changing no approved
question content.

---

## 8. DRAFT lifecycle — implemented, but B1's test was weaker than it looked

Every assessment selection path in `diagnostic.service.ts` filters `isActive: true`:

| Method | Line | Filter |
|---|---|---|
| `getCurrentAssessment` | 527 | `where { isActive: true }, orderBy { id: desc }` |
| `getLatestResult` | 599 | `where { isActive: true }, orderBy { id: desc }` |
| `startAttempt` | 616 | `where { id: assessmentId, isActive: true }` |
| `submitAttempt` | 706 | `where { id: assessmentId, isActive: true }` |

An imported DRAFT has `isActive = false` and matches none of them. `startAttempt` throws
`NotFoundException`, so an attempt cannot be created against it. `assertQuestionBank` runs only on
an already-selected assessment, so the V2 productive tasks are never validated on a live learner
request. `getCurrentAssessment` keeps returning `id=1`.

```
DRAFT_ISOLATION_IMPLEMENTED=true
```

### B2A-GAP-002 — the test gap, stated plainly

**B1 Test F did not exercise the real selection code.** It issued a hand-written statement:

```sql
SELECT id FROM "DiagnosticAssessment" WHERE "isActive" = true ORDER BY id DESC LIMIT 1
```

`scripts/audit/b1-import-rehearsal.ts` imports only `PrismaClient`, `importApprovedContent` and
`assertNoAuthoringFields`. It never imports `DiagnosticService`.

Attempt creation against a DRAFT was never attempted at all. The B1 report called it *"not
reachable"* — an argument from the predicate, not a test result.

What **is** proven: the predicate equivalence is real, and all four call sites were read and
verified. What is **not** proven: that `getCurrentAssessment` and `startAttempt` behave correctly
end to end against a database holding both the legacy ACTIVE row and an imported DRAFT, including
`assertQuestionBank` and `formQuestions`, which the raw SQL bypassed entirely.

The contrast is instructive: the learner payload check *did* call the real serializer
(`DiagnosticService.prototype.sanitizeQuestion`). The selection test did not get the same
treatment.

```
DRAFT_CURRENT_SELECTION_TEST_PASS=false
DRAFT_ATTEMPT_BLOCK_TEST_PASS=false
```

Carried into B2B steps 12 and 13 as required verifications. A raw SQL equivalent will not be
accepted there.

---

## 9. Learner payload

Verified by invoking the **real** `DiagnosticService.prototype.sanitizeQuestion` on the actual
imported rows. The mapper allowlist was not accepted as evidence: an allowlist proves what is
*written*, not what is *served*.

Complete served key set: `audioUrl, construct, id, options, order, passageBody, passageText,
passageTitle, question, questionType, section, skill`.

| Must not appear | Status |
|---|---|
| `correctIndex` | absent as a key |
| correct answer | not derivable — options permuted per attempt; key stayed in place for only 7 of 25 MCQ items |
| `explanation` | absent as a key; 25 rows carry one, 0 of those strings appear in the payload |
| `answerRationale` | mapped to `explanation`, served only at result time (`diagnostic.service.ts:365`, `:846`) |
| `distractorRationales` | never persisted; sentinel reached 0 rows |
| `internalLabel` | never persisted; passage `title` column deliberately NULL |
| authoring provenance | `targetEvidence`, `constructRationale`, `diagnosticUse` sentinels each reached 0 rows |
| `difficulty` / `intendedLevel` | absent as keys; tiers D1–D4 stored but 0 appear in the payload |
| hidden Listening transcript | script held in `DiagnosticListeningClip`, not in the served key set |

**Reading:** 10 of 10 items serve the complete authored passage, compared against
`DiagnosticReadingPassage.text` rather than the stored `passageText`. 0 items have the opening
paragraph hoisted into a title. Before the B1-003 fix, 7 of 10 lost 405 characters.

**Listening:** 10 served, 10 carry the `audioUrl` field, all null, 0 fabricated paths.
**Productive:** 4 served, all `OPEN_TEXT` with no options; Speaking carries prep/response seconds,
Writing carries word bounds. **LanguageUse:** 5 served, 4 options each.

Import confidentiality is verified. Audio *availability* is a separate, unmet Phase E
prerequisite — `audioUrl` is null by design.

```
LEARNER_PAYLOAD_CONFIDENTIALITY_VERIFIED=true
READING_FULL_PASSAGE_DELIVERY_VERIFIED=true
```

---

## 10. Idempotency and concurrency — classified accurately

**Idempotency rests on `xmin`, not on counts or timestamps.** Lines 280–293 of the B1 harness
snapshot `xmin` across all five tables before and after an identical re-import: **45 rows
compared, 0 rewritten**, alongside `ADDITIONAL_ROWS=0` and `EXISTING_ROWS_CHANGED=0`. This was
necessary because `DiagnosticQuestion` has no `updatedAt` column, so a timestamp check could not
have detected an unnecessary rewrite at all.

```
REIMPORT_IDEMPOTENCY_EVIDENCE_PASS=true
```

**Concurrency: duplicate prevention is proven; transparent concurrent success is not.** Two
separate Prisma clients on separate connections raced into an empty database. Outcome: **one
fulfilled, one rejected** by the unique index on `DiagnosticAssessment.sourceKey` added by this
migration — a database constraint, not application locking and not isolation level.

- **Rejected attempt rolled back cleanly.** It ran inside `prisma.$transaction`, and the post-race
  counts were exactly 1 / 29 / 3 / 10 / 2 with 0 duplicates of any kind. A surviving partial write
  would have raised at least one count. No partial state observed.
- **Safe retry: inferred, not tested.** A retry after losing the race takes the idempotent path —
  `findFirst` locates the winner's row and `differs()` reports no change. This follows from the
  verified idempotency evidence but was **not** run as a distinct retry-after-conflict test.
- **Conflict reporting is accurate but not friendly** (B2A-GAP-003). The loser receives the raw
  Prisma unique-constraint error; the importer does not translate it into a domain message.
  Harmless for a single-operator run.

**This is explicitly not a successful concurrent import.** One of the two invocations failed.
B2B runs the importer exactly once at a time, so the non-transparent rejection path is never
exercised.

```
CONCURRENT_DUPLICATE_PREVENTION_PASS=true
CONCURRENT_IMPORT_OPERATIONAL_BEHAVIOR=ONE_WRITER_SUCCEEDS_OTHER_REJECTED_BY_UNIQUE_CONSTRAINT_RETRY_SAFE_NOT_TRANSPARENT
```

---

## 11. Protected checkpoint and restore verification

Automatic policy: `pg_dump -Fc` every 21600s, 14-day retention, written by
`kltn-postgres-backup` to `D:/Study/KLTN/.local-backups/breadtrans-auto` — a host directory
outside the PostgreSQL data volume — with a `pg_dumpall --globals-only` companion and a
`.meta.json` sidecar.

**Protected dumps are outside pruning, by three independent mechanisms** in `backup.sh`:

1. filename substring guard — `case "$old" in *PROTECTED*) continue ;;`
2. structural guard — `automatic_stamp_of "$old" >/dev/null || continue`, so a labelled dump never
   matches the automatic `<db>_<YYYYMMDD>_<HHMMSS>` pattern and is unreachable by the prune loop
   even if the substring guard were removed
3. the most recent automatic dump is never removed

`scripts/db-backup.ps1 -Label <X>_PROTECTED` produces such a file. Precedent exists:
`PRE_RESEED_PROTECTED`, `PRE_LEARNER_RECOVERY_PROTECTED`, `PRE_R2_CONTENT_RECOVERY_PROTECTED`.

Current state: **20 dumps**, newest `kltn_db_20261026_010617.dump` (683084 bytes, sha256
`727fa9ea…`). It is hours old and postdates everything in this phase because B2A wrote nothing —
but it is class `AUTOMATIC`, so it is prunable and **must not** be relied on as the B2B
checkpoint.

### Checkpoint procedure for B2B

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-backup.ps1 \
  -Label PRE_DIAGNOSTIC_V2_IMPORT_PROTECTED
```

Verify before proceeding: the `.dump` exists and its size is near the current ~683 KB; the sha256
in the `.meta.json` matches a freshly computed hash; `backupClass` reads `PROTECTED_BASELINE`;
`pg_restore -l` lists a non-empty table of contents.

### Restore verification

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-restore-drill.ps1
```

Isolation verified by reading the script: it starts a disposable `postgres:15-alpine` container
with **no published host port**, copies the archive in, runs `pg_restore` into a database inside
that container, runs assertion SQL, then destroys the container and its volume. It never connects
to `kltn_db` or `kltn_shadow`. **Nothing is ever restored into `kltn_db`** — a drill proves the
archive is usable; it is not a recovery action.

```
PROTECTED_CHECKPOINT_PROCEDURE_READY=true
RESTORE_VERIFICATION_PROCEDURE_READY=true
NEW_PRECHANGE_CHECKPOINT_CREATED=false
```

No checkpoint was created during B2A. B2A is read-only, and creating one is a filesystem write
that was not part of this phase. **The B2B checkpoint does not yet exist.**

---

## 12. Controlled B2B execution plan

Single-writer throughout. Every step marked **STOP** requires explicit user authorization before
it runs; a failure at any step aborts the phase and nothing later is attempted.

| # | Step | Writes |
|---|---|---|
| 1 | Verify target identity: `current_database = kltn_db`, `system_identifier = 7674533776495505443`. A different identifier means a different cluster — stop. | no |
| 2 | Verify approved hashes: validator `--check`, require `HASH_MISMATCH_COUNT=0` | no |
| 3 | Verify connections: `DATABASE_URL` → 5432/`kltn_db`, `SHADOW_DATABASE_URL` → 5433/`kltn_shadow`; no app process holding an open write transaction | no |
| 4 | **STOP** — create the protected checkpoint, verify size/sha256/`backupClass`/`pg_restore -l`, then run the restore drill and require it to pass | host backup files only |
| 5 | **STOP** — confirm `migration.sql` is byte-identical to the file reviewed here: 6 statements, 0 destructive | no |
| 6 | **STOP** — `npm run db:migrate:deploy` (uses no shadow database; never `migrate dev`, never `db push`) | `kltn_db` schema |
| 7 | Verify schema and legacy data: `sourceKey` on exactly 3 tables, 3 new unique indexes, `migrations_finished=68`, baseline still 1/20/0 with 20 NULL source keys | no |
| 8 | **STOP** — run the importer **once**, default options so the manifest is verified | `kltn_db` rows |
| 9 | Verify the content graph: 1 new assessment, 29 questions, 3 passages, 10 clip rows over 4 distinct script hashes, 2 rubrics, 0 reading questions without a passage, 0 productive tasks without a rubric, 0 rows with `intendedLevel`, 0 authoring sentinels | no |
| 10 | Run the importer again: require `ADDITIONAL_ROWS=0`, `EXISTING_ROWS_CHANGED=0`, 0 rows rewritten by `xmin` | none expected; a write here is a failure |
| 11 | Verify existing data unchanged: `id=1` byte-identical including `xmin`, 20 legacy questions unchanged, 0 attempts, 7 users | no |
| 12 | Call the **real** `getCurrentAssessment` and require `id=1`. Closes B2A-GAP-002; raw SQL is not acceptable | no |
| 13 | Call the **real** `startAttempt` against the DRAFT id and require `NotFoundException`; call `getCurrentAssessment` and `getLatestResult` and require unchanged behaviour | no |
| 14 | Report final state; V2 stays DRAFT and inactive | no |

Prohibited throughout: `prisma migrate reset`, `prisma db push`, `prisma db seed`, `TRUNCATE`,
`DROP`, drop-and-recreate, bulk cleanup, restore into `kltn_db`, any concurrent importer
invocation.

**A verified checkpoint is a precondition for step 6, never a justification for it.** Each write
step is authorized on its own merits.

---

## 13. Findings recorded as blockers, not patched

No migration file, importer source, mapper, test or approved content artifact was modified during
B2A.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| B2A-GAP-001 | MINOR | `verifyHashes` can be set `false` by a caller; nothing stops the manifest check being disabled against a real database | procedural control — B2B uses default options |
| B2A-GAP-002 | MAJOR (evidence) | B1 Test F used hand-written SQL instead of the real selection code; attempt blocking was argued, never tested | **must** be closed by B2B steps 12 and 13 |
| B2A-GAP-003 | MINOR | A concurrent loser receives a raw Prisma error, not a domain conflict message | no change proposed; B2B is single-writer |
| B2A-NOTE-001 | INFO | `CREATE UNIQUE INDEX` without `CONCURRENTLY` takes `ACCESS EXCLUSIVE`; negligible on 1 and 20 rows | accepted |

### Remaining blockers before B2B

1. B2A-GAP-002 — real selection paths never exercised end to end.
2. No protected pre-change checkpoint exists yet.

### Remaining blockers for activation, after B2B

Real Listening audio; speaker voice casting; actual audio playback; productive Speaking runtime
end to end; Writing runtime end to end; objective permutation grading fix;
`FOUR_SKILL_PLACEMENT_V2` scorer; DEF-004 result-band decision; AI grading reliability; final
result calculation; readiness and activation checks.

**B2B persists a DRAFT only.** It does not make the assessment functional and does not activate it.

---

## 14. Evidence that nothing was mutated

Re-verified read-only after all B2A work:

```
kltn_db      sysid=7674533776495505443  migrations=67  assess=1 quest=20 attempt=0
             passage=0 clip=0 rubric=0  sourceKey_cols=0   xmin(id=1)=177085
kltn_shadow  sysid=7699757546958700579  tables=112        sourceKey_cols=0
git status   M docker-compose.yml   (restart policy only — unrelated maintenance)
```

```
REAL_DB_MUTATED=false
SHADOW_DB_MUTATED=false
DATABASE_RESET=false
DATABASE_TABLES_DROPPED=0
V2_CANONICAL_CONTENT_ROWS_CREATED=0
V2_ACTIVATED=false
```

---

## 15. Verdict

```
PHASE_B2A_VERDICT=PRE_APPLY_PASS
```

Every condition in the §18 acceptance list is satisfied and verified against the real repository
and the real database. The two `false` flags — `DRAFT_CURRENT_SELECTION_TEST_PASS` and
`DRAFT_ATTEMPT_BLOCK_TEST_PASS` — are not acceptance conditions. They record that B1 proved DRAFT
isolation by reading the source and by an equivalent SQL predicate rather than by calling the real
service, and they are carried into B2B steps 12 and 13 as required verifications.

A passing B2A preflight does not authorize B2B. It authorizes asking for authorization.

```
B2B_READY_FOR_USER_AUTHORIZATION=true
B2B_LIVE_CHANGE_AUTHORIZED=false
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
```
