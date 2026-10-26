# Entry Diagnostic — Phase B0 preflight

Planning only. **No database was mutated, no migration run, no row imported.**
Every claim below is checked against the live repository; where it contradicts
an earlier agent's conclusion, that is stated.

```text
PHASE_B0_COMPLETE=true
CONTENT_REVIEW_PASS=true   CONTENT_PACKAGE_VERSION=6   CONTENT_FILES_MUTATED=false
DB_MUTATED=false   DATABASE_RESET=false   DATABASE_TABLES_DROPPED=0
V2_CANONICAL_CONTENT_ROWS_CREATED=0   V2_ACTIVATED=false
STEP2E_LIVE_PERSISTENCE_ALLOWED=false
```

---

## 1. The finding that changes the import design

**`DiagnosticListeningClip` is keyed to ONE question. The authored content has
four clips serving two to three questions each.**

```prisma
model DiagnosticListeningClip {
  questionId Int                                  // required, not nullable
  question   DiagnosticQuestion @relation(...)
  version    Int @default(1)
  @@unique([questionId, version])
}
```

```text
LST_CLIP_01 -> 2 questions     LST_CLIP_03 -> 3 questions
LST_CLIP_02 -> 3 questions     LST_CLIP_04 -> 2 questions
```

A 1:1 model against 1:N content. This was recorded earlier as a vague
"cardinality defect"; here is what it actually forces.

**Second fact that decides the answer:** the clip table is **not** the delivery
source. `sanitizeQuestion` reads `audioUrl` from the **options JSON**, never
from this relation. The clip table is a *media registry* — script, both hashes,
storage key, voice, locale, duration, byte size.

So the clip row is per-question **provenance**, and the blueprint's own
readiness guard is phrased per item: *"every Listening item has a verified audio
asset (bytes > 0, decodes, duration plausible, script hash matches)"*. That is
naturally expressed as one row per Listening question.

**Decision: one clip row per Listening question — 10 rows, not 4.** Questions
sharing an authored clip share `storageKey`, `url`, `script`, `scriptSha256`
and `audioSha256`; only one audio file is uploaded and stored. No migration is
needed for clips, and `@@unique([questionId, version])` already gives clip
idempotency for free.

Cost, stated honestly: a script change must update 10 rows rather than 4.
`scriptSha256` makes any drift detectable, and the import is idempotent by
`(questionId, version)`, so a re-run corrects it.

Rejected: making `questionId` nullable and adding `assessmentId` to the clip.
Semantically tidier, but it changes a required relation on an existing table for
no delivery benefit, and the delivery path does not read the relation anyway.

---

## 2. Existing identity — what is already sufficient

Checked every `@unique` / `@@unique` on the nine diagnostic models.

| model | existing identity | needs `sourceKey`? |
|---|---|---|
| `DiagnosticRubric` | `@@unique([skill, rubricVersion])` | **No — already sufficient** |
| `DiagnosticListeningClip` | `@@unique([questionId, version])` | **No — derived from the question** |
| `DiagnosticSpeakingResponse` | `@@unique([attemptId, questionId])` | No — runtime data |
| `DiagnosticWritingResponse` | `@@unique([attemptId, questionId])` | No — runtime data |
| `DiagnosticSkillResult` | `@@unique([attemptId, skill])` | No — runtime data |
| `DiagnosticQuestion` | **none** (indexes only) | **Yes** |
| `DiagnosticReadingPassage` | **none** (`@@index([assessmentId, order])`) | **Yes** |
| `DiagnosticAssessment` | **none** (`@@index([status])`) | **Yes** |

So the earlier "add `sourceKey` to five tables" is **too broad**. Three tables
need it. Rubrics and clips are already covered.

### Minimal additive migration

```prisma
model DiagnosticAssessment {
  sourceKey String? @unique
}
model DiagnosticQuestion {
  sourceKey String?
  @@unique([assessmentId, sourceKey])
}
model DiagnosticReadingPassage {
  sourceKey String?
  @@unique([assessmentId, sourceKey])
}
```

| property | value |
|---|---|
| type / nullability | `String?`, nullable |
| uniqueness scope | per assessment for questions and passages; global for the assessment |
| existing-row compatibility | V1's 1 assessment + 20 questions keep `NULL`; Postgres treats each `NULL` as distinct, so no collision |
| index | created by the unique constraint |
| migration risk | **low** — three `ADD COLUMN` + three unique indexes, all additive, no data rewritten, no column dropped, no type changed |
| rollback | drop the three indexes and three columns; nothing else references them until the importer exists |

`sourceKey` is populated from the authored `draftKey` (`LST_Q_001`,
`RDG_PASSAGE_02`, `DIAG_V2_ASSESSMENT`), which is already proven unique — 37
keys, 0 duplicates.

---

## 3. Idempotent importer contract

```text
PURE_MAPPING_VALID      = true   (37 mapper tests pass)
IMPORTER_IMPLEMENTED    = false  (no consumer of the mapper exists outside its spec)
ISOLATED_IMPORT_TESTED  = false  (Phase B1)
LIVE_IMPORT_APPROVED    = false  (needs B0 + B1 + explicit authorisation)
```

These are four distinct states and only the first is true.

**Order inside one transaction:**

```text
1  assessment        upsert on sourceKey, forced to DRAFT (§4)
2  reading passages  upsert on (assessmentId, sourceKey)
3  rubrics           upsert on (skill, rubricVersion)
4  questions         upsert on (assessmentId, sourceKey), resolving passageId/rubricId
5  listening clips   upsert on (questionId, version), one row per listening question
6  post-assertions, still inside the transaction
```

**Matching is upsert-by-identity only.** No delete, no truncate, no
replace-all, no "delete where assessmentId = X then re-insert" — that would
destroy attempt references.

**Ownership scope:** every write is constrained to the assessment identified by
its `sourceKey`. A row whose `sourceKey` is `NULL` (all V1 rows) can never be
matched, so legacy content is structurally untouchable by the importer.

**Post-import assertions, inside the transaction, rollback on any failure:**

```text
29 questions, 3 passages, 4 distinct scripts over 10 clip rows, 2 rubrics
every question resolves its passage / rubric / clip reference
assessment.isActive = false AND status = DRAFT
V1 assessment row and its 20 questions byte-unchanged
0 attempts touched
a second run changes 0 rows
```

---

## 4. DRAFT lifecycle — D4-011

Re-verified against source, not taken from the earlier audit:

```prisma
isActive Boolean                    @default(true)
status   DiagnosticAssessmentStatus @default(ACTIVE)
/// "status is authoritative for learner-current"   ← comment only
```

`grep` for a read path filtering on `status`: **0**. Four read paths filter
`isActive: true` (`diagnostic.service.ts:527, 599, 616, 706`);
`getCurrentAssessment` orders by `id desc`. So **omitting** the field is the
failure mode, and a new row becomes current immediately.

**Contract:**

```text
DRAFT   isActive=false  status=DRAFT
        not selectable by getCurrentAssessment
        no attempt can be started against it
ACTIVE  only by an explicit activation operation gated on readiness
```

1. The importer sets **both** fields explicitly in the creating statement.
   Never rely on a default.
2. Read paths move to `status = ACTIVE` as the authority, keeping `isActive` in
   sync during the transition rather than dropping it.
3. `assertQuestionBank` is scoped to the assessment being served, so a DRAFT
   that fails validation can never break the live one. Today it runs before
   `getCurrentAssessment` returns, which is why a bad import would 500 the
   endpoint for every learner.

**Tests (B1):** insert a DRAFT V2 assessment with a higher id than V1 → assert
`getCurrentAssessment` still returns V1; assert starting an attempt against the
DRAFT id is refused; assert `GET /diagnostic/current` does not throw.

---

## 5. Task-type validation — D4-012

`validateQuestionBank` branches on `meta.questionType`. `OPEN_TEXT` requires
`stableKey && section && construct && intendedLevel`, and `getQuestionMeta`
populates `intendedLevel` **only** for `['A1','A2','B1','B2']`
(`diagnostic.logic.ts:157`). Everything else requires `values.length >= 2` and a
`correctIndex` in range.

So a productive task can validate **only by persisting a CEFR code**, which the
product forbids. Confirmed; no V2-compliant shape passes today.

**Minimal refactor — one task-type-aware validator, discriminating on the
`taskType` column**, never on `correctIndex` or option count:

```text
MCQ                → 4 unique options, exactly one key in range, refs resolve
  + LISTENING      → clip row present for this question, audioUrl deliverable
  + READING        → passage reference resolves
SPEAKING_RESPONSE  → prompt, prepSeconds, responseSeconds, rubric resolves
WRITING_RESPONSE   → prompt, wordMin, wordMax, rubric resolves
```

The `intendedLevel` requirement is dropped outright. No fake options, no
`correctIndex: -1` posing as an MCQ, no CEFR code.

Not implemented in B0.

---

## 6. Delivery contract — D4-013

Verified end to end.

```text
DB options(Json) → getQuestionMeta → sanitizeQuestion → API → frontend
```

`getQuestionMeta`'s **object branch is fully implemented** and reads `values`,
`stableKey`, `section`, `construct`, `intendedLevel`, `questionType`,
`passageText`, `audioGroup`, `audioUrl`, `activeInForm`. `sanitizeQuestion`
derives `audioUrl` when `section === 'LISTENING'` and
`passageTitle`/`passageBody`/`passageText` when `section === 'READING'`, and
returns a 12-field allowlist.

**But V1 stores a flat array** — a read-only query returns
`["At noon", "At the train station", …]`, and `jsonb_object_keys` errors with
*"cannot call jsonb_object_keys on an array"*. So the object branch is live code
that nothing currently feeds, and V1 consequently has no audio or passage
delivery either.

**So the importer must write the object form.** The previous pure mapper writes
`string[]`, which would reproduce V1's limitation exactly — that is the real
content of D4-013, and it is a defect in the mapper, not in the runtime.

Frontend consumption confirmed present in `diagnostic/page.tsx` (1128 lines):
`getUserMedia`, `MediaRecorder`, `audioUrl`, `passageBody`, `textarea`, 20 timer
references, plus `diagnosticSpeakingRecorderLogic.ts` with its own tests.

**Metadata helpers existing is not proof of delivery.** Required contract tests
(B1): a mapped Listening row yields a non-empty `audioUrl`; a mapped Reading row
yields its passage body; a Speaking task yields prompt + prep/response seconds;
a Writing task yields prompt + word bounds; and none of the four payloads
contains a key, a rationale or a script.

---

## 7. D5-001 — authoring metadata confidentiality

**Import side — verified.** `internalLabel` is on `AUTHORING_ONLY_FIELDS`
(`v2-import-mapper.ts:27`) alongside `answerRationale`,
`distractorRationales`, `constructRationale`, `diagnosticUse` and others.
`assertNoAuthoringFields` throws on any of them **and** on any key that is not a
real `DiagnosticQuestion` column. 37 mapper tests cover it, including negative
fixtures. `D5_001_IMPORT_METADATA_EXCLUSION_VERIFIED=true`.

**Delivery side — the question the spec asks me to answer with a fact, not an
invention:**

> **No direct-artifact delivery route exists.** `grep` across runtime `src/`
> for the content-artifact paths returns exactly one hit — a comment inside the
> mapper itself. Nothing in the running application reads
> `entry-diagnostic-v2-content-draft.json`.

So the only way authoring metadata can reach a learner is if the **importer**
writes it into a served column, and the mapper's allowlist is what prevents
that. The residual risk is a future delivery path, not a present one.

The labels genuinely are answer-bearing — verified:

```text
LST_CLIP_04.internalLabel  "Presentation that did not go to plan"
LST_Q_009 key              "A technical problem spoiled their plan"
RDG_PASSAGE_02.internalLabel "Why rereading notes feels better than it works"
RDG_Q_004 key                "Rereading feels effective but recalling from memory works better"
```

**Not renaming them.** The protection is the data boundary, as the spec says.

**Required test (B1), beyond the mapper unit test:** take every learner-facing
Diagnostic payload produced from imported rows — question delivery, attempt
start, submit, result — and assert that no `internalLabel` value, no
`answerRationale`, no `distractorRationales` entry and no clip `script` appears
anywhere in the serialised response, before an authorised review state.

---

## 8. D5-002 — floor terminology

```text
D5_002_DECISION=KEEP_AS_APPROVED
```

I disagree with the cold reviewer here, and the spec is right that coexistence
is not automatically an inconsistency.

The script says *"The **second-floor** power supply is being rewired, so the
computer room up there stays closed"* and *"The **ground-floor** group study
rooms and the language lab are open as usual."*

**"Ground floor" is standard American English.** What differs between the
varieties is the floor *above* it: American usage treats ground floor and first
floor as the same level, with the next level up called the second floor. So
ground floor + second floor is coherent AmE — level 1 and level 2, no missing
floor. The British reading would make it level 1 and level 3, which is still
unambiguous, merely different.

More decisively: **no item depends on the relationship between the two floors.**
`LST_Q_003` asks which area is closed; the learner distinguishes *rooms*, not
floor arithmetic. The distractor set (language lab, south-side elevators, main
entrance) contains no floor computation either.

Editing an approved, hash-frozen script to chase a non-issue carries more risk
than the non-issue. No edit before TTS.

---

## 9. D5-003 — rubric identifiers

```text
D5_003_IDENTIFIERS_UNCHANGED=true
```

`criterionKey: "organisation"` / `"task_fulfilment"` stay as they are — the
decision already recorded in Step 2C4 (D3-007). They are the field names the AI
grader must emit, cross-referenced consistently with each rubric's
`aiGradingRequirements.requiredFields`.

The mapping preserves them unchanged: the importer writes the rubric's
`criteria` as the authored Json snapshot, so identifier and learner-facing
anchor wording travel together and neither is rewritten. Learner-facing rubric
wording is a separate concern and is not touched.

---

## 10. Permutation — one current runtime defect

```text
@Post(':id/attempts')
body: { answers?: unknown; submissionToken?: string; attemptId?: number }
```

**`attemptId` is client-supplied and optional.** Verified in the controller.

Five production call sites of `isDiagnosticAnswerCorrect`
(`diagnostic.logic.ts:305`; `diagnostic.service.ts:343, 823, 1048, 1096`). At
`:1048` and `:1096` the permutation is
`attemptId && !isOpen ? getAttemptQuestionPermutation(...) : undefined`, so when
the client omits `attemptId` the function falls through to
`answer === question.correctIndex` — comparing a **display** index against an
**authored** index. It fails open and mis-grades silently.

The permutation itself is **not stored**: it is derived deterministically from
`(attemptId, questionId, optionCount)`. That is fine — it is reproducible — but
it means the attempt id is the entire authority, and it currently arrives from
the client.

```text
PERMUTATION_RUNTIME_DEFECT = present, independent of import readiness
```

**Minimum correct change:** resolve the attempt server-side from the
authenticated user and the assessment, verify ownership, and use that attempt's
id. For an MCQ with more than one option, a missing or invalid permutation
becomes an **error**, not a fallback — return a discriminated "cannot grade"
rather than a boolean.

**Tests must call the real grading function.** My own Step 2C4 suite asserts
`perm[displayed] === correctIndex`, which is a tautology about the array and
never invokes the grader; it must be replaced. Required cases: correct,
incorrect, all 24 permutations of a four-option item, missing permutation,
invalid permutation, missing attempt, ownership mismatch, duplicate submit.

---

## 11. Reuse — do not rebuild

| component | verdict |
|---|---|
| `DiagnosticSpeakingService` (`confirmRecording`/`skip`/`list`/`audio`, ownership-scoped) | reuse as-is |
| `DiagnosticSpeakingAudioNormalizer` (webm/opus → 16k mono wav) | reuse as-is |
| `DiagnosticWritingService` (`enqueueMany`/`retry`, async) | reuse as-is |
| `DiagnosticAttempt` (`resultState`, `overallScore` null-never-zero, version pinning) | reuse as-is |
| `diagnostic/page.tsx`, `diagnosticSpeakingRecorderLogic.ts` | reuse; verify against real backend |
| R2 storage, BullMQ/Redis, Gemini client, Azure Speech | reuse; build no duplicate media system |

Targeted adjustments only: wire the productive services to V2 content and to
`DiagnosticSkillResult`. **No frontend redesign in B0**, and the later UI phase
must inspect what is already installed before implementing.

---

## 12. Phase B1 — isolated rehearsal plan

**Target: a throwaway PostgreSQL 15 container on a third port, created for the
rehearsal and destroyed after. Never `kltn_db` (5432). Never `kltn_shadow`
(5433).** `kltn_shadow` is Prisma's shadow database and is excluded as a test
target precisely because the original incident came from confusing the two.

Before any command: print the resolved `DATABASE_URL` and
`SHADOW_DATABASE_URL`, assert the rehearsal URL matches neither, and assert the
target port is the rehearsal port.

```text
B1-1  bring up an isolated PG15, apply the current migration history
B1-2  seed a V1-shaped fixture (1 assessment, 20 questions, some attempts)
      — a FIXTURE, never a dump of kltn_db
B1-3  apply the additive migration; assert 3 columns + 3 unique indexes added,
      0 columns dropped, 0 types changed, V1 fixture rows byte-unchanged
B1-4  review the generated SQL for destructive statements; fail on any
B1-5  run the importer; assert the full post-import assertion set (§3)
B1-6  run the importer AGAIN; assert 0 rows changed, 0 duplicates
B1-7  force a mid-transaction failure; assert full rollback and that no
      partially imported assessment is selectable
B1-8  assert DRAFT is not served: getCurrentAssessment still returns the V1
      fixture; starting an attempt on the DRAFT id is refused
B1-9  reference integrity: every question resolves passage/rubric/clip
B1-10 rollback the migration; assert the V1 fixture still loads and serves
```

Acceptance: B1-3 through B1-10 all pass, with B1-6 and B1-7 the two that
actually decide whether a live import may ever be proposed.

---

## 13. Gate to a live database change

```text
B0 preflight PASS                      ← this document
B1 isolated rehearsal PASS             ← not started
migration SQL reviewed for destructive statements
connection target verified by printed URL, not by variable name
protected checkpoint verified to exist and restore
rollback/recovery strategy documented and exercised in B1
explicit user authorisation for the live phase
```

All six remaining gates are open. Prefer a minimal additive migration and a
single transactional import. **Never reset or recreate the database.**

---

## 14. Remaining blockers

```text
GAP-1 schema identity            → designed here, not applied
IMPORTER_IMPLEMENTED=false       → no importer exists at all
D4-011 lifecycle                 → designed, not implemented
D4-012 validation                → designed, not implemented
D4-013 object-form options       → designed, not implemented
permutation fail-open            → CURRENT RUNTIME DEFECT, independent of import
DEF-004 result bands             → OPEN; blueprint declares levelSystem
                                   UNRESOLVED_DO_NOT_IMPLEMENT
DEF-003 en-US TTS voice          → unconfirmed; blocks Phase E
LST_CLIP_03 / 04 voice casting   → undecided; blocks Phase E
IR-017 instruction language      → blocks activation only
```

## 15. B0 decision

**B0 ACCEPTED as a planning phase.** The schema proposal is minimal and
additive, the identity design is narrower than previously thought because two
tables already carry sufficient constraints, the clip cardinality question is
resolved without a migration, and the one genuinely new discovery — that
`attemptId` is client-supplied — is a present runtime defect rather than an
import blocker.

**STOP.** Next is Phase B1 on an isolated PostgreSQL 15, not a live migration.
