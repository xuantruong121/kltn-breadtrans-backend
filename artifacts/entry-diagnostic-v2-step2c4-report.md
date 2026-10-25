# Entry Diagnostic V2 — Step 2C4 report

```text
ENTRY_DIAGNOSTIC_V2_STEP2C4_COMPLETE=true
ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS=REQUIRES_STEP2D4

PERSISTENCE_MAPPING_GUARD_PASS=false
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
```

Content version **4 → 5**. All 19 Step 2D3 findings accounted for: 14 fixed,
2 documented as contract, 1 note retained, 2 open by design.

---

## 1. The four defect groups

### Group 1 — the material Listening leak (D3-001) — CLOSED

The leak was in **`LST_Q_006`'s stem, not in any key**. *"What is missing from
the form?"* asserted, before any audio played, that something was missing — and
exactly one of `LST_Q_007`'s four options realises that assertion, with the
other three off-dimension.

The stem now asks *"What does the speaker say about the form?"*, which asserts
nothing. `LST_Q_007` is **untouched**: re-keying it would have collided with
`LST_Q_008`, which already owns the Friday deadline.

```text
LST_CLIP_03 script: byte-unchanged -> no TTS cost, no re-voicing
subskills preserved: Q006 specific detail, Q007 purpose
key index unchanged at 3 -> correct-option distribution untouched
```

A bonus from the rewrite: the new distractor *"Everything on it was filled in
incorrectly"* is explicitly contradicted by the script (*"Everything you filled
in is fine — that's not the problem"*), so it rewards listening rather than
guessing.

### Group 2 — blueprint contradictions

**D3-004, the dangerous one.** `overallWeightRationale` opened *"Not
equal-by-default"* and argued *"Receptive 60 / productive 40"* from the premise
that Writing carried one task — while `overallWeights` is 25/25/25/25,
`overallFormula` is `(L+R+S+W)/4`, and `counts.writingProductiveTasks` is 2. An
implementer reading the rationale rather than the dictionary would have shipped
the wrong weights. Rewritten to state equal weighting as a **product-design
hypothesis**, explicitly declining to claim reliability evidence it does not
have. `knownWeakness` rebased from the stale one-task premise to the real
weakness: equal weighting is unvalidated.

**D3-003.** `objectiveItemsByDifficultyTier` declared
`{D1:4, D2:7, D3:5, D4:4, …}`; the items give `{D1:5, D2:9, D3:7, D4:4}`.
Corrected to the counted values — **no item was retiered to match the stale
block** — and a `BLUEPRINT_TIER_DISTRIBUTION_CONFORMANCE` check added so the
claim is now machine-compared instead of merely printed.

**D3-012 / DEF-004.** `levelSystem` presented four bands and their cutoffs as
an approved V2 contract. They are not: the band count disagrees with the code
*and* `Intermediate 65-79` disagrees with the code's `>= 75`, so a learner at
70% is Intermediate here and Foundation there. Replaced with an
`UNRESOLVED_DO_NOT_IMPLEMENT` record stating both disagreements, preserving the
removed values for the decision, and recording V1 behaviour as **observed
only**. No cutoff chosen. `Upper` not introduced. V1 scoring untouched.

### Group 3 — validator guards that passed invalid input

The structural fix: the three weak checks were moved **out** of the audit script
into `src/modules/diagnostic/content-guards.ts` as pure functions, so they can
be tested with fixtures that genuinely fail. This is the fix for the project's
recurring failure mode — a narrow check reported under a broad flag name.

**Provenance (D3-008).** Rewritten as structural JSON traversal over keys *and*
values. The left anchor changed from `\b` to `(?:^|[^A-Za-z])`, which is the
actual root cause: `\b` does not fire between `_` and a letter, so
`STATUS=CLOSED_BY_REV-014` slipped through. `REVISION`, `DEF` and `D<n>`
prefixes added; `Pass`/`Phase`/`Step` covered.

```text
17 awkward variants x 2 placements (string value, object key) = 34 negative fixtures
plus a benign fixture proving it does NOT flag "D1", "D1-D3", "revising", "scaleId"
```

**CEFR (D3-010).** Now scans the blueprint, distinguishing active from
historical use: a bare CEFR code as a value is active anywhere outside a
declared history field, and a CEFR token in a level-bearing field
(`band|level|tier|difficulty|cefrEquivalent|placement|cutoff|threshold`) is
active. Fixtures prove a result band of `"B2"` and an item difficulty of `"A1"`
both fail, while `cefrClaimBasis`, `notCefr` and `previousDraftDifficultyNote`
legitimately pass.

**`NO_DB_IDS` (D3-016).** The old check ran a regex over an array of key
*strings* and could never fire. Replaced with a recursive walk flagging any key
named `id` or `*Id` with a numeric value. A reachability test asserts
`findDatabaseIds({id: 1})` returns one hit, and a benign fixture proves `order`,
`wordMin`, scores, versions, `draftKey` and the string `scaleId` are not
rejected.

**Flag honesty retained.** `KNOWN_BRITISH_FORM_COUNT` keeps its limited name and
its caveat that absence proves only the listed forms are absent.
`EN_US_MANUAL_REVIEW_COMPLETED` is reported separately as judgement, not derived
from the scan. The validator header now states what it can and cannot prove.

### Group 4 — the persistence contract (D3-011)

Full contract in
[entry-diagnostic-v2-persistence-contract.md](entry-diagnostic-v2-persistence-contract.md).

All three collisions D3-011 named were investigated **against source**:

**`answerRationale` → `explanation` is permitted**, as a decision with
evidence. `sanitizeQuestion` (`diagnostic.service.ts:64`) returns an explicit
12-field allowlist containing neither `correctIndex` nor `explanation`.
`explanation` is returned at exactly two sites — `toResult` (365) and
`submitAssessment` (846) — both whole-assessment result time, and
`submitAssessment` requires the full expected answer set. So answering one
question discloses nothing about the rest of an unfinished diagnostic.

```text
ANSWER_RATIONALE_PRE_SUBMISSION_EXPOSURE=false
ANSWER_KEY_PRE_SUBMISSION_EXPOSURE=false
LISTENING_TRANSCRIPT_PRE_SUBMISSION_EXPOSURE=false
```

**Option identity is proved, not asserted.**
`getAttemptQuestionPermutation` is **deterministic** from `attemptId` and
`questionId`, so the inverse is total and lossless and nothing has to be
inferred from display position or option text. The contract: *the authored index
is canonical; permutation affects display order only.* Proved over **all 24
permutations × all 25 objective items** — the text at a position is the option
resolved for it, the rationale shown is that authored option's own rationale,
the `CORRECT` marker lands on the key and on exactly one option, and no non-key
position grades as correct.

```text
OPTION_RATIONALE_IDENTITY_STABLE_UNDER_SHUFFLE=true
ANSWER_KEY_STABLE_UNDER_SHUFFLE=true
DISTRACTOR_FEEDBACK_ALIGNMENT_PASS=true
```

**The mapper is a pure allowlist.** Nothing is spread.
`assertNoAuthoringFields` throws on any authoring field or any key that is not a
real column. `intendedLevel` is hard-coded `null` and `difficultyTier` routes to
`difficulty`, never to the field that functions as a learner level.

---

## 2. Why persistence is still not allowed

```text
PERSISTENCE_MAPPING_CONTRACT_DOCUMENTED=true
PERSISTENCE_MAPPING_IMPLEMENTED=true     (pure mapper, 37 tests, zero DB access)
PERSISTENCE_MAPPING_GUARD_PASS=false
D3_011_CLOSED=false
```

**GAP-1: `DiagnosticQuestion` has no column for a stable authored source
identity.** Without one the import cannot be idempotent — a re-run has nothing
to match on but `(assessmentId, order)` or the question text, both of which
change when content is revised. A second run would duplicate 29 rows or update
the wrong ones.

A non-idempotent import of 29 rows into a database with a history of expensive
recovery is not a risk worth taking for convenience. The fix is **one additive
migration** (`sourceKey` + a unique index). It is small; it is just not this
phase's work, and the honest flag is `false`.

GAP-2: no column for `distractorRationales`. Decision: **not persisted**. They
stay authoring metadata — lossless in the safe direction, since nothing can
then attach the wrong rationale to the wrong option.

### Two hazards carried forward

**A — the silent fallback.** `isDiagnosticAnswerCorrect` ends with
`return answer === question.correctIndex` when no permutation is passed, so a
caller that forgets it compares a display index against an authored index and
silently mis-grades. Not a current bug — both live callers pass it — but it
fails open. Step 2E should make the permutation required, or throw.

**B — a mixed-frame payload.** `toResult` returns `selectedOption` (display)
beside `correctOption` (authored). Any consumer comparing them directly is
wrong; `isCorrect` is the only safe field.

---

## 3. Findings not fixed, and why

| id | why not |
|---|---|
| **D3-002** | `LST_Q_002` is labelled gist but keys a clock time against a competing time — the blueprint's own D2 definition. Re-labelling shifts the declared subskill distribution; re-keying changes a sound reviewed item. Both are content-design calls with matrix knock-ons, and neither blocks persistence, TTS or the scorer. Carried with the matrix reconciliation. |
| **D3-005** | Two unanchored length cases (Speaking below `minimumUsefulResponseSeconds`, Writing over `wordMax`). Grading-consistency holes that matter when the grader runs, not when rows are created — and the right disposition for over-length in a placement test is probably "no penalty", which is a rubric decision best taken with the grading prompt in hand. Explicitly **not** fixed by adding a speech-rate requirement. |
| **D3-007** | `criterionKey: "task_fulfilment"` / `"organisation"` are the field names the AI grader must emit. **Decision recorded: keep them.** Learner-facing text is consistently American; these are machine identifiers. If they are ever renamed it must happen before the first rubric row is persisted, because `DiagnosticRubric.criteria` is a Json snapshot column — so it is on the Step 2E checklist. |
| **D3-017** | `campus store` is ordinary American English and the earlier flag on it was a false positive. The residual is clarity only, item validity is unaffected, and changing it would alter a reviewed passage and its key for a nicety. |

Three NOTEs *were* fixed because each was a live defect under a soft label:
D3-013 (a real double penalty in a rubric about to be persisted), D3-016 (a
guard that could not fail) and D3-015/D3-018 (rationales stating things untrue
of English or of their own script).

---

## 4. Validation

```text
TOTAL_ITEMS=29   L10/clips4  R10/passages3  S2  W2  LU5  OBJECTIVE 25
BLUEPRINT_CONFORMANCE_PASS=true   DRAFT_KEY_UNIQUENESS_PASS=true
OBJECTIVE_KEY_STRUCTURE_PASS=true  UNRESOLVED_DRAFT_REFERENCES=0
RUBRIC_STRUCTURAL_VALIDATION_PASS=true  MECHANICAL_VALIDATION_PASS=true
CORRECT_OPTION_DISTRIBUTION A5 B7 C7 D6 (unchanged)
BLUEPRINT_TIER_DISTRIBUTION_CONFORMANCE_PASS=true

HASH_MANIFEST_REGENERATED_ONCE=true  HASH_MISMATCH_COUNT=0
CHECK_MODE_MUTATED_FILES=false  (md5 15187db9… identical across write + both checks)

BACKEND_TYPECHECK_PASS=true   CI_LINT_CHECK_PASS=true   GIT_DIFF_CHECK_PASS=true
DIAGNOSTIC_TESTS_PASS=162/162 (8 suites)
NEW_GUARD_AND_MAPPER_TESTS=87/87 (2 new suites)
FRONTEND_FILES_CHANGED_BY_STEP2C4=0

DB_MUTATED=false  V2_CANONICAL_CONTENT_ROWS_CREATED=0  V2_ACTIVATED=false
AZURE=0  TTS=0  GEMINI_GRADING=0  R2=0
```

**Lint.** The 32 prettier errors CI reported were the pre-fix state of the four
new files. `eslint --fix` was run on **those four files only**, to avoid
touching work that may belong to another session. `lint:check` now exits 0,
including the one non-prettier error (`no-unnecessary-type-assertion`), and all
87 tests still pass after the reformat.

**One unrelated failure, reported rather than absorbed.** The full suite is
1267/1268. `src/modules/speaking/speaking-post-processing.service.spec.ts` fails
only under the parallel full run and passes **8/8 in isolation** — a pre-existing
parallel-execution flake in the Speaking module, which Step 2C4 did not touch.

---

## 5. Open register

```text
DEF_003_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_03_VOICE_CASTING_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_04_VOICE_CASTING_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN   blocks V2 scorer, not persistence
DEF_005_PERSISTENCE_SOURCE_IDENTITY_GAP=OPEN   blocks live persistence (GAP-1)
IR_017_INSTRUCTION_LANGUAGE=SAFE_TO_DEFER_ACTIVATION
D3_002 / D3_005 open; D3_007 decided (keep identifiers)
```

---

## 6. What this pass does not establish

- **Approval.** `REQUIRES_STEP2D4`, deliberately.
- **That live persistence is safe.** `PERSISTENCE_MAPPING_GUARD_PASS=false`
  because of GAP-1, and that must not be flipped because the content package is
  internally consistent. Those are different claims.
- **That the four per-clip leak counts are right.** They are my semantic
  judgement on content I revised. A cold pass has already overturned my count on
  this exact item once — which is precisely why Step 2D4 exists.
- **Any psychometric property.** D1–D4 stays an uncalibrated hypothesis, and the
  equal weighting is now explicitly labelled one too.
- **Rubric validity.** Six anchor edits across five passes, still never trialled
  against a real response.
