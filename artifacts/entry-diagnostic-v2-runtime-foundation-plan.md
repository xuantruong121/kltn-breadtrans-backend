# Entry Diagnostic — runtime foundation plan

Written at Step 2C5 against the **actual repository**, not against the earlier
review's description of it. Where the two disagree, this document says so.

```text
PROJECT_STAGE=LOCAL_DEVELOPMENT          REAL_PRODUCTION_USERS=0
PRODUCT_TARGET=ONE_COMPLETE_FOUR_SKILL_ENTRY_DIAGNOSTIC
DB_MUTATED=false   V2_CANONICAL_CONTENT_ROWS_CREATED=0   V2_ACTIVATED=false
```

---

## 1. Current architecture — what actually exists

**Far more is built than the Step 2D4 review implied.** The productive-skill
runtime is not missing; it is implemented and tested.

### Schema (`prisma/schema.prisma`) — 9 diagnostic models, all present

```text
DiagnosticAssessment        DiagnosticQuestion         DiagnosticAttempt
DiagnosticSpeakingResponse  DiagnosticWritingResponse  DiagnosticSkillResult
DiagnosticReadingPassage    DiagnosticListeningClip    DiagnosticRubric
```

There is **no** `DiagnosticAnswer` model — objective answers live in
`DiagnosticAttempt.answers` (Json), keyed by question id.

`DiagnosticAttempt` already carries what a four-skill result needs:
`resultState` (`DiagnosticCompletionState`), `overallScore Float?` with the
documented rule that it stays **null, never 0**, while any skill is
incomplete, plus version pinning (`scoringVersion`, `blueprintVersion`,
`contentVersion`) so a later scorer cannot reinterpret a historical attempt.

### Backend module (`src/modules/diagnostic/`)

| capability | status | evidence |
|---|---|---|
| Objective delivery + scoring | `IMPLEMENTED_AND_VERIFIED` | `sanitizeQuestion`, `isDiagnosticAnswerCorrect`, `submitAssessment`, 162 passing tests |
| Per-attempt option permutation | `IMPLEMENTED_BUT_INCOMPLETE` | deterministic `getAttemptQuestionPermutation`; fail-open fallback (§6) |
| Speaking recording lifecycle | `IMPLEMENTED_AND_VERIFIED` | `DiagnosticSpeakingService.confirmRecording / skip / list / audio`, ownership-scoped |
| Speaking audio normalisation | `IMPLEMENTED_AND_VERIFIED` | `DiagnosticSpeakingAudioNormalizer` (webm/opus → 16k mono wav), own spec |
| Writing grading lifecycle | `IMPLEMENTED_AND_VERIFIED` | `DiagnosticWritingService.enqueueMany / retry`, async |
| Skill results | `IMPLEMENTED_BUT_INCOMPLETE` | `DiagnosticSkillResult` exists; four-skill assembly not wired to V2 content |
| Assessment lifecycle | `IMPLEMENTED_BUT_INCOMPLETE` | D4-011 (§4) |
| Question-bank validation | `IMPLEMENTED_BUT_INCOMPLETE` | D4-012 (§5) |
| Audio / passage delivery | `IMPLEMENTED_BUT_UNUSED` | §3 — the single most important finding |
| V2 content in the database | `NOT_IMPLEMENTED` | 0 rows in all five V2 tables |

### Frontend (`kltn-breadtrans-frontend-junior`)

`src/app/(student)/diagnostic/page.tsx` — **1128 lines**, already containing
`getUserMedia`, `MediaRecorder`, `audioUrl`, `passageBody`/`passageText`, a
`textarea` and 20 timer references. Plus
`src/lib/diagnostic/diagnosticSpeakingRecorderLogic.ts` with its own test file,
and `DiagnosticQuestionNavigator`, `DiagnosticResultTab`.

**So Phase G is mostly verification, not construction.**

### Reusable from elsewhere — do not rebuild

R2 object storage, BullMQ/Redis background jobs, the Gemini grading client and
the Azure Speech path are all in use by the standalone Speaking module. The
diagnostic Speaking/Writing services already call into them.

---

## 2. One canonical learner flow

There is no V1-vs-V2 learner UI split to remove: `/diagnostic` is already the
single learner-facing route, and `getCurrentAssessment` serves whichever
assessment is current. V1 is **data**, not a parallel flow.

So "one canonical flow" is achieved by **replacing the content** and fixing the
four contracts below — not by deleting code. Technical versioning stays:
`scoringVersion`, `blueprintVersion`, `contentVersion` and `rubricVersion` are
pinned per attempt and per rubric and are what keep historical attempts
interpretable. Scorer selection must remain explicit; it must never be inferred
from title, id or question count.

---

## 3. D4-013 — delivery. The key finding, and a corrected assumption

I expected V1 to store the rich options object. **It does not.** A read-only
query returns a plain array:

```text
SELECT options FROM "DiagnosticQuestion" ORDER BY "order" LIMIT 1;
  ["At noon", "At the train station", "Near the main entrance", "At the café"]
```

But `getQuestionMeta`'s **object branch is fully implemented** and reads:

```text
values  stableKey  section  construct  intendedLevel
questionType  passageText  audioGroup  audioUrl  activeInForm
```

and `sanitizeQuestion` already derives `audioUrl` when `section === 'LISTENING'`
and `passageTitle`/`passageBody`/`passageText` when `section === 'READING'`.

**The delivery path exists and works. Nothing stores the shape it reads.**
V1 therefore has no audio and no passage delivery either — consistent with the
handoff's "V1 has no genuine Listening audio".

**Minimal correct fix:** the importer writes the **object form** into `options`.
No schema change, no runtime change, and it reuses code that is already there.
My Step 2C4 mapper writes `string[]`, which reproduces V1's limitation exactly —
that is the real defect behind D4-013, and it is in my mapper, not in the
runtime.

Rejected alternative: migrating `sanitizeQuestion` to the dedicated V2 columns
and the `DiagnosticListeningClip` relation. Correct long-term, but a larger
change than the goal requires right now.

Confidentiality is already correct and must stay so: `sanitizeQuestion` returns
a 12-field allowlist with neither `correctIndex` nor `explanation`, and the
clip **script** is not in the returned shape at all.

---

## 4. D4-011 — assessment lifecycle

Verified line by line:

```text
isActive  Boolean                     @default(true)
status    DiagnosticAssessmentStatus  @default(ACTIVE)
/// "status is authoritative for learner-current"   ← comment only
```

`grep` for a read path filtering on `status` returns **0**. Four read paths
filter on `isActive: true` (`diagnostic.service.ts:527, 599, 616, 706`), and
`getCurrentAssessment` orders by `id desc`. So the comment is aspirational and
**omitting** `isActive` on insert is the failure mode — the default makes a new
row the current assessment immediately.

Worse: `getCurrentAssessment` calls `assertQuestionBank` **before returning**,
so an assessment that fails validation makes `GET /diagnostic/current` throw for
every learner, not only for V2 takers.

**Design (fail-closed):**

1. The importer sets `isActive: false` **and** `status: DRAFT` explicitly, in
   the same statement that creates the row, in the same transaction as its
   questions. Never rely on defaults.
2. Read paths select on `status = ACTIVE` as the authority; keep `isActive` in
   sync for the transition period rather than dropping it.
3. Activation is a separate explicit operation gated on a readiness check
   (content complete, media present, rubrics present, scorer implemented).
4. A validation failure on a non-current assessment must never break the
   current one — scope `assertQuestionBank` to the assessment actually being
   served, and fail closed to the previous ACTIVE row.

Use the existing `DiagnosticAssessmentStatus` enum. Do not invent new states.

---

## 5. D4-012 — validation by task type

`validateQuestionBank` branches on `meta.questionType`. For `OPEN_TEXT` it
requires `stableKey && section && construct && intendedLevel`, and
`getQuestionMeta` populates `intendedLevel` **only** for `['A1','A2','B1','B2']`
(`diagnostic.logic.ts:157`). Every other shape requires `values.length >= 2`
and a `correctIndex` in range.

So today a productive task can only validate by **persisting a CEFR code**,
which V2 policy forbids — and the mapper correctly hard-sets `intendedLevel:
null`. There is no V2-compliant row shape that passes. Verified.

**Design:** one task-type-aware validator, not a V1/V2 pair.

```text
discriminator = the taskType COLUMN (never correctIndex, never option count)

MCQ               → 4 unique options, exactly one key in range, refs resolve
  + LISTENING     → clip reference present, audio delivery contract satisfied
  + READING       → passage reference present
SPEAKING_RESPONSE → prompt, prepSeconds/responseSeconds, rubricVersion resolves
WRITING_RESPONSE  → prompt, wordMin/wordMax, rubricVersion resolves
```

Drop the `intendedLevel` requirement outright — it is a CEFR field this product
does not claim. No fake options, no `correctIndex: -1` standing in for an MCQ,
no fake key.

---

## 6. Objective permutation — one real current defect

`isDiagnosticAnswerCorrect` has **five** production call sites, not two:
`diagnostic.logic.ts:305` and `diagnostic.service.ts:343, 823, 1048, 1096`. At
`:1048` and `:1096`:

```ts
const perm = attemptId && !isOpenDiagnosticQuestion(question)
  ? getAttemptQuestionPermutation(attemptId, question.id, …)
  : undefined;
```

`attemptId` is **optional and client-supplied**. When absent, `perm` is
`undefined` and the function falls through to
`return answer === question.correctIndex` — comparing a **display** index against
an **authored** index. It fails open and mis-grades silently.

**Fix plan (not applied in this phase):**

1. Resolve the permutation from **authoritative server-side attempt state**,
   looked up by the attempt the submission belongs to, never from a client
   parameter.
2. For an MCQ with more than one option, a missing or invalid permutation
   becomes an error, not a fallback. Return a discriminated "cannot grade"
   rather than a boolean.
3. Tests must invoke `isDiagnosticAnswerCorrect` itself across all 24
   permutations, plus: correct, incorrect, missing permutation, invalid
   permutation, missing attempt, wrong owner, duplicate submission. My Step 2C4
   suite asserts `perm[displayed] === correctIndex`, which is a **tautology
   about the array** and never calls the grader — it must be replaced, not
   extended.
4. `toResult` returns `selectedOption` (display) beside `correctOption`
   (authored) with no marker; a consumer comparing them is wrong. Return both in
   one frame or drop the index fields for the text fields.

---

## 7. GAP-1 — idempotent import

No `DiagnosticQuestion` column holds a stable authored identity, so a re-run has
nothing to match on but `(assessmentId, order)` or mutable question text.

A partial answer already exists: the options object carries `stableKey`, which
`getQuestionMeta` reads and `validateQuestionBank` already requires for
`OPEN_TEXT`. Writing `draftKey` there costs nothing and no migration.

But a value inside a `Json` column **cannot carry a database unique
constraint**, so it gives app-level identity, not a guarantee. For a genuinely
safe repeatable import:

```text
minimal additive migration (Phase B, separately authorised):
  DiagnosticQuestion        sourceKey String?  @@unique([assessmentId, sourceKey])
  DiagnosticReadingPassage  sourceKey String?  @@unique([assessmentId, sourceKey])
  DiagnosticListeningClip   sourceKey String?  @@unique(...)
  DiagnosticAssessment      sourceKey String?  @unique
  DiagnosticRubric          already satisfied by @@unique([skill, rubricVersion])
```

All nullable, all additive, V1 rows stay valid. A stable question key alone is
insufficient — passages and clips duplicate on re-run without their own.

Import must be one transaction: passages and clips first, then rubrics, then
questions referencing them, then the assessment flipped to its final DRAFT
state. A failure must leave nothing active.

---

## 8. Phase plan

Each phase lists what exists, what must change, DB risk, tests, acceptance and
stop conditions.

### Phase A — content approval *(this phase; content work done)*
D4-001 closed by a stem-only edit. **Stop:** cold targeted verification before
Phase B. Acceptance: an independent pass confirms `CLIP_04` leak = 0.
DB risk: none.

### Phase B — persistence foundation *(sequential, blocks C–H)*
Files: `prisma/schema.prisma`, a new migration, `v2-import-mapper.ts`, a new
importer. Change: additive `sourceKey` columns (§7); mapper switched to the
**object** options form (§3); importer writes `isActive:false, status:DRAFT`
explicitly in one transaction.
**DB risk: HIGH — the only phase that writes.** Rehearse on
`kltn-postgres-shadow` (5433), verify `DATABASE_URL != SHADOW_DATABASE_URL` by
actual target, review generated SQL for destructive statements, confirm a
protected checkpoint, then apply.
Tests: migration + rollback + re-run idempotency; importer run twice → row
counts unchanged; V1's 20 rows and all attempts untouched.
Acceptance: 29 questions + 3 passages + 4 clips + 2 rubrics created, assessment
inactive, `GET /diagnostic/current` still serves V1.
Rollback: additive columns are droppable; the import is one transaction.
**Stop if** rehearsal shows any destructive statement.

### Phase C — canonical runtime *(after B)*
Files: `diagnostic.logic.ts` (`validateQuestionBank`, `getQuestionMeta`),
`diagnostic.service.ts` (selection paths). Change: §4 + §5. DB risk: none.
Acceptance: all 29 mapped rows return zero defects; a DRAFT assessment cannot
become current.

### Phase D — delivery *(parallel with E after C)*
Mostly verification, since §3 shows the path exists. Acceptance: a mapped
Listening row yields a non-empty `audioUrl`; a Reading row yields its passage
text; no key, rationale or transcript pre-submission.

### Phase E — Listening audio *(parallel with D)*
Confirm an en-US voice exists **before** generating (DEF-003); decide
`LST_CLIP_03` and `LST_CLIP_04` voice casting explicitly — `LST_CLIP_03` names a
person and uses no pronoun, so casting must be a decision, not an inference.
Verify each file exists, decodes, has plausible duration and matches its script
hash. **Stop if** a script changes after generation — regenerate rather than
ship a mismatch.

### Phase F — scoring *(after C)*
§6 permutation fix with real grader tests; Speaking/Writing rubric grading
wired to `DiagnosticSkillResult`; four-skill assembly at 25/25/25/25 with
LanguageUse 0, overall only when all four complete, failed grading distinct
from a low score. **Blocked on DEF-004** for final placement bands.

### Phase G — frontend *(after D/F)*
Largely verification of the existing 1128-line page and recorder logic. Confirm
mic permission, timer, stop, preview, re-record, confirm, upload, pending and
result states against the real backend.

### Phase H — E2E and activation *(last, sequential)*
Real-browser run, media technical **and** semantic checks, ownership/IDOR,
concurrency and retry, grade and result correctness, then controlled
activation.

**Parallel:** D‖E, and G's component work can start once D's DTO is fixed.
**Sequential:** A → B → C → (D,E,F) → G → H.

---

## 9. Open blockers

```text
DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN     blocks final placement scorer
  docs name 4 bands, code emits 3, and the cutoffs also disagree
  (blueprint Intermediate 65-79 vs resolveEstimatedLevel >= 75).
  Do not invent a fourth threshold. No CEFR equivalence.
DEF-003 en-US TTS voice unconfirmed           blocks Phase E
LST_CLIP_03 / LST_CLIP_04 voice casting       blocks Phase E
GAP-1 schema identity                          blocks Phase B import
IR-017 instruction language                    blocks activation only
```

---

## 10. Gates

```text
Phase A → B   cold verification of the D4-001 change
Phase B → C   migration rehearsed on 5433; importer idempotent twice; V1 intact
Phase C → D   all 29 rows validate; DRAFT cannot become current
Phase E       voice confirmed BEFORE paid generation
Phase F → G   grader tests call the real function across all 24 permutations
Phase H       no activation until every readiness check passes
```
