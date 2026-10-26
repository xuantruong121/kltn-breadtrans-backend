# Phase B2A.1 — Prisma Client / Live Database Schema Drift

**Date:** 2026-10-26
**Scope:** Restore local learner runtime without mutating any database. No migration applied,
no row imported, no column created by hand.

> **Independence caveat.** Diagnosed and fixed by the author of the B1 schema change that caused
> the drift. Self-verification, not independent review.

No password or connection string appears in this note.

---

## 1. Incident

```
GET /diagnostic/current          -> 500
GET /diagnostic/results/latest   -> 500
P2022: The column `DiagnosticAssessment.sourceKey` does not exist in the current database.
```

## 2. Root cause

```
ROOT_CAUSE=PRISMA_CLIENT_DATABASE_SCHEMA_DRIFT
PRISMA_CLIENT_HAS_SOURCEKEY=true
LIVE_DB_HAS_SOURCEKEY=false
```

Phase B1 added `sourceKey` to three models in `prisma/schema.prisma` and the client was
regenerated (`node_modules/.prisma/client/index.d.ts` names `sourceKey` 159 times). Migration
`20261025120000_diagnostic_source_identity` was **deliberately not applied** to `kltn_db`
(still 67 migrations, 0 `sourceKey` columns), as B1 and B2A required.

A Prisma query with no explicit `select` names every scalar column the client knows, including
through nested `include`. So every such query on the three models asked PostgreSQL for a column
that does not exist.

This is a defect in how B1 was left, not in the database: B1 updated the schema and the client but
left no guard for the runtime between "client knows the column" and "database has the column". B1
and B2A both verified the database was untouched and did not test that the running application
still worked against it.

**All three models are affected, not only the assessment.** Negative control, run read-only
against `kltn_db` with a plain client:

```
REPRODUCED assessment+questions  P2022  `DiagnosticAssessment.sourceKey` does not exist
REPRODUCED question.findFirst    P2022  `DiagnosticQuestion.sourceKey` does not exist
REPRODUCED passage.findMany      P2022  `DiagnosticReadingPassage.sourceKey` does not exist
```

---

## 3. Affected call sites

### Learner runtime — broken, now fixed (7)

| File | Line | Query | Models reached |
|---|---|---|---|
| `diagnostic.service.ts` | 526 | `getCurrentAssessment` — `findFirst` + `include: { questions }` | Assessment, Question |
| `diagnostic.service.ts` | 598 | `getLatestResult` — same shape | Assessment, Question |
| `diagnostic.service.ts` | 615 | `startAttempt` — `findFirst` + `include: { questions }` | Assessment, Question |
| `diagnostic.service.ts` | 705 | `submitAttempt` — same shape | Assessment, Question |
| `diagnostic-writing.service.ts` | 162 | `include: { assessment: { include: { questions: true } } }` | Assessment, Question (nested) |
| `diagnostic-speaking.service.ts` | 112 | `diagnosticQuestion.findFirst` | Question |
| `diagnostic-speaking.service.ts` | 392 | `diagnosticQuestion.findUnique` | Question |

Not two `findFirst` calls: seven, one of them reaching the drifted models only through a nested
relation from `DiagnosticAttempt`. The speaking worker runs in a separate process but uses the same
`PrismaService` through DI, so it was affected too.

### V2 importer — needs the new column, correct by design (not changed)

`src/modules/diagnostic/v2-content-importer.ts` lines 221–421 match and write on `sourceKey`. It
runs only after the B2B migration. Not a runtime path.

### Scripts outside the learner runtime — will still fail against `kltn_db` until B2B (not changed)

`scripts/audit-active-media-semantics.ts`, `scripts/audit-entry-diagnostic-structure.ts`,
`scripts/audit-learner-data-inventory.ts`, `scripts/materialize-entry-diagnostic-audio-v2.ts`,
`scripts/materialize-entry-diagnostic-v2.ts`, `scripts/qa/entry-diagnostic-*.ts` and
`prisma/seed.ts` construct their own `PrismaClient` without the omit. Run manually, never by the
API. Several of them write (materialize, seed, the QA remediation matrix), and running any of them
against `kltn_db` is outside every authorized phase anyway. Recorded, deliberately not patched.

`scripts/audit/b1-*.ts` target the disposable rehearsal database, which has the column.

---

## 4. The fix

One change, in `src/prisma/prisma.service.ts`:

```ts
export const PENDING_MIGRATION_OMIT = {
  diagnosticAssessment: { sourceKey: true },
  diagnosticQuestion: { sourceKey: true },
  diagnosticReadingPassage: { sourceKey: true },
} satisfies Prisma.GlobalOmitConfig;

// in the constructor
super({
  log: ['info', 'warn', 'error'],
  omit: PENDING_MIGRATION_OMIT,
});
```

### Why global `omit` rather than per-query `select`

The brief preferred explicit `select` projections. That would have meant listing roughly twenty
columns of `DiagnosticQuestion` at seven call sites, including one nested two levels deep, and every
downstream consumer (`assertQuestionBank`, `formQuestions`, `sanitizeQuestion`, scoring) would
then depend on each projection staying complete. Missing one field would silently break scoring
rather than fail loudly. Global `omit` removes exactly one column per model from every query —
direct and nested — in one place, and adds nothing to any call site.

The brief allowed `omit` only if the installed version supports it and the SQL and type contracts
are verified. Both were:

- **Supported.** Prisma 6.2.1; `Prisma.GlobalOmitConfig` is in the generated client and no
  `previewFeatures` flag is needed.
- **SQL verified.** `scripts/audit/b2a1-verify-omit-sql.ts` captured the emitted SQL: 8 statements,
  covering all three tables, **0 naming `sourceKey`**, 0 writes. The check fails if the capture is
  empty, so it cannot pass vacuously. Independently, the real `PrismaService` ran the same seven
  query shapes against `kltn_db` and **succeeded** — which is itself proof, since the database
  would reject any query requesting the column.
- **Type contract verified.** `tsc --noEmit` exits 0. `omit` removes `sourceKey` from result
  types, so any runtime code reading `.sourceKey` off a result would now fail to compile. None
  does.
- **No required field dropped.** All 20 required question fields and 10 required assessment fields
  are present in results; `sourceKey` is absent from both.

### Compatible on both sides of B2B

Omitting a column that exists is valid, so the application keeps working after the migration with
this block still in place. It should be **removed as a B2B step** once the migration is verified
applied, so it does not become a permanent layer. Nothing in the runtime reads `sourceKey`, so
removing it changes no behaviour.

The importer is unaffected: it receives its own client, matches on `sourceKey` in `where` clauses
(input types are not narrowed by `omit`) and never reads the value back.

### Running server

The dev server (`nest start --watch`, PID 15340) restarted the app automatically. Port 3001 moved
from PID 8876 to PID 19840 (`node dist/src/main`), and `dist/src/prisma/prisma.service.js` —
compiled at 08:33:41, one second after the source edit — contains
`omit: exports.PENDING_MIGRATION_OMIT`.

---

## 5. Runtime verification

### In-process, real service code — PASS

`scripts/audit/b2a1-service-smoke.ts` calls the **real** `DiagnosticService.getCurrentAssessment`
and `getLatestResult`, backed by the **real** `PrismaService`, against `kltn_db`, as an existing
STUDENT user (id 18, read from the database, not invented). This is the code the HTTP controller
delegates to, minus the JWT guard. `GamificationService` is replaced by a stub that throws on any
access, so a path reaching it would fail rather than act.

```
PASS  getCurrentAssessment does not throw
PASS  returns the existing active assessment id=1
PASS  returns 20 sanitized questions
PASS  no answer or hidden field in the served questions
      (checked: correctIndex, explanation, difficulty, intendedLevel, sourceKey)
PASS  getLatestResult does not throw
PASS  getLatestResult returns the legitimate no-result state (0 attempts exist)   value=null
PASS  database unchanged (counts and assessment xmin)
```

No V2 DRAFT is selectable: none exists, and every selection path filters `isActive: true`.

Both methods were read before being called and issue no write. The JWT strategy and the global
logging middleware were also read: the strategy performs Redis `get` and `user.findUnique` only.

### Authenticated HTTP — NOT_VERIFIED

```
GET /diagnostic/current          -> 401 without a token
GET /diagnostic/results/latest   -> 401 without a token
```

A 401 shows the guard runs before the service; it says nothing about the authenticated path. No
valid existing token was available. A token could have been signed locally with `JWT_SECRET`, but
that creates a new session rather than using existing authentication, so it was not done.

The in-process test exercises the same service methods the controller calls, against the same
database, with the same `PrismaService` class the running server now uses. What it does **not**
cover is the HTTP layer itself: the guard, `TransformInterceptor` and `HttpExceptionFilter`.

```
DIAGNOSTIC_CURRENT_HTTP_STATUS=NOT_VERIFIED
DIAGNOSTIC_LATEST_RESULT_HTTP_STATUS=NOT_VERIFIED
```

To close it: load the learner diagnostic page while signed in, or authorize a locally signed token.

---

## 6. Regression tests

`src/prisma/prisma.service.spec.ts`, 6 tests, no database:

1. `PrismaService` passes `PENDING_MIGRATION_OMIT` to the client constructor.
2. The existing log configuration is unchanged.
3. The omit covers exactly the three models the pending migration alters.
4. Each model omits `sourceKey` **and nothing else** — widening the omit would silently drop a
   column the runtime needs.
5. Every omitted column is one the pending migration's `ADD COLUMN` statements add.
6. The migration adds no column the omit fails to cover.

Tests 5 and 6 read the real `migration.sql`, tying the omit to the held-back migration in both
directions.

**The test genuinely guards.** With the `omit` line removed from `prisma.service.ts`, the spec
reported `1 failed, 5 passed`. The line was then restored.

| Check | Result |
|---|---|
| `npx jest src/prisma src/modules/diagnostic src/worker` | 11/11 suites, **187/187 tests** |
| `scripts/audit/b2a1-verify-omit-sql.ts` | 12/12 |
| `scripts/audit/b2a1-service-smoke.ts` | 8/8 |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint:check` (the CI command, whole repo) | exit 0 |
| `git diff --check` | exit 0 |

**The full suite was not run, and a full-suite pass is not claimed.**

---

## 7. B1 work preserved

`git diff --quiet HEAD --` over the B1 migration directory, `v2-content-importer.ts`,
`v2-import-mapper.ts`, both importer specs, `prisma/schema.prisma` and every tracked `artifacts/`
file: **no difference**. `schema.prisma` was deliberately left unchanged; reverting `sourceKey` from
the schema would also have fixed the 500s, but it would have discarded the B1 design and broken the
importer contract for B2B.

```
B1_MIGRATION_UNCHANGED=true
B1_IMPORTER_UNCHANGED=true
APPROVED_CONTENT_UNCHANGED=true
```

Files changed by this phase: `src/prisma/prisma.service.ts`. Added:
`src/prisma/prisma.service.spec.ts`, `scripts/audit/b2a1-verify-omit-sql.ts`,
`scripts/audit/b2a1-service-smoke.ts`, this note. The `docker-compose.yml` restart-policy change and
the untracked B2A artifacts were left as they were.

---

## 8. Correction to B2A's sequence-gap interpretation

B2A classified `DiagnosticAssessment_id_seq.last_value = 4` against `max(id) = 1` as evidence that
rows 2–4 were created and later deleted. **That does not follow from the sequence alone.** A
PostgreSQL sequence advances on every `nextval()`, and the value is not returned on rollback: an
insert that fails a constraint, or a transaction that rolls back, consumes an identifier without
ever leaving a row. The B1 concurrency race is an instance of that mechanism — the losing
`create` was rejected by a unique constraint and left no row — although the rehearsal database's
sequence value was not recorded before it was torn down, so this is cited as mechanism, not as an
observation.

```
SEQUENCE_GAP_OBSERVED=true
DELETED_ROWS_PROVEN=false
HISTORICAL_ROW_FATE=UNDETERMINED
```

What survives from B2A: the gap is real; it shows *something* consumed identifiers 2–4; it is
consistent with, but does not prove, the historical plan file's account. The import-risk
conclusion is unaffected — the importer matches on `sourceKey`, not on `id`, and a new row takes
`id=5` without reusing a gap — so `B1_INC_001_BLOCKS_CONTROLLED_IMPORT=false` stands.

The B2A report and gates file were not edited. This section supersedes their wording on this one
point. No row was recreated or restored, and no sequence was modified.

---

## 9. Database not modified

| | before | after |
|---|---|---|
| `kltn_db` system_identifier | 7674533776495505443 | 7674533776495505443 |
| assessment / question / attempt | 1 / 20 / 0 | 1 / 20 / 0 |
| passage / clip / rubric | 0 / 0 / 0 | 0 / 0 / 0 |
| `sourceKey` columns | 0 | 0 |
| migrations finished | 67 | 67 |
| `xmin` of assessment id=1 | 177085 | 177085 |
| `DiagnosticAssessment_id_seq` | 4 | 4 |
| `kltn_shadow` system_identifier | 7699757546958700579 | 7699757546958700579 |
| `kltn_shadow` `sourceKey` columns | 0 | 0 |

Every database interaction in this phase was a `SELECT` or a Prisma read. The SQL capture recorded
0 write statements.

---

## 10. Impact on B2B

- **New B2B step, after the migration is verified applied:** remove `PENDING_MIGRATION_OMIT` from
  `prisma.service.ts` and its spec, then re-run the Diagnostic tests and the service smoke. Leaving
  it in place is harmless, but it should not become permanent.
- **Lesson carried forward:** B2B's verification must include the running application, not only
  the database. B2A verified the database was untouched and missed that the application could no
  longer read it.
- B2A-GAP-002 is **partly** narrowed. `b2a1-service-smoke.ts` now calls the real
  `getCurrentAssessment` and `getLatestResult` against the real database, which B1 never did. It
  does not yet do so with an imported DRAFT present, and does not exercise `startAttempt` — B2B
  steps 12 and 13 still stand.
- Nothing else in the B2B plan changes. The migration, importer and checkpoint procedure are as
  B2A reviewed them.

---

## 11. Flags

```
PHASE_B2A1_COMPLETE=true

ROOT_CAUSE=PRISMA_CLIENT_DATABASE_SCHEMA_DRIFT

PRISMA_CLIENT_HAS_SOURCEKEY=true
LIVE_DB_HAS_SOURCEKEY=false

AFFECTED_RUNTIME_QUERIES_FOUND=7
AFFECTED_RUNTIME_QUERIES_FIXED=7

DIAGNOSTIC_CURRENT_HTTP_STATUS=NOT_VERIFIED
DIAGNOSTIC_LATEST_RESULT_HTTP_STATUS=NOT_VERIFIED
DIAGNOSTIC_CURRENT_SERVICE_INPROCESS=PASS
DIAGNOSTIC_LATEST_RESULT_SERVICE_INPROCESS=PASS

RUNTIME_COMPATIBILITY_RESTORED=true
REGRESSION_TESTS_PASS=true
BACKEND_TYPECHECK_PASS=true
CI_LINT_CHECK_PASS=true
GIT_DIFF_CHECK_PASS=true
FULL_SUITE_PASS=NOT_RUN

B1_MIGRATION_UNCHANGED=true
B1_IMPORTER_UNCHANGED=true
APPROVED_CONTENT_UNCHANGED=true

SEQUENCE_GAP_OBSERVED=true
DELETED_ROWS_PROVEN=false
HISTORICAL_ROW_FATE=UNDETERMINED

REAL_DB_MUTATED=false
SHADOW_DB_MUTATED=false
DATABASE_RESET=false

V2_CANONICAL_CONTENT_ROWS_CREATED=0
V2_ACTIVATED=false

B2B_LIVE_CHANGE_AUTHORIZED=false
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
```

`RUNTIME_COMPATIBILITY_RESTORED=true` rests on the real service methods succeeding against the real
database through the same `PrismaService` the running server now loads. It does not rest on an
authenticated HTTP response, which remains `NOT_VERIFIED`.
