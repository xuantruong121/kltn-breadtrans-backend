# Phase C1 — Four-Skill Runtime Foundation & Objective Grading Correctness

**Date:** 2026-10-26
**Outcome:** a critical grading defect that mis-scored every learner's first attempt is fixed and
proven fixed; validation is task-type aware and split into content, runtime and activation layers;
the learner payload now carries what Speaking and Writing tasks need. No database was mutated.

> **Independence caveat.** Implemented and verified by the same author. Self-verification.

Machine-readable evidence: `entry-diagnostic-phase-c1-evidence.json`. Logs:
`c1-isolated-runtime.log`, `c1-live-readonly.log`, snapshots in `c1-evidence/`.

---

## 1. Baseline and process safety

`kltn_db` read-only: `sysid 7674533776495505443`, 68 migrations; id=1 `ACTIVE` with 20 questions,
id=5 `DRAFT` inactive with 29; 0 attempts; 3 passages, 10 clip registrations, 2 rubrics — the
B2B state exactly.

**Launcher identified.** One backend instance on port 3001, started from the Antigravity IDE's
integrated terminal: `npm run start:dev` → `nest start --watch` → **`cmd.exe /d /s /c node …`** →
the app. No VS Code tasks, no pm2/nodemon/forever. Because `nest --watch` starts the app through an
intermediate `cmd.exe`, ending `nest` does not necessarily end the app — a plausible, **not proven**,
explanation for the orphan seen in B2B.

The dev server reloads every source edit and is connected to `kltn_db`, so it now runs the C1 code.
No C1 test targeted it.

---

## 2. Current-state matrix

| Feature | Source | Reusable as-is | Missing | Change | Evidence |
|---|---|---|---|---|---|
| Assessment selection | 4 service paths, all `isActive: true` | yes | — | none | isolated + live |
| Objective grading | `isDiagnosticAnswerCorrect`, 6 call sites | **no** | server-authoritative permutation; fail-closed index | rewritten | old-code repro 6/20 vs 13/20 |
| Validation | `validateQuestionBank` | **no** | task types; demanded CEFR; mixed content and audio | layered | unit + live readiness |
| Serializer | `sanitizeQuestion` | partly | task type, limits, word bounds, audio state | additive fields | real serializer, 49 rows |
| Speaking runtime | `DiagnosticSpeakingService`, normalizer | yes | per-task response time | none | 7 unit tests pass |
| Writing runtime | `DiagnosticWritingService` | yes | **no unit tests exist** | none | code read only |

---

## 3. C1-DEF-001 — every first attempt was graded against the wrong options (CRITICAL)

The real learner page does this:

1. fetches the form before any attempt exists — `getCurrentAssessment` serves options in **authored
   order**, because `activeAttemptId` is undefined;
2. on Start, creates attempt N and **does not refetch** the form;
3. records the **displayed** index the learner clicks;
4. submits with attempt N — and the server graded `getAttemptQuestionPermutation(N, …)[clicked]`,
   a permutation the learner never saw.

**Reproduced with the actual pre-C1 code** (HEAD `0adb882`, run from a detached git worktree) on a
disposable clone. Same flow, 13 answers intended correct:

| Code | Stored grade |
|---|---|
| before C1 | **6 / 20** |
| after C1 | **13 / 20** |

### Further defects in the same path

- With no permutation, or with an out-of-range index (`permutation[answer]` undefined), the grader
  compared the displayed index **directly with the authored key** — fail open.
- Submitting without `attemptId` **created a new COMPLETED attempt** graded with no permutation:
  it bypassed the no-retake rule and orphaned the in-progress attempt.
- `toResult` guessed the permutation with `attempt.id >= 50`, so such an attempt was then shown with
  a different grade from the one stored.
- `toResult` also called `weightedCore(questions, answers, attempt.id)` — a **sixth**, attempt-seeded
  grading path. Earlier audits listed five call sites.
- A client-supplied `{ originalIndex }` was accepted as the authored option identity.

### Correction

**Seed the display permutation by learner, not by attempt.**
`getLearnerQuestionPermutation(userId, assessmentId, questionId, optionCount)`. `userId` is the
authenticated JWT subject, so no client value enters the seed. The order is now identical before
Start, after Start, on resume and on review — which makes the existing page correct **without a
frontend change**, rather than depending on the client to remember to refetch. Still deterministic;
no new table.

**A grader that cannot guess.** `resolveAuthoredOptionIndex` returns the authored index or `null`:
a displayed index needs a valid permutation of exactly the option count and an in-range integer;
option text resolves only when exactly one option matches; `originalIndex` is refused.

**An authoritative attempt.** `submitAssessment` now requires `attemptId`, and requires it to belong
to the caller and to this assessment. A `COMPLETED` attempt returns its recorded result without being
graded again; any status other than `IN_PROGRESS` is refused; an attempt is never created on submit.
Every objective answer must resolve before the transaction opens.

**One completion.** An advisory lock on the attempt id and a status re-read under it: a racing
duplicate returns the completed attempt instead of grading and rewarding twice.

**A recorded scheme.** `answers.__permScheme = LEARNER_ASSESSMENT_V1`. `toResult` re-derives exactly
the permutation the grade used. An attempt stored by the old code (`__permAttemptId`) keeps its own
scheme; an attempt with neither yields unresolvable index answers rather than a guess.

| Call site | Before | After |
|---|---|---|
| `buildSkillProfiles` | attempt-seeded map | map from the recorded scheme |
| `toResult` per question | `__permAttemptId` or `id >= 50` guess | recorded scheme |
| `toResult` → `weightedCore` | seeded by `attempt.id` | same map as the rest of `toResult` |
| `submitAssessment` per question | optional client `attemptId`, else direct compare | learner permutation |
| `sectionPercentage` | optional client `attemptId` | permutation map |
| `bandPercentages` | optional client `attemptId` | permutation map |

---

## 4. Task-type-aware validation

**Before:** one validator demanded `intendedLevel` — a CEFR label — on every productive task, treated
missing Listening audio as a content defect, and checked no passage, rubric, recording or word limit.

**After:**

- `classifyDiagnosticTask` reads the `taskType` column first; legacy rows fall back to
  `options.questionType`; a contradiction is `INCONSISTENT`.
- `validateDiagnosticContent` — structural validity:
  - objective: prompt, ≥ 2 unique options, valid key; Listening needs a clip association; Reading
    needs passage text and a passage reference;
  - Speaking: no options, a rubric, positive prep and response seconds;
  - Writing: no options, a rubric, positive `wordMin < wordMax`;
  - **never required of productive tasks:** options, an answer key, `correctIndex = -1`, CEFR.
- `validateRuntimeReadiness` — Listening needs a real `audioUrl`.
- `validateQuestionBank` — content **and** runtime; still the gate every learner path enforces, so
  no readiness check was weakened to let the DRAFT through.
- `evaluateAssessmentReadiness` — content, runtime, and activation, which also requires a scorer
  this build implements.

On the real database:

```
id=1 ACTIVE  content=true  runtime=true       activation=true
id=5 DRAFT   content=true  runtime=false (10) activation=false
             blockers: runtime: 10 defect(s)
                       FOUR_SKILL_PLACEMENT_V2 is known but its scorer is not implemented
```

The DRAFT is structurally valid and correctly not runnable.

---

## 5. Learner delivery contract

Additive fields on every question: `taskType`, `instructions`, `prepSeconds`, `responseSeconds`,
`wordMin`, `wordMax`, `mediaStatus`, `productive`.

| Task | Verified on the 29 DRAFT rows through the real serializer |
|---|---|
| Listening | `audioUrl` kept; `mediaStatus` is `READY` only with a real URL. 10/10 `NOT_READY`, `audioUrl: null` — never presented as playable |
| Reading | 10/10 serve the complete authored passage under its heading |
| Speaking | 2/2 serve prompt, `prepSeconds`, `responseSeconds`, no options |
| Writing | 2/2 serve prompt, `wordMin`, `wordMax`, no options |

No payload contained `correctIndex`, `explanation`, `answerRationale`, `distractorRationales`,
`internalLabel`, `sourceKey`, `stableKey`, `difficulty`, `intendedLevel`, `rubricId`, `passageId`,
`script` or `transcript`.

The learner page reads only `section` among these fields today; the rest wait for the UI phase.
**The HTTP layer itself was not exercised.**

---

## 6. Tests

| | Result |
|---|---|
| New `diagnostic.grading-integrity.spec.ts` | **39/39** |
| — mutation check | restoring the old fail-open fallback made **3 fail**; restored, 39/39 |
| Rewritten tautology (`v2-import-mapper.spec.ts`) | real grader on all 25 approved items × 24 orderings × 4 clicks = 2,400 verdicts |
| Focused: diagnostic, worker, prisma | 11/11 suites, **220/220** |
| **Full backend suite** | **144/144 suites, 1,323/1,323** |
| Isolated clone, real service | **34/34** |
| Live `kltn_db`, read-only session | **9/9** |
| `tsc` / `lint:check` / `git diff --check` | 0 / 0 / 0 |

The 39 new tests cover every case the brief listed: correct and incorrect clicks; all 24 orderings
for every key position; 40 question ids × 3 learners × 2 assessments; missing, invalid and
out-of-range permutation state; another learner's attempt; another assessment; an unknown status; a
missing attempt; an invalid option index; a replay; a racing duplicate; legacy-scheme and no-scheme
attempts.

Four existing specs were adapted because they asserted the defective behaviour — submitting without an
attempt, clicking without a permutation, or declaring `originalIndex`. Each test keeps its original
purpose.

### On the isolated clone, with the real service

- option order identical before and after Start; 19/20 items actually reordered
- stored grade equals what was clicked, 13/20; every per-question verdict and `selectedText` right;
  `getLatestResult` reproduces it
- refused, writing nothing: no attempt id, another learner's attempt, the DRAFT, an out-of-range
  index, a non-existent attempt
- a replayed all-correct submission left the grade at 13 and rewrote nothing (`xmin` unchanged)
- Start after completion returns the completed attempt
- two concurrent submits completed the attempt once: one learning activity, reward at most once
- DRAFT start and submit refused; 0 attempts on it; lifecycle id=1 `ACTIVE`, id=5 `DRAFT` unchanged

---

## 7. Speaking and Writing reuse

| | Code present | Unit tests | Isolated runtime | End to end |
|---|---|---|---|---|
| Speaking | yes | pass (6 + 1) | NOT_VERIFIED | no |
| Writing | yes | **none exist** | NOT_VERIFIED | no |

Both services check ownership correctly: the attempt must be the caller's, on the assessment; Speaking
also requires `IN_PROGRESS`; audio retrieval checks response ownership. Nothing was rewritten.

Gaps for the productive phase: Speaking bounds every recording at a global 300 ms – 90 s rather than the
task's `responseSeconds` (45 s / 60 s); the Writing service has no unit tests; neither provider was
exercised.

---

## 8. Database evidence

- **`kltn_db`:** 0 of 136 tables changed since the B2B end snapshot.
- **`kltn_shadow`:** 0 tables changed.
- The live checks ran under `default_transaction_read_only=on`; a locking read was refused with `25006`.
- Every write ran on the disposable clone (`sysid 7700804571409465384`), which was then removed; the
  dangling-volume count returned to its baseline of 26. The old-code worktree was removed.
- Content hashes match (`HASH_MISMATCH_COUNT=0`). Migration, importer, mapper and schema equal HEAD.

---

## 9. Remaining blockers

1. Listening audio — 10 items `NOT_READY`.
2. `FOUR_SKILL_PLACEMENT_V2` scorer — not implemented; **DEF-004 open** and still blocking it.
3. Speaking per-task response time; productive runtime end to end.
4. Writing service tests; AI grading.
5. Frontend use of the new delivery fields.
6. Authenticated HTTP smoke.

**Recommended next phase:** productive runtime — Speaking duration per task, Writing service tests,
isolated end-to-end runs of both pipelines with providers mocked — followed by Listening audio
production. Decide DEF-004 before any final scorer work.

---

## 10. Flags

```
PHASE_C1_COMPLETE=true

TASK_TYPE_VALIDATION_IMPLEMENTED=true
PRODUCTIVE_TASK_VALIDATION_PASS=true
CONTENT_READINESS_SEPARATION_PASS=true

LISTENING_DELIVERY_CONTRACT_PASS=true
READING_DELIVERY_CONTRACT_PASS=true
SPEAKING_DELIVERY_CONTRACT_PASS=true
WRITING_DELIVERY_CONTRACT_PASS=true

LEARNER_PAYLOAD_CONFIDENTIALITY_PASS=true

OBJECTIVE_GRADING_CALL_SITES_VERIFIED=true
PERMUTATION_FAIL_OPEN_CLOSED=true
ACTUAL_GRADER_PERMUTATION_TEST_PASS=true
ATTEMPT_OWNERSHIP_GUARD_PASS=true

DRAFT_CURRENT_SELECTION_PASS=true
DRAFT_START_DENIED=true
DRAFT_SUBMISSION_DENIED=true

EXISTING_SPEAKING_RUNTIME_REUSE_CONFIRMED=true
EXISTING_WRITING_RUNTIME_REUSE_CONFIRMED=true

DIAGNOSTIC_TARGETED_TESTS_PASS=true
BACKEND_TYPECHECK_PASS=true
CI_LINT_CHECK_PASS=true
GIT_DIFF_CHECK_PASS=true
FULL_SUITE_PASS=true
HTTP_DELIVERY_VERIFIED=NOT_VERIFIED

CONTENT_VERSION=6
CONTENT_FILES_UNCHANGED=true

REAL_DB_MUTATED=false
SHADOW_DB_MUTATED=false
REAL_DATABASE_RESET=false
V2_ACTIVATED=false

TTS_CALL_COUNT=0
AI_GRADING_CALL_COUNT=0

DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN

PHASE_C1_VERDICT=RUNTIME_FOUNDATION_PASS
```

`*_RUNTIME_REUSE_CONFIRMED=true` means the existing code is reusable with correct ownership checks.
It does **not** mean Speaking or Writing works end to end — see §7.
