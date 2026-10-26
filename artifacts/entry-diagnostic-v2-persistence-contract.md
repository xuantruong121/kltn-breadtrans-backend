# Entry Diagnostic V2 — persistence contract

```text
PERSISTENCE_MAPPING_CONTRACT_DOCUMENTED=true
PERSISTENCE_MAPPING_IMPLEMENTED=true     (pure mapper, 87 passing tests, zero DB access)
PERSISTENCE_MAPPING_GUARD_PASS=false     (GAP-1 below)
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
D3_011_CLOSED=false
```

Written 2026-10-25 against content version 5. Nothing in this document has been
written to a database. Every claim about runtime behaviour below was read from
source, and every claim about the mapper is covered by a test.

---

## 1. Why persistence is not approved yet

**GAP-1 — there is no column for a stable authored source identity.**

`DiagnosticQuestion` has no field that can hold `draftKey`. Without one, an
import cannot be made idempotent: a re-run has nothing to match on except
`(assessmentId, order)` or the question text, and both change when content is
revised. A second run would either duplicate 29 rows or update the wrong ones.

That is the whole reason `PERSISTENCE_MAPPING_GUARD_PASS` is `false`. The
mapping itself is implemented and proved; what is missing is a schema
capability, and adding it is a migration, which this phase is not allowed to
perform.

Options for the next phase, none chosen here:

1. Add `sourceKey String?` + `@@unique([assessmentId, sourceKey])` to
   `DiagnosticQuestion` (and the same to the passage, clip and rubric tables).
   Additive, backward-compatible, leaves V1 rows valid.
2. Accept a one-shot non-idempotent import guarded by a pre-check that the
   assessment has zero questions, and accept that a content revision means
   delete-and-recreate rather than update.

Option 1 is the only one that supports revising V2 content after it ships.

**GAP-2 — no column for `distractorRationales`.** Decision taken here: they are
**not persisted**. They stay authoring and review metadata. This is lossless in
the safe direction — no learner sees per-distractor feedback, and nothing can
attach the wrong rationale to the wrong option. Persisting them would require a
column that stores them bound to the *authored* index, for the reason in §4.

---

## 2. Field-by-field mapping

Implemented in `src/modules/diagnostic/v2-import-mapper.ts`. Nothing is spread:
every field is named, and `assertNoAuthoringFields` throws on any key that is
not a real column or that is on the authoring-only list.

### Objective items (25) → `DiagnosticQuestion`

| authored field | column | notes |
|---|---|---|
| `prompt` | `question` | |
| `options` | `options` (Json) | copied, order preserved — this order **is** the canonical identity |
| `correctAnswer` | `correctIndex` | derived as `options.indexOf(correctAnswer)`; mapper throws if absent or not unique |
| `answerRationale` | `explanation` | result-time only — see §3 |
| `order` | `order` | |
| `skill` | `skillCode` (enum) + `skill` (legacy label) | both written so V1 rows stay readable |
| `taskType` | `taskType` (enum) | the discriminator for item kind |
| `subskill` | `subskill` | |
| `difficultyTier` | `difficulty` | **never** `intendedLevel` — see §5 |
| `passageDraftKey` | `passageId` | resolved from a pre-built map; mapper throws if unresolved rather than writing null |
| — | `intendedLevel` | **always null** |
| — | `instructions`, `prepSeconds`, `responseSeconds`, `wordMin`, `wordMax`, `rubricId` | null for objective items |
| `draftKey` | **no column** | GAP-1 |
| `distractorRationales` | **no column** | GAP-2 |
| `estimatedSeconds` | dropped | authoring metadata |

### Productive tasks (4) → `DiagnosticQuestion`

| authored field | column | notes |
|---|---|---|
| `prompt` | `question` | |
| — | `options` | `[]` |
| — | `correctIndex` | `-1`, the schema's documented no-key sentinel |
| — | `explanation` | null; productive items have no keyed rationale |
| `instructions` | `instructions` | |
| `prepSeconds`, `responseSeconds`, `wordMin`, `wordMax` | same names | |
| `rubricVersion` | `rubricId` | resolved from a map; throws if unresolved |
| `constructRationale`, `wordGuidanceRationale`, `targetEvidence`, `targetSubskills`, `difficultyRange` | dropped | authoring metadata |

### Authoring-only fields that must never be persisted

```text
answerRationale*       distractorRationales   constructRationale
wordGuidanceRationale  diagnosticUse          internalLabel
targetSubskills        targetEvidence         difficultyRange
draftKey               mediaDraftKey          passageDraftKey
estimatedSeconds       estimatedDurationSeconds  estimatedReadingSeconds
contextType            localeIntent           accentIntent
speakerLabels          speakerCount           scriptSha256   wordCount
```

`answerRationale` is the single exception, and only into `explanation`, for the
reason in §3. Everything else has no column, which is protective — but it was
previously *undeclared*, which is what D3-011 objected to.

---

## 3. Answer and rationale confidentiality

Required policy: before an answer is submitted or an authorized review state is
reached, no correct answer, no rationale, no answer key and no Listening
transcript may be exposed.

**Verified against source, not assumed.**

`DiagnosticService.sanitizeQuestion` (`diagnostic.service.ts:64`) is the
delivery-time serializer. It returns an explicit allowlist:

```text
id, skill, section, construct, questionType, question, options,
passageTitle, passageBody, passageText, audioUrl, order
```

It does **not** return `correctIndex` and does **not** return `explanation`.
Reading passages are exposed, correctly — a reading item needs its passage.
Listening exposes `audioUrl` only; the script is not in the returned shape at
all, so there is no transcript leak.

`explanation` is returned at exactly two sites, both confirmed:

- `diagnostic.service.ts:365`, inside `private async toResult(...)` — the result
  builder;
- `diagnostic.service.ts:846`, inside `async submitAssessment(...)` — which
  requires the full expected answer set before it runs.

Both are whole-assessment result time, not per-question. So answering one
question does not disclose anything about the rest of an unfinished diagnostic.

```text
ANSWER_RATIONALE_PRE_SUBMISSION_EXPOSURE=false
ANSWER_KEY_PRE_SUBMISSION_EXPOSURE=false
LISTENING_TRANSCRIPT_PRE_SUBMISSION_EXPOSURE=false
```

**Decision:** `answerRationale → explanation` is therefore permitted. Exposure
is post-submission only, and telling a learner why the answer was right is the
point of a diagnostic result. This is a deliberate decision with evidence, not
a default.

**Condition on Step 2E:** if `toResult` or `sanitizeQuestion` is ever changed to
serve partial or in-progress attempts, this decision must be revisited in the
same change. A test asserting `explanation` is absent from the delivery payload
belongs with that code.

---

## 4. Option identity and the shuffle contract

The runtime permutes options per attempt.
`getAttemptQuestionPermutation(attemptId, questionId, optionCount)` is
**deterministic** — a seeded Fisher-Yates over the two ids, with nothing stored
and nothing random. So the permutation is reproducible for any attempt, and a
total, lossless inverse exists.

**Contract: the authored index is the canonical identity. Permutation affects
display order only.**

```text
display position p shows authored option permutation[p]
authored index a is shown at position permutation.indexOf(a)
```

This matches both existing code paths:

- rendering — `sanitizeQuestion`: `options = permutation.map(idx => originalOptions[idx])`
- grading — `isDiagnosticAnswerCorrect`: `permutation[answer] === question.correctIndex`

So identity is never inferred from display position, and never from option text.

**Proved, not asserted.** `v2-import-mapper.spec.ts` runs all **24**
permutations of 4 options against all **25** objective items and asserts, for
every combination: the text at a display position is the option resolved for it;
the rationale shown is that authored option's own rationale; the `CORRECT`
marker lands on the key and on exactly one option; and no non-key position
grades as correct.

```text
OPTION_RATIONALE_IDENTITY_STABLE_UNDER_SHUFFLE=true
ANSWER_KEY_STABLE_UNDER_SHUFFLE=true
DISTRACTOR_FEEDBACK_ALIGNMENT_PASS=true
```

### Two hazards to carry forward

**Hazard A — the silent fallback.** `isDiagnosticAnswerCorrect` ends with
`return answer === question.correctIndex` when no permutation is passed. A
caller that forgets the permutation compares a *display* index against an
*authored* index and silently mis-grades. Not a current bug — both live callers
pass it — but it fails open rather than closed. Step 2E should make the
permutation required for MCQ grading, or throw when it is absent.

**Hazard B — a mixed-frame result payload.** `toResult` returns
`selectedOption: rawAnswer` (a **display** index) next to
`correctOption: question.correctIndex` (an **authored** index). Any consumer
comparing the two directly is wrong. `isCorrect` is computed correctly and
should be the only thing relied on. Either translate `correctOption` into the
display frame or rename both fields.

---

## 5. CEFR and level-bearing columns

`DiagnosticQuestion.intendedLevel` is the field that functions as a learner
level, and `DiagnosticSkillResult.band` is the placement output. The authored
`difficultyTier` is an **uncalibrated design hypothesis** and must never reach
either.

The mapper hard-codes `intendedLevel: null` and routes `difficultyTier` to
`difficulty`. A test asserts this for all 25 items.

Result bands are not content: zero occurrences of Starter / Foundation /
Intermediate / Upper in the content draft or the rubrics. `DEF-004` therefore
does not block draft persistence, but it does block the V2 scorer.

---

## 6. Supported mappings vs unresolved gaps

| | status |
|---|---|
| Objective item → `DiagnosticQuestion` | supported, implemented, tested |
| Productive task → `DiagnosticQuestion` | supported, implemented, tested |
| Reading passage → `DiagnosticReadingPassage` | table exists; mapper not written (passage ids must exist before questions) |
| Listening clip → `DiagnosticListeningClip` | table exists with `script`, `scriptSha256`, `audioSha256`; depends on Step 3 media |
| Rubric → `DiagnosticRubric` | table exists, `criteria` is a Json snapshot column |
| Stable authored identity | **GAP-1, blocking** |
| `distractorRationales` | **GAP-2, not persisted by decision** |

---

## 7. Required Step 2E preflight tests

1. Resolve GAP-1 with an additive migration, or record an explicit decision to
   accept a one-shot non-idempotent import with a zero-questions pre-check.
2. Assert the created row count is exactly 29 questions, 3 passages, 4 clips, 2
   rubrics — and that a second run of the importer changes nothing.
3. Assert for every created row that no authoring-only field from §2 is present
   in any column.
4. Assert `explanation` is absent from the `sanitizeQuestion` payload for every
   question, and present in the result payload only after submission.
5. Assert `options[correctIndex] === authored correctAnswer` for all 25.
6. Assert `intendedLevel IS NULL` for all 29 rows.
7. Re-run the 24-permutation alignment suite against the **persisted** rows, not
   only the draft.
8. Verify the content hash manifest still matches the artifacts the importer
   read, so the rows provably came from reviewed content.
9. Create the assessment as `DRAFT` / inactive and assert `isActive = false`.

---

## 8. Can persistence proceed?

**No, not yet.** The content package is internally consistent and the mapping is
implemented and proved, but GAP-1 means the import cannot be made idempotent,
and a non-idempotent import of 29 rows into a database with a history of
expensive recovery is not a risk worth taking for convenience.

The blocker is one additive migration. It is small. It is just not this phase's
work, and the honest flag is `false`.
