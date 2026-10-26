# Phase B1 — Isolated Database Migration & Idempotent Import Rehearsal

**Date:** 2026-10-26
**Scope:** Prove the additive migration and the content importer are safe, idempotent and
confidential, against a disposable PostgreSQL 15 database. Authorizes nothing against any
real database.

> **Independence caveat.** This phase was executed by the author of the migration, the mapper
> and the importer. Every result below comes from a check this same author wrote. It is
> self-verification, not an independent gate. Three of the failures recorded in §8 were false
> results produced by the author's own assertions — that is the measured error rate of the
> harness itself, and it is the reason §9 does not treat this phase as sufficient for live
> persistence.

No password or connection string appears in this report. Databases are identified by name,
port and cluster `system_identifier`.

---

## 1. Isolation — proved by cluster identity, not by port

A third port is not proof of a third database, and an environment-variable name is not proof
of anything. Each cluster was asked for its own identity:

| Database | Port | `system_identifier` | Role |
|---|---|---|---|
| `b1_rehearsal` | 5434 | `7700649961718374440` | disposable, created for this phase |
| `kltn_db` | 5432 | `7674533776495505443` | **protected — never written** |
| `kltn_shadow` | 5433 | `7699757546958700579` | **protected — never used** |

All three differ. The rehearsal container (`kltn-b1-rehearsal-47285`, volume
`kltn-b1-rehearsal-47285-vol`) was created fresh for this phase and labelled
`breadtrans.phase=B1_REHEARSAL`, `breadtrans.disposable=true`. No pre-existing container was
reused on the grounds of looking empty. Server version `15.19`.

The harness **refuses** a protected target rather than merely avoiding one, and that refusal
is itself asserted: the harness re-invokes itself with a `kltn_db` URL and requires the child
process to refuse. The reset script independently verifies the container's `system_identifier`
and its `disposable` label before it drops anything.

`prisma migrate dev` was never run against any database in this phase. `prisma migrate deploy`
was used throughout; it does not create or reset a shadow database.

---

## 2. The migration is additive

`prisma/migrations/20261025120000_diagnostic_source_identity/` — three `ADD COLUMN`, three
`CREATE UNIQUE INDEX`, nothing else:

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

- **Destructive statements: 0** (scanned for `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`,
  `ALTER COLUMN TYPE`, `SET NOT NULL`).
- **No backfill is required**, and this is not an assumption: `sourceKey` is nullable, and
  Postgres treats every `NULL` as distinct in a unique index, so the 20 existing V1 rows need
  no value and cannot collide with each other.
- **Scope was narrowed from 5 tables to 3.** `DiagnosticRubric` already has
  `@@unique([skill, rubricVersion])` and `DiagnosticListeningClip` already has
  `@@unique([questionId, version])`. Adding `sourceKey` to those would have been redundant
  schema change for no identity gain. The author's claim that a migration was necessary was
  not taken on trust; each table's existing constraints were read first.

**Test A — migration over V1-shaped data: PASS.** 67 pre-existing migrations applied, then a
V1-shaped fixture seeded (1 assessment, 20 questions), then the additive migration.
Assertions returned `1|20|20|3`: one assessment, 20 questions, 20 `NULL` source keys, 3 new
columns. The fixture was **authored** in `scripts/audit/b1-reset-rehearsal.sh` — it is not a
dump or restore of `kltn_db`.

---

## 3. Tests B and C — first import, then repeated import

**Test B — first import: PASS.**

| | rows |
|---|---|
| assessment | 1 (id 2, `isActive=false`, `status=DRAFT`) |
| questions | 29 — Listening 10, Reading 10, LanguageUse 5, Speaking 2, Writing 2 |
| reading passages | 3 |
| listening clip registrations | 10 |
| rubrics | 2 |

Reference integrity: every Reading question resolves a passage (0 orphans), the 10 Reading
items span exactly 3 passages, every productive task resolves a rubric (0 orphans), and
**0 rows carry a CEFR level** — `intendedLevel` is hard-coded `null` in the mapper.

**Clip cardinality, resolved without a migration.** `DiagnosticListeningClip.questionId` is a
required 1:1 FK, while the content has 4 clips serving 10 questions. Ten registry rows were
written, one per Listening question, **sharing 4 audio assets** — confirmed by
`count(distinct scriptSha256) = 4` across the 10 rows. Ten separately generated audio files
were **not** created. Every row is `generationSource = PENDING_PHASE_E` with an empty `url`,
and `options.audioUrl` is `null`. No audio asset was invented.

**Test C — repeated import: PASS.**

```
ADDITIONAL_ROWS=0
EXISTING_ROWS_CHANGED=0
```

The importer created 0 rows and updated 0 rows on the second run. Stronger: across all 45
rows of the import, **0 were physically rewritten**, proved by comparing Postgres `xmin` — the
inserting transaction id, which changes on every `UPDATE`. This matters because
`DiagnosticQuestion` has **no `updatedAt` column**, so a timestamp check could not have
detected an unnecessary rewrite at all.

Reaching that result required fixing a real defect first — see **B1-002** in §7.

---

## 4. Test D — transactional rollback: PASS

Failure was injected after `passages`, after `questions` and after `clips`. Every injection
threw, and after every rollback all five row counts were byte-identical to the pre-injection
snapshot. The importer performs all writes inside one `$transaction`; it never deletes and
never re-inserts, so a partial failure cannot orphan an attempt reference.

---

## 5. Test E — invalid source fixtures: PASS

Fixtures were built in temporary directories **outside** `artifacts/`. The approved content was
never mutated; `HASH_MISMATCH_COUNT=0` after the phase confirms it is byte-intact.

| Fixture | Refused | Message | Rows left behind |
|---|---|---|---|
| tampered passage text | yes | `passage:RDG_PASSAGE_01 does not match the approved manifest hash` | 0 |
| duplicate source keys | yes | `duplicate question draftKey "RDG_Q_001"` | 0 |
| missing passage reference | yes | `passageDraftKey "RDG_P_DOES_NOT_EXIST" is unresolved` | 0 |
| missing clip reference | yes | `clip LST_C_DOES_NOT_EXIST unresolved` | 0 |
| missing rubric reference | yes | `rubricVersion "does-not-exist" is unresolved` | 0 |
| invalid answer key | yes | `correctAnswer is not one of options` | 0 |
| ambiguous answer key | yes | `correctAnswer is not unique in options` | 0 |

The duplicate-source-keys row **failed on its first run** and exposed defect **B1-001** (§7).

### Forbidden authoring metadata — what is actually true

Extra authoring metadata on a draft item is **not refused**, and reporting it as refused would
be a false PASS. The mapper names every column explicitly, so an unknown draft field is
structurally unreachable and is simply dropped. Two separate claims were asserted instead:

1. **It reaches no row.** Five distinct sentinels were injected (`internalLabel`,
   `targetEvidence`, `constructRationale`, `diagnosticUse`, `distractorRationales`).
   Sentinels found in any column of any row: **0**.
2. **The allowlist genuinely fires.** `assertNoAuthoringFields` was *called* with a crafted
   payload and throws on an authoring field and on a non-column key. The guard was proved to
   fire, not inferred from the fact that it exists.

### Fields that do have a destination column

Two authored fields are deliberately mapped and must not be mistaken for leaks:

| Authored field | Column | Rows | Also in the delivered `options` blob | Reached `intendedLevel` |
|---|---|---|---|---|
| `answerRationale` | `explanation` | 25 | 0 | — |
| `difficultyTier` | `difficulty` | 25 | 0 | 0 |

`explanation` is exposed at result time only (`diagnostic.service.ts:365`, `:846`). The
difficulty tier is a design hypothesis and never lands in `intendedLevel`, which is the field
a CEFR claim would come from.

---

## 6. Tests F and G — DRAFT invisibility and concurrency

**Test F — DRAFT invisibility: PASS.** The active-assessment query returns the legacy row
(id 1), not the import (id 2). Exactly one active assessment exists. The legacy row is
byte-unchanged. Attempt creation against the import is not reachable, because the
active-assessment query never returns it.

The database enforces this with **two independent protections**, each blocked by a different
write, each probed with the write that actually exercises it inside a rolled-back transaction:

| Mechanism | Name | Blocks | SQLSTATE |
|---|---|---|---|
| CHECK constraint | `DiagnosticAssessment_status_matches_isActive` | `isActive=true` on a `DRAFT` row | 23514 |
| partial unique index | `DiagnosticAssessment_single_active_key` | a second row with `isActive=true` | 23505 |

The CHECK is the stronger of the two for this phase: a `DRAFT` row **cannot** be active at the
storage layer, regardless of what any application code attempts.

**Test G — concurrency: PASS, and actually tested.** The pair inside the main harness runs
*after* the content is already imported, so both calls take the no-op path and nothing
contends — **that run was not counted as a concurrency result**. A separate check forces the
real race: two separate Prisma clients, therefore separate connections, both started before
either is awaited, importing into a database holding no import yet.

```
outcomes: rejected / fulfilled
CONCURRENCY_SAFETY_MECHANISM=DATABASE_UNIQUE_CONSTRAINT
end state: 1 assessment, 29 questions, 3 passages, 10 clips, 2 rubrics
duplicate rows surviving: 0
```

The losing transaction was rejected by the unique index on `DiagnosticAssessment.sourceKey`,
added by this phase's migration. **Safety comes from a database constraint** — not from
application locking, and not from the transaction isolation level.

---

## 7. Three real defects, found and fixed in this phase

**B1-001 — duplicate source keys silently destroy an item (MAJOR).**
Two authored items sharing a `draftKey` both upsert onto the *same* row, so the second
overwrites the first item's content. The importer's own `expected 29 questions` assertion
cannot see this, because the row count never changes. Fixed with `assertUniqueSourceKeys`,
which runs before the transaction opens and covers question, passage and clip draft keys plus
rubric `skill@version` identities, and also refuses a missing identity. 10 unit tests, each of
which fails without the guard.

**B1-002 — jsonb key order falsified the idempotency result (MINOR).**
Change detection compared fields with `JSON.stringify`. `options` is a `jsonb` column and
Postgres does not preserve object key order, so a byte-identical re-import would have reported
an update and rewritten every question row. Fixed with an order-independent canonical
serialisation. Re-verified: 45 rows, 0 physically rewritten.

**B1-003 — Reading passages lost their opening paragraph in the learner payload (MAJOR).**
`sanitizeQuestion` reads line 1 of `passageText` as the passage **title** and serves only the
remaining lines as the body — a V1 convention where passages were stored as a title line
followed by the body. The imported passages have no title line, so **7 of 10 Reading items had
their opening paragraph hoisted into a heading and removed from the text the learner reads:
405 characters lost.** Three of the ten Reading items depend on information in that paragraph.

No row count, no allowlist and no mapper unit test would have caught this. It surfaced only
because the check runs the **real serializer on the real stored rows**.

Fixed in `titledPassage`, which prefixes the exact generic heading the serializer itself
already falls back to for single-line passages. No new learner-facing content is introduced,
the authored body is unchanged and complete after the split, and **no runtime change was
needed**. 5 unit tests, including one that reproduces the defect and one that proves the fix is
idempotent across re-imports. Re-verified: 10 of 10 Reading items now serve the complete
authored passage, compared against `DiagnosticReadingPassage.text` rather than against the
stored `passageText`.

---

## 8. Three defects in the author's own checks

Recorded because they are the measured error rate of this phase's verification, and because
two of them would have produced a **false FAIL** that could have been "resolved" by weakening
the assertion:

1. A confidentiality check used the pattern `%D9%` — two characters, unanchored,
   case-insensitive. It matched the V1 fixture's own option text `"D9"` and reported a leak
   that did not exist. Every sentinel is now a long distinctive token, reported individually.
2. The same check asserted *"reached no column of any row"* for `answerRationale` and
   `difficultyTier`, which are deliberately mapped to real columns. Two correct mappings were
   reported as leaks. Fields are now split by destination, with separate assertions.
3. Test F asserted the partial unique index but probed it with a write that trips the CHECK
   constraint instead, so a correct database refusal was reported as a FAIL. Both protections
   are now asserted, each probed with the write that exercises it.

---

## 9. Learner payload and delivery metadata

Verified by invoking the **real** `DiagnosticService.sanitizeQuestion` on the **actual imported
rows**, with the real `getQuestionMeta` and `getQuestionOptions`. The mapper allowlist was not
accepted as evidence: an allowlist proves what is *written*, not what is *served*.

Served keys: `audioUrl, construct, id, options, order, passageBody, passageText, passageTitle,
question, questionType, section, skill`.

- `correctIndex`, `explanation`, `difficulty`, `intendedLevel` — **absent as keys**.
- 25 rows **do** carry an explanation, so the absence check is not vacuous; **0** of those
  explanation strings appear anywhere in the served payload.
- Stored tiers `D1–D4`: **0** appear in the served payload.
- MCQ options are permuted per attempt — the key stayed in its authored position for only
  7 of 25 items, so position does not reveal the answer.

| Flag | Value | Evidence |
|---|---|---|
| `LISTENING_DELIVERY_METADATA_VALID` | true | 10/10 carry the audio contract; `audioUrl` is `null`, never a fabricated path |
| `READING_DELIVERY_METADATA_VALID` | true | 10/10 serve the complete authored passage; 0 hoisted paragraphs |
| `PRODUCTIVE_TASK_METADATA_VALID` | true | 4/4 `OPEN_TEXT` with no options; Speaking carries prep/response seconds, Writing carries word bounds; no `correctIndex` exposed |

---

## 10. Protected databases after the phase — read-only verification

`kltn_db` (`system_identifier 7674533776495505443`): **1** assessment, **20** questions,
**0** attempts, **0** reading passages, **0** listening clips, **0** rubrics. `sourceKey` exists
on **0** Diagnostic tables. **67** migrations applied, latest
`20261025054012_diagnostic_v2_schema_foundation` — this phase's migration is **not** present.
The single row is id 1, `isActive=true`, `status=ACTIVE`, title "Kiểm tra trình độ đầu vào".

`kltn_shadow` (`system_identifier 7699757546958700579`): 112 public tables, `sourceKey` on
**0** Diagnostic tables. Never used for this rehearsal.

Both untouched.

### Reported inconsistency B1-INC-001 — not reconciled

A plan file in the workspace (`~/.claude/plans/magical-snacking-crown.md`) records as
*completed* work that `DiagnosticAssessment id=2` titled "Entry Diagnostic v2" existed in the
real database and was renamed to "Kiểm tra đầu vào".

**The verified state contradicts this:** `kltn_db` contains exactly one assessment row, id 1,
title "Kiểm tra trình độ đầu vào". There is no id 2, and no row titled "Kiểm tra đầu vào".

This is **reported, not reconciled**. Either that row was later removed, or the plan file
describes a different database or session. No write was made to investigate, and no consistency
was assumed in either direction. It has no impact on B1: this phase touched only the disposable
database, and the import is keyed by `sourceKey`, which no existing `kltn_db` row carries.

---

## 11. Verification commands

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx jest src/modules/diagnostic` | 9/9 suites, **178/178 tests** |
| `npx eslint scripts/audit/b1-*.ts src/modules/diagnostic/v2-*.ts` | 0 errors |
| `git diff --check` | exit 0 |
| `validate-entry-diagnostic-v2-draft.ts --check` | `HASH_MISMATCH_COUNT=0`, `MECHANICAL_VALIDATION_PASS=true` |

**The full suite was not run and a full-suite pass is not claimed.**
`speaking-post-processing.service.spec.ts` has a pre-existing failure under the parallel full
run that passes 8/8 in isolation; it is unrelated to B1.

Assertion totals, all against a freshly reset database after every fix:

| Check | PASS | FAIL |
|---|---|---|
| rehearsal harness | 74 | 0 |
| learner payload | 23 | 0 |
| concurrency | 8 | 0 |
| **total** | **105** | **0** |

---

## 12. Flags

```
B1_ISOLATED_DATABASE_CREATED=true
B1_ISOLATION_PROVEN_BY=CLUSTER_SYSTEM_IDENTIFIER
B1_REHEARSAL_SYSTEM_IDENTIFIER_DISTINCT_FROM_BOTH_PROTECTED=true
B1_HARNESS_REFUSES_PROTECTED_TARGETS=true
B1_PROTECTED_DB_USED_FOR_REHEARSAL=false
MIGRATE_DEV_USED=false
SHADOW_DATABASE_RESET=false

MIGRATION_ADDITIVE_ONLY=true
MIGRATION_DESTRUCTIVE_STATEMENT_COUNT=0
MIGRATION_BACKFILL_REQUIRED=false
MIGRATION_APPLIES_OVER_V1_DATA_PASS=true

FIRST_IMPORT_ASSESSMENT_ROWS=1
FIRST_IMPORT_QUESTION_ROWS=29
FIRST_IMPORT_PASSAGE_ROWS=3
FIRST_IMPORT_CLIP_ROWS=10
FIRST_IMPORT_RUBRIC_ROWS=2
FIRST_IMPORT_IS_INACTIVE_DRAFT=true
REFERENCE_INTEGRITY_PASS=true
CEFR_LEVELS_PERSISTED=0
AUDIO_FILES_GENERATED=0
DISTINCT_CLIP_SCRIPTS=4

ADDITIONAL_ROWS=0
EXISTING_ROWS_CHANGED=0
ROWS_PHYSICALLY_REWRITTEN=0
IDEMPOTENCY_PROVED_BY=POSTGRES_XMIN_ROW_VERSION

TRANSACTIONAL_ROLLBACK_PASS=true
ROLLBACK_INJECTION_POINTS_TESTED=3

INVALID_SOURCE_REFUSAL_PASS=true
INVALID_SOURCE_FIXTURES_TESTED=7
INVALID_SOURCE_ROWS_LEFT_BEHIND=0
AUTHORING_METADATA_IMPORT_EXCLUSION_PASS=true
AUTHORING_METADATA_REFUSED=false
AUTHORING_METADATA_DROPPED_AND_UNREACHABLE=true

DRAFT_INVISIBLE_TO_LEARNER_PASS=true
ACTIVE_ASSESSMENT_COUNT=1
DB_PROTECTIONS_OBSERVED=2

CONCURRENCY_ACTUALLY_TESTED=true
CONCURRENCY_SAFE_PASS=true
CONCURRENCY_SAFETY_MECHANISM=DATABASE_UNIQUE_CONSTRAINT

LEARNER_PAYLOAD_CONFIDENTIALITY_PASS=true
LEARNER_PAYLOAD_TESTED_AGAINST=REAL_SANITIZE_QUESTION
LISTENING_DELIVERY_METADATA_VALID=true
READING_DELIVERY_METADATA_VALID=true
PRODUCTIVE_TASK_METADATA_VALID=true

DEFECTS_FOUND_IN_IMPORT_PIPELINE=3
DEFECTS_REMEDIATED=3
HARNESS_SELF_DEFECTS_CORRECTED=3

BACKEND_TYPECHECK_PASS=true
DIAGNOSTIC_TESTS_PASS=true
DIAGNOSTIC_TESTS=178/178
LINT_CHECK_PASS=true
GIT_DIFF_CHECK_PASS=true
FULL_SUITE_PASS=NOT_RUN
CONTENT_ARTIFACT_HASH_MISMATCH_COUNT=0

PROTECTED_DB_KLTN_DB_UNTOUCHED=true
PROTECTED_DB_KLTN_SHADOW_UNTOUCHED=true
KLTN_DB_ASSESSMENTS=1
KLTN_DB_QUESTIONS=20
KLTN_DB_ATTEMPTS=0
KLTN_DB_V2_ROWS=0
KLTN_DB_SOURCEKEY_COLUMNS=0

REPORTED_INCONSISTENCIES=1
INDEPENDENCE_MODE=AUTHOR_SELF_VERIFICATION
```

---

## 13. Verdict

```
ISOLATED_REHEARSAL_PASS
```

The additive migration applies cleanly over V1-shaped data with no backfill and no destructive
statement. The importer is transactional, idempotent at the storage level, refuses every
invalid source fixture without leaving a row behind, imports as an inactive `DRAFT` the
active-assessment query does not return, is safe under real concurrency by a named and observed
database constraint, and serves a learner payload that exposes no answer, no rationale and no
tier. Three real defects were found during the rehearsal; all three were fixed, unit-tested and
re-verified from a clean database.

This verdict covers the isolated rehearsal only. It is self-verification by the author of the
code under test.

```
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
```

Remaining blockers for live persistence:

1. **This phase is author self-verification.** An independent cold review of the migration,
   the importer and the learner payload has not been performed — and §8 shows this author's
   checks produced three wrong results in this phase alone.
2. **The B1-003 fix changes the stored delivery shape.** `options.passageText` now carries a
   heading line. The authored content is unchanged and still hash-verifies, but a reviewer
   should see this delivery-contract change before it reaches a real database.
3. **Listening audio does not exist.** All 10 clip rows are `PENDING_PHASE_E` with an empty
   `url` and `audioUrl = null`. The Listening section is not deliverable until Phase E.
4. **No backup-and-restore drill** for `kltn_db` was performed in this phase.

---

## 14. Teardown

The disposable container `kltn-b1-rehearsal-47285` and its volume
`kltn-b1-rehearsal-47285-vol` are removed at the end of this phase. The rehearsal is
reproducible from scratch: `scripts/audit/b1-reset-rehearsal.sh` recreates the database at
migration head with the V1-shaped fixture, and the three checks run against it.
