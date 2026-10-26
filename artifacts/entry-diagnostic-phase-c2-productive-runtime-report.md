# Phase C2 — Productive Skill Runtime Completion

**Date:** 2026-10-26
**Outcome:** the Speaking and Writing pipelines now enforce task-specific limits from server data,
grade against the approved rubrics through a validated output contract, survive duplicate, stale and
failed jobs, and never report pending or failed grading as a score. Proven with mocked graders over a
real queue, real audio decoding and real HTTP in a disposable environment. No database was mutated.

> **Independence caveat.** Implemented and verified by the same author. Self-verification.

Evidence: `entry-diagnostic-phase-c2-evidence.json`, `c2-isolated-e2e.log`,
`c2-codec-overhead.log`, snapshots in `c2-evidence/`.

---

## 1. Inspected and reused

**Kept as-is because it was correct:** ownership checks; the `IN_PROGRESS` precondition; the Speaking
job's stale protection keyed on `audioKey` + status; storage keys never returned to learners;
owner-only signed audio URLs; skip without a score; the audio normalizer; the BullMQ queues; and the
`DiagnosticWritingResponse` table, which already existed from migration `20261025054012` and was
unused. **No migration was needed.**

**Defects found:**

| | Defect |
|---|---|
| Speaking | duration came from the **client** and was checked against a global 300 ms – 90 s, never against the audio or the task |
| Speaking | graded with Azure **scripted** pronunciation, `ReferenceText` = the task prompt, `EnableMiscue` on — it scored whether the learner read the prompt aloud; the rubric was never used |
| Speaking | a malformed provider score became `NaN` and was stored as `GRADED` |
| Speaking | a slow upload could land after final submission |
| Speaking | a crashed or stalled job left the row in `GRADING` forever; no retry after completion |
| Writing | results kept as an unlocked read-modify-write of `attempt.answers` JSON — lost updates possible |
| Writing | no run identity: older jobs could overwrite a retried task; retry of a `QUEUED`/`GRADED` task queued a duplicate |
| Writing | every task graded with `evaluateWritingPart3`, a fixed TOEIC 0–5 rubric |
| Writing | empty provider feedback replaced with a stock sentence and marked `GRADED` |
| Writing | no test existed |

**New finding, C2-FIND-001:** assessment id=5 is persisted with `contentVersion = 1`, not 6. The importer
never writes that field. Not corrected — no database write is authorized in C2.

---

## 2. Source changes

| File | Change |
|---|---|
| `diagnostic-productive.ts` (new) | pure rules: duration policy, word count, rubric parsing, grader output validation, grade-with-retry |
| `diagnostic-rubric-grader.ts` (new) | grader seam: mock grader, model grader (Writing prompt; Speaking fails closed) |
| `diagnostic-speaking.service.ts` | decoded duration per task; lock + status re-check; rubric grading; retry; stall handling |
| `diagnostic-writing.service.ts` | moved to `DiagnosticWritingResponse`; run-versioned claims; rubric grading; retry preconditions; stall handling |
| `diagnostic.service.ts` | queue Writing via the new service; results read the table (legacy JSON fallback) |
| `diagnostic.controller.ts` | `POST :id/attempts/:attemptId/speaking/:questionId/retry` |
| `diagnostic.module.ts` | provides `DIAGNOSTIC_RUBRIC_GRADER` |

No change to schema, migration, importer, approved content, Docker, the objective grader or the
frontend.

---

## 3. Speaking duration and recording contract

The limit is the task row's **`responseSeconds`** (45 s and 60 s), server-owned. `prepSeconds` is
thinking time and is never added. The duration judged is the one **decoded from the audio** by the
normalizer; the client's figure is only cross-checked, so it can neither extend the limit nor replace
the measurement.

**Tolerance, derived rather than guessed.** Exact-length tones were encoded in every accepted
container and decoded by the real normalizer: Opus and WAV drift **0 ms**, AAC at most **+13 ms**.

| Allowance | Value | Basis |
|---|---|---|
| codec | 50 ms | measured worst 13 ms |
| browser stop | 500 ms | **assumption, not measured** — confirm in browser E2E |
| client mismatch | 1,500 ms | timer granularity; beyond this is a contradiction |

Effective maxima: 45,550 ms and 60,550 ms. A task without `responseSeconds` is refused rather than given
a generic limit.

**Lifecycle.** Confirm is allowed only while the attempt is `IN_PROGRESS`. It is serialized per task by
an advisory lock, and the status is re-read under the lock, so a recording that finishes uploading after
submission is refused and its object deleted. A re-recording replaces the response, deletes the old
object, and makes the old job stale.

---

## 4. Writing validation and submission contract

**The word range is not a submission gate, and must not be.** The approved rubric's
`wordCountHandling`: *"Length below the stated minimum is reflected in task_achievement, not applied as a
separate automatic penalty, and only below two thirds of the stated minimum."* Rejecting a 59-word answer
would contradict approved content. The server therefore computes the word count, stores it, and passes
`wordMin`, `wordMax`, `belowMinimum`, `belowTwoThirdsMinimum` and `aboveMaximum` to the grader.
`WRITING_TASK_BOUNDS_ENFORCED=true` means exactly this.

Word count uses the learner page's own convention, so server and client always agree:
`value.trim() ? value.trim().split(/\s+/u).length : 0`. Text stays 2–2,000 characters, trimmed, never
truncated.

One `DiagnosticWritingResponse` row per (attempt, task), created once when the attempt completes. A
replayed or concurrent completion creates and queues nothing more.

---

## 5. Grading worker and rubric contract

Each task is graded with **its own rubric** (`SPK_RUBRIC_V3`, `WRT_RUBRIC_V3`). The worker refuses a
missing rubric or one of the wrong skill.

`validateRubricGrade` implements the approved `aiGradingRequirements`: every criterion present, an
**integer within 0–4**, no unknown criterion, non-empty feedback, malformed JSON rejected, and the output
must name **this** submission. Invalid output is retried once, then the task is `GRADING_FAILED`. The
grader returns raw output and never validates itself, so a misbehaving grader cannot produce a score.
Task score = mean criterion score as a percentage of the range, stored unrounded; skill aggregation is
left to the scorer phase.

| Grader | Behaviour |
|---|---|
| mock | tests, `DIAGNOSTIC_GRADER_MODE=mock`, or `MOCK_AZURE_SPEECH` / `NODE_ENV=test`; says nothing about quality |
| model — Writing | rubric-structured JSON prompt via `AiService.chat`; **not run against the real provider** |
| model — Speaking | **fails closed** with `SPEAKING_RUBRIC_GRADER_NOT_CONFIGURED` |

Speaking fails closed because the rubric needs what the learner *said*, and the only speech call in the
codebase is scripted pronunciation against a reference text. Failing closed leaves the task
`GRADING_FAILED` and retryable instead of storing a meaningless score. The development environment has no
mock flag set, so this is the running app's behaviour today. No learner can reach these tasks: id=5 is a
DRAFT, and the ACTIVE form has no productive tasks.

---

## 6. State transitions

**Speaking:** any → `QUEUED` on confirm while `IN_PROGRESS` · `QUEUED` → `GRADING` by the job owning
this `audioKey` · `GRADING` → `GRADED` | `GRADING_FAILED`, conditional on the same `audioKey` ·
`GRADING_FAILED` → `QUEUED` by the owner's retry, also after completion · `QUEUED`/`GRADING` →
`GRADING_FAILED` when BullMQ reports the job failed or stalled, for the same `audioKey` only.

**Writing:** none → `QUEUED` once per task at completion, run 1 · `QUEUED` → `GRADING` by the job owning
this run · `GRADING` → `GRADED` | `GRADING_FAILED`, conditional on the run · `GRADING_FAILED` → `QUEUED`
by the owner's retry with the run incremented · stall → `GRADING_FAILED`, same run only.

**Results:** `speakingScore` comes from `GRADED` rows only and is null otherwise; a Writing score is null
unless `GRADED`; `productivePending` covers only `QUEUED`/`GRADING`; `GRADING_FAILED` is reported as
failed, never as 0.

---

## 7. Retry, duplicate and stale results

Asserted in the unit specs against a store that applies the same conditional `where` semantics as the
database:

- a late job for a replaced recording grades nothing; the newer recording grades normally
- the same job delivered twice grades once
- a skipped task's queued job goes stale
- invalid output → one retry → `GRADING_FAILED`, no score; output for a different submission rejected
- a transient provider error recovers on the second call; a permanent one fails with its reason; an
  unavailable grader is not retried
- two concurrent retries queue exactly one run; retry refused while queued or graded
- a stale run from before a retry cannot claim or overwrite it
- a stalled run becomes `GRADING_FAILED` and retryable; an older stalled run cannot fail a newer one

**Mutation checks:** removing the run condition from the Writing claim made 1 of 18 fail; replacing the
per-task limit with the generic 90 s made 5 of 56 fail.

---

## 8. Isolated integration — 44/44

Disposable PostgreSQL 15 clone (checkpoint restore + migration + import) and disposable Redis on 6390.
**Redis 6379 is refused**, because the running application's workers listen there on the same queue
names and would have picked up test jobs.

**Real:** controller over HTTP (supertest), all three services, BullMQ queues and workers, the normalizer
with ffmpeg on encoded audio, Prisma. **Fake:** storage (in memory, nothing sent to R2), grader,
gamification, and auth — a guard inside the testing module. No JWT was created; the running app was never
contacted.

A synthetic runnable form was built, in the clone only, from the approved DRAFT Speaking and Writing rows
plus two objective items.

Highlights:
- real 50 s audio refused on the 45 s task, even when it claims 44 s; real 44.5 s accepted; the decoded
  duration is stored
- both Speaking tasks `GRADED` through the real queue, with rubric version, criteria and feedback
- the objective grade on the same submission is still correct
- Writing pending → provider outage → `GRADING_FAILED` (null, not pending) → concurrent retries: one
  202, one 409 → `GRADED` with `WRT_RUBRIC_V3` criteria, word counts 70 and 100 computed server-side
- a replayed submission rewrote nothing; a recording after submission was refused
- Speaking outage → `GRADING_FAILED` → owner retry → `GRADED`
- DRAFT start and submit refused over HTTP

**One assertion was corrected.** The run expected the first task-2 recording never to be graded. It was:
the worker finished before the re-recording arrived. That is legitimate — stale protection stops an old
job overwriting a newer recording; it does not stop an old recording being graded first — and the
persisted row was the re-recording. The assertion now states only what can be claimed; the late-stale
case is asserted deterministically in the unit spec.

```
SERVICE_INTEGRATION_PASS
ISOLATED_HTTP_E2E_PASS
REAL_PROVIDER_E2E_NOT_RUN
REAL_BROWSER_E2E_NOT_RUN
```

---

## 9. Security

Covered: another learner's attempt, audio, writing retry and speaking retry; wrong assessment; wrong
question; wrong task type; stale recording; duplicate delivery; duplicate and concurrent retry; replayed
submission; recording after submission; malformed provider output; output for a different submission;
unauthenticated request. Ownership is always the authenticated user against persisted attempt and response
rows. Storage keys never appear in a learner payload.

---

## 10. Regression

| | Result |
|---|---|
| Full backend suite | **146/146 suites, 1,391/1,391** |
| Focused (diagnostic, worker, prisma) | 13/13, 288/288 |
| New specs | productive 22, Writing 18, Speaking 34 (rewritten) |
| C1 grader-integrity spec | unchanged, passing |
| `tsc` / `lint:check` / `git diff --check` | 0 / 0 / 0 |

The 6 replaced Speaking tests asserted the scripted-pronunciation path.

---

## 11. Database invariants

- **`kltn_db`:** 0 of 136 tables changed since the B2B end snapshot.
- **`kltn_shadow`:** 0 tables changed.
- Live read-only checks re-run with the C2 code: 0 failures.
- Disposable containers removed; dangling volumes 26 before and after.
- Content hashes match; migration, importer, mapper and schema equal HEAD.
- The dev server reloaded the C2 code, still answers 401 unauthenticated, and was used by no test.

Correction to C1: its live read-only script has 8 checks, not 9 as reported. Still 0 failures.

---

## 12. Remaining gaps

1. **Speaking real grading** — an unscripted speech grader producing a transcript and rubric scores.
   Until then Speaking fails closed outside mock mode.
2. **Writing real grading** — run the prompt against the provider and review output quality.
3. **C2-FIND-001** — id=5 `contentVersion = 1`; one authorized row update plus an importer fix.
4. **Frontend** — the page shows the Writing score as `/5`; it is now 0–100 (`scoreScale: PERCENT_0_100`).
   It also needs per-task recording limits, the new error messages, Speaking retry, and criteria display.
5. **Browser** — measure the MediaRecorder stop allowance; run a real browser E2E.
6. **Scorer phase** — the rubric requires both tasks `GRADED` before a skill score; results currently
   average whatever is graded. Also `FOUR_SKILL_PLACEMENT_V2`, **DEF-004**.
7. Listening audio; activation.

The UI phase must discover the skills actually installed, read them, reuse existing components, and test
the real interface on desktop and mobile.

---

## 13. Flags

```
PHASE_C2_COMPLETE=true

SPEAKING_PER_TASK_DURATION_ENFORCED=true
SPEAKING_RECORDING_OWNERSHIP_PASS=true
SPEAKING_RECORDING_LIFECYCLE_PASS=true
SPEAKING_NORMALIZATION_VERIFIED=REAL_LOCAL_TRANSCODE_PASS

WRITING_SERVICE_UNIT_TESTS_PASS=true
WRITING_TASK_BOUNDS_ENFORCED=true
WRITING_SUBMISSION_OWNERSHIP_PASS=true

SPEAKING_ASYNC_GRADING_INTEGRATION_PASS=true
WRITING_ASYNC_GRADING_INTEGRATION_PASS=true

DUPLICATE_GRADING_PREVENTED=true
STALE_GRADING_RESULT_PREVENTED=true
GRADING_FAILURE_RECOVERABLE=true

PRODUCTIVE_RESULT_PERSISTENCE_PASS=true
PENDING_GRADING_NOT_TREATED_AS_ZERO=true
FAILED_GRADING_NOT_TREATED_AS_ZERO=true

ISOLATED_SERVICE_INTEGRATION_PASS=true
ISOLATED_HTTP_E2E_PASS=true
REAL_PROVIDER_GRADING_VERIFIED=false
REAL_BROWSER_E2E_VERIFIED=false

C1_OBJECTIVE_GRADING_REGRESSION_PASS=true
DRAFT_ISOLATION_PRESERVED=true

BACKEND_TYPECHECK_PASS=true
DIAGNOSTIC_TARGETED_TESTS_PASS=true
FULL_BACKEND_TEST_SUITE_RESULT=146/146 suites, 1391/1391 tests
CI_LINT_CHECK_PASS=true
GIT_DIFF_CHECK_PASS=true

REAL_DB_MUTATED=false
SHADOW_DB_MUTATED=false
REAL_DATABASE_RESET=false

CONTENT_VERSION=6
CONTENT_FILES_UNCHANGED=true
V2_ACTIVATED=false

AZURE_SPEECH_CALL_COUNT=0
GEMINI_GRADING_CALL_COUNT=0
TTS_CALL_COUNT=0
R2_DIAGNOSTIC_MEDIA_CREATED=0

DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN
FINAL_V2_PLACEMENT_SCORER_IMPLEMENTED=false

PHASE_C2_VERDICT=PRODUCTIVE_RUNTIME_PASS
```

`CONTENT_VERSION=6` is the approved package. The persisted row says 1 — C2-FIND-001.
