# Entry Diagnostic V2 — Step 2D4 cold content & contract verification

```text
STEP2D4_REVIEW_COMPLETE=true

Gate A — CONTENT:            STEP2D4_VERDICT=CONTENT_REVISIONS_REQUIRED
                             ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS=false
Gate B — LIVE PERSISTENCE:   STEP2E_LIVE_PERSISTENCE_ALLOWED=false

CONTENT_BLOCKER_COUNT=0   CONTENT_MAJOR_COUNT=1
CONTENT_PERSISTENCE_BLOCKING_MINOR_COUNT=0
```

The two gates fail for entirely different reasons and neither fix helps the
other. Reviewed against content version 5.

---

## 1. Independence

```text
INDEPENDENCE_MODE=COLD_CONTEXT_PROXY
STAGE_A_FINDINGS_FROZEN_BEFORE_RECONCILIATION=true
```

I authored this content and every revision pass including 2C4, so I am not the
reviewer. Stage A was run by an agent with no session context, barred from all
sixteen prior review artifacts, and given no expected version values.

Four cold passes have now each found real defects I had cleared. This one found
a MAJOR of the **exact class I had just fixed on a neighbouring clip**, a
BLOCKER that would 500 the live diagnostic endpoint for every learner, and the
fact that my own 24-permutation "proof" is a tautology.

---

## 2. Gate A — one MAJOR, and it is my blind spot repeating

**D4-001 — `LST_Q_010`'s stem makes exactly one of `LST_Q_009`'s options obvious
with no audio.**

> `LST_Q_010` stem: *"Why was the presentation shorter than planned?"*

That asserts, before any audio plays, that the presentation did not go to plan.
Exactly one of `LST_Q_009`'s four options realises the assertion —
*"A technical problem spoiled their plan"* — while the other three (applause
showed it went well / the slides were the strongest part / the audience left
before it had finished) are off-dimension or contradicted by it.

**Why this is mine, specifically.** In Step 2C3 I fixed this defect class on
`LST_CLIP_03`, where a stem asserted a fact that privileged a sibling's key. In
Step 2C4 I then recorded `LST_Q_010_OPTIONS_DO_NOT_LEAK_Q009=true` — I checked
the **options** direction on CLIP_04 and never asked whether the **stem** does
the same thing, in the very pass that had just learned the stem direction next
door. By my own recorded leak definition it counts.

```text
LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=0
LISTENING_CROSS_ITEM_LEAK_COUNT=1
CLIP_01=0   CLIP_02=0   CLIP_03=0   CLIP_04=1
```

The CLIP_03 fix is independently confirmed closed — the leak did not move, it
simply already existed on CLIP_04 and was never checked.

**Scope: one item stem.** Question-only edit, no script change, no TTS cost, no
re-keying. Everything else in the content package passed.

```text
BLUEPRINT_WEIGHTING_CONTRADICTION_COUNT=0   BLUEPRINT_TASK_COUNT_CONSISTENCY_PASS=true
BLUEPRINT_DIFFICULTY_DISTRIBUTION_MATCHES_CONTENT=true
BLUEPRINT_UNRESOLVED_CUTOFF_PRESENTED_AS_APPROVED=false
TOTAL_ITEMS=29  objective keys 25/25  HASH_MISMATCH_COUNT=0
CONTENT_TARGET_STABLE_DURING_REVIEW=true  CONTENT_FILES_MUTATED=false
contentVersion=5  blueprintVersion=V2_2026_01  scoringVersion=FOUR_SKILL_PLACEMENT_V2
V2_SCORER_FAILS_CLOSED=true
```

One MINOR I introduced in 2C4: **D4-002** — `LST_Q_006`'s new distractors B and
C are categorical absolutes, leaving the key as the only bounded option. My
rewrite of that stem fixed a leak and created a form cue.

---

## 3. Gate B — a BLOCKER, verified line by line

**D4-011 — importing V2 would switch every learner onto it and then 500 the
diagnostic endpoint.**

```text
prisma/schema.prisma  DiagnosticAssessment
  isActive  Boolean                     @default(true)
  status    DiagnosticAssessmentStatus  @default(ACTIVE)
  /// "status is authoritative for learner-current"
```

I verified every step:

- **Zero** read paths filter on `status`. Four filter on `isActive: true`
  (`diagnostic.service.ts:527, 599, 616, 706`), and `getCurrentAssessment`
  orders by `id desc`.
- So the schema comment is **aspirational, not implemented**, and
  `assessment.statusOnCreate: "DRAFT"` in my content draft has **no effect on
  serving**.
- `isActive` **defaults to true**, so the failure mode is *omitting* the field,
  not setting it wrong.

**And the second consequence is worse than mis-serving.**
`getCurrentAssessment` calls `assertQuestionBank` *before returning anything*.
My mapper writes productive tasks as `options: []`, `correctIndex: -1`.
`getQuestionMeta` takes its `Array.isArray` branch → `{values: [], questionType:
'MCQ'}`, so each of the 4 productive rows trips **both** `invalid options`
(`values.length < 2`) and `invalid correct index` (`-1 < 0`).
`assertQuestionBank` throws `InternalServerErrorException`.

**`GET /diagnostic/current` would 500 for every learner in the product** — not
only V2 takers.

My persistence contract §7 item 9 *did* say "assert `isActive = false`", so the
requirement was known. What is written **nowhere**: that `isActive` defaults to
true, that `DRAFT` does nothing, and consequence 2 at all — grep for
`validateQuestionBank` in my contract returns **0**.

### No importer exists

Verified: grep for consumers of `mapObjectiveQuestion` / `mapProductiveTask`
across `src/` and `scripts/` returns **only the mapper and its own spec**. So my
`PERSISTENCE_MAPPING_IMPLEMENTED=true` was over-stated — the mapping *function*
is implemented and tested; the thing that would do the writing is not written.

```text
PURE_MAPPER_TESTS_PASS=true        LIVE_IMPORT_IDEMPOTENCY_PASS=false
PERSISTENCE_MAPPING_GUARD_PASS=false
STABLE_AUTHORED_IDENTITY_AVAILABLE=false
REIMPORT_IDEMPOTENCY_POSSIBLE_WITH_CURRENT_SCHEMA=false
GAP_1_CONFIRMED=true
```

GAP-1 is confirmed and my record of it is **incomplete** (D4-015): passage and
assessment identity need the same treatment, clip *cardinality* is a distinct
defect from identity, `mediaDraftKey` is misclassified as authoring metadata
when it is a content reference needing a target, and the rubric table is already
satisfied by `@@unique([skill, rubricVersion])` and should be excluded
explicitly.

---

## 4. Two MAJORs that mean the V2 runtime does not work yet

**D4-012 — no V2-compliant row can pass the live question-bank validator without
persisting a CEFR level.** `validateQuestionBank` branches on
`meta.questionType`. For `OPEN_TEXT` it requires `intendedLevel`, and
`getQuestionMeta` populates that **only** for `['A1','A2','B1','B2']`
(`diagnostic.logic.ts:157`). For anything else it requires `values.length >= 2`,
which no productive task can satisfy. V2 policy forbids persisting a CEFR code
and my mapper hard-sets `intendedLevel: null` deliberately. The schema's real
discriminator — the `taskType` column — is never read by `getQuestionMeta`.

**D4-013 — `options: string[]` discards every field the runtime reads.** The
object branch of `getQuestionMeta` is where `section`, `passageText`, `audioUrl`
and `stableKey` live. A plain array returns only `{values, questionType}`. So:
**no audio would be served** for the 10 Listening items (and the same
`undefined` silently disables the `missing listening audio` check), **no passage
text** for the 10 Reading items, and the Speaking submit guard would never fire.

Together these mean the content is nearly ready and **the runtime that would
deliver it is not**.

---

## 5. Where my 2C4 claims were wrong

| My claim | Reality |
|---|---|
| `CLIP_04_CROSS_ITEM_LEAK_COUNT=0` | **1** (D4-001) — I checked the options direction, not the stem |
| `isDiagnosticAnswerCorrect` "not a current bug — both live callers pass it" | **Five** production call sites, and at `:1048`/`:1096` `perm` is `attemptId ? … : undefined`, gated on an **optional client-supplied** parameter. When absent the function falls back to `answer === correctIndex`, comparing a display index against an authored index. `CURRENT_RUNTIME_DEFECT` |
| `ANSWER_KEY_STABLE_UNDER_SHUFFLE=true`, proved over 24 permutations | The grading test asserts `perm[displayed] === correctIndex` — a **tautology about the permutation array**. It never calls the grader. The rationale test exercises my own helper, which has no production caller. The runtime grader has 2-permutation coverage (D4-016) |
| `PERSISTENCE_MAPPING_IMPLEMENTED=true` | The function exists; no importer consumes it |
| `DRAFT_KEYS=36 unique of 36` (2D3) | **37** — `DIAG_V2_ASSESSMENT` was excluded, and the validator prints only a boolean with no count (D4-020) |

The permutation one stings most: it is the same failure mode I wrote a whole
module and 87 tests to structurally eliminate — a narrow check reported under a
broad flag name — reappearing inside the fix itself.

---

## 6. Guard scope — the unfavourable answer to the question I asked

```text
PROVENANCE_GUARD_NEGATIVE_FIXTURES_PASS=true
CEFR_BLUEPRINT_SEMANTIC_GUARD_PASS=true
NO_DB_IDS_NEGATIVE_FIXTURES_PASS=true
BLUEPRINT_CONFORMANCE_NEGATIVE_FIXTURES_PASS=false
```

I asked specifically whether skill weights and task counts are guarded at all.
**They are not** (D4-010, fixture-proved on four mutations):
`blueprint.matrix` and `blueprint.scoring` are never read by the validator. The
version and the tier distribution are guarded; the weights and the task counts
are not — so the D3-004 weighting contradiction I just fixed by hand could
silently return.

Also: the CEFR guard's `CEFR_HISTORICAL_KEYS` allowlist exempts by **leaf name**
rather than by path, so bare codes in the generic keys `note`/`status`/`problem`
pass (D4-008), and `NO_DB_IDS` is numeric-and-camelCase only (D4-009). Neither
affects today's package.

---

## 7. Confidentiality — this part held

```text
ANSWER_RATIONALE_PRE_SUBMISSION_EXPOSURE=false
ANSWER_KEY_PRE_SUBMISSION_EXPOSURE=false
```

`sanitizeQuestion`'s 12-field allowlist contains neither `correctIndex` nor
`explanation`. Independently confirmed.

But `toResult` gates key and rationale disclosure only on
`status === 'COMPLETED'` and **never reads `resultState`**, so a
`PENDING_GRADING` V2 attempt could disclose all 25 keys before grading finishes
(D4-017). And it returns `selectedOption` (display) beside `correctOption`
(authored) with no marker.

```text
TO_RESULT_INDEX_EXPOSURE_STATUS=BOTH_FRAMES_RETURNED_UNMARKED
IS_DIAGNOSTIC_ANSWER_CORRECT_FAIL_OPEN_STATUS=CURRENT_RUNTIME_DEFECT
```

---

## 8. Defects by the phase that must resolve them

```text
before content approval   D4-001
before live persistence   D4-011 (BLOCKER), D4-015/GAP-1, and an importer at all
before V2 activation      D4-012, D4-013, D4-014, D4-017
before the V2 scorer      DEF-004/D4-004, D4-003, D4-019
validator hardening       D4-010, D4-008, D4-009
safe to carry             D4-002, D4-005, D4-006, D4-007, D4-016, D4-018, D4-020, D4-021
```

```text
DB_MUTATED=false  V2_CANONICAL_CONTENT_ROWS_CREATED=0  V2_ACTIVATED=false
AZURE=0  TTS=0  GEMINI_GRADING=0  R2=0
7 files hashed pre/post — the 4 artifacts plus the validator, guards and mapper
— all byte-identical. The code was hashed too: a guard audit is worthless if the
guard can be edited underneath it.
```

---

## 9. What this gate does not establish

- Human or psychometric independence.
- That the content defect list is complete — four cold passes, four times I had
  cleared something real.
- Any psychometric property. `D1-D4` uncalibrated; equal weighting a declared
  hypothesis.
- Rubric validity — six anchor edits across five passes, never trialled.
- **That the V2 runtime works at all.** D4-012 and D4-013 together mean no
  mapped V2 row passes the live question-bank validator, no audio reaches a
  Listening item and no passage text reaches a Reading item. The content is one
  stem edit from approvable; the delivery path is not close.
