# Entry Diagnostic V2 — schema / versioning design (Step 1)

Migration: `20261025054012_diagnostic_v2_schema_foundation`
Applied: rehearsal (isolated PG15 restored from the pre-change backup), then live dev DB.
Additive only — no `DROP`, no type change, no `SET NOT NULL` on existing columns.

---

## 1. What existed before

| Model | Shape | Gap for V2 |
|---|---|---|
| `DiagnosticAssessment` | id, title, description, isActive, timestamps | no scoring/blueprint/content version; no publication lifecycle |
| `DiagnosticQuestion` | assessmentId, `skill` (free string), question, `options` Json, `correctIndex`, explanation, order | no task type, no audio, no passage, no rubric, no subskill/level |
| `DiagnosticAttempt` | answers Json, correctCount, totalCount, percentage, level, status String, submissionToken | no version pinning; no per-skill results; no nullable overall |
| `DiagnosticSpeakingResponse` | audioKey, durationMs, transcript, score, scoreMetadata, provider, graderVersion, gradingAttempts, failureReason, status String | no rubric identity, no provider version |
| `ListeningDiagnosticClip` | questionId → **`Question`** (quiz model), label, key, url, startMs/endMs | **not a Diagnostic model despite the name** — belongs to the quiz subsystem |
| Writing persistence | hidden in `DiagnosticAttempt.answers.__writingFeedback` | not queryable, no grading state, no rubric identity |

Two pre-existing facts that shaped the design:

- **One-active was already enforced.** Migration `20261022130000_enforce_single_active_diagnostic` created a partial unique index on `("isActive") WHERE "isActive" = true`. At most one row can be current. This also means the historical `ORDER BY id DESC` in `getCurrentAssessment` can only ever see one candidate — it is not a live ambiguity. **Correction to the earlier audit, which flagged it as "highest id wins".**
- **There is no generic media model.** Every media-bearing subsystem owns its own table (`QuizAudioAsset`, `CourseLessonMedia`, `ListeningAudioArtifact`). A Diagnostic-owned clip table therefore follows the existing convention rather than duplicating an abstraction.

---

## 2. New enums

| Enum | Values | Why |
|---|---|---|
| `DiagnosticAssessmentStatus` | DRAFT, READY, ACTIVE, ARCHIVED | publication lifecycle V2 authoring needs; V2 stays DRAFT until readiness passes |
| `DiagnosticTaskType` | MCQ, OPEN_TEXT, SPEAKING_RESPONSE, WRITING_RESPONSE | authoritative objective-vs-productive discriminator. DIAG-001 was caused by inferring this from the skill label; DIAG-008 by inferring from option metadata |
| `DiagnosticSkill` | LISTENING, READING, SPEAKING, WRITING, LANGUAGE_USE | queryable skill dimension; `LANGUAGE_USE` is auxiliary (weight 0) |
| `DiagnosticGradingStatus` | NOT_SUBMITTED, SUBMITTED, QUEUED, GRADING, GRADED, GRADING_FAILED | a null score must not mean "not graded", "queued" and "failed" at once |
| `DiagnosticCompletionState` | NOT_STARTED, IN_PROGRESS, PENDING_GRADING, COMPLETE, GRADING_FAILED | used for the attempt and per skill; gates whether an overall figure may exist |

---

## 3. Fields added to existing models

### `DiagnosticAssessment`
| Field | Type | Purpose |
|---|---|---|
| `scoringVersion` | String, default `'OBJECTIVE_POOLED_V1'` | **persisted** scorer identity. Production reads this; nothing else selects the algorithm |
| `blueprintVersion` | String? | which content blueprint the form implements — separate from scoring, since one scorer may later serve several forms |
| `contentVersion` | Int, default 1 | bumped when content/media is revised without changing scoring semantics |
| `status` | `DiagnosticAssessmentStatus`, default ACTIVE | publication lifecycle |

`isActive` is retained and marked deprecated. It remains the authoritative learner-current selector because its unique index already enforces the invariant. The two are tied by a check constraint (§5) so they cannot diverge.

### `DiagnosticQuestion` (all optional — V1 rows untouched)
`taskType` (default MCQ), `skillCode`, `subskill`, `intendedLevel`, `difficulty`, `instructions`, `prepSeconds`, `responseSeconds`, `wordMin`, `wordMax`, `passageId` → passage, `rubricId` → rubric.

- `skill` (free string) is kept for V1; V2 authors `skillCode`.
- `correctIndex` is deliberately **not** made nullable: making it optional would ripple through `diagnostic.logic.ts` and its callers. Productive tasks store `-1`, and `taskType` is the discriminator — `correctIndex` must never be used to infer item kind.
- `subskill` is a constrained string, not an enum: the authored subskill set will grow with content and an enum would force a migration per term.
- `intendedLevel` / `difficulty` are **content metadata only** and must never select a scoring algorithm (DIAG-008 regression guard).

### `DiagnosticAttempt`
`scoringVersion`, `blueprintVersion`, `contentVersion` (version pinning), `resultState` (default IN_PROGRESS), `overallScore Float?`.

`overallScore` is nullable by design: while any required skill is incomplete it stays **null**, never 0. Existing `percentage`/`correctCount`/`totalCount`/`level` are untouched so V1 results read exactly as before.

### `DiagnosticSpeakingResponse`
`rubricId` → rubric, `rubricVersion`, `providerVersion`. Its `status` stays a String to avoid converting a populated column; the canonical value set is the `DiagnosticGradingStatus` vocabulary. New productive tables use the enum directly.

---

## 4. New tables

| Table | Key fields | Notes |
|---|---|---|
| `DiagnosticReadingPassage` | assessmentId, title?, text, order | 10 Reading items share 3 passages; text stored once, not duplicated per question |
| `DiagnosticListeningClip` | questionId, version, isActive, storageKey, url, mimeType, durationMs, byteSize, **script**, **scriptSha256**, audioSha256, voice, locale, accent, generationSource | `@@unique([questionId, version])` + `isActive` follows the `QuizAudioAsset` precedent. Both hashes bind audio to the words it was generated from, so the relationship is provable rather than inferred from a filename |
| `DiagnosticRubric` | skill, rubricVersion, criteria Json, maxScore, isActive | `@@unique([skill, rubricVersion])`. `criteria` is a snapshot so "which rubric graded this response?" stays answerable after a revision |
| `DiagnosticWritingResponse` | userId, assessmentId, attemptId, questionId, taskKey, status, responseText, wordCount, score, scoreMetadata, rubricId/rubricVersion, provider/providerVersion/graderVersion, gradingAttempts, failureReason, rawProviderPayload | replaces `answers.__writingFeedback`. `scoreMetadata` holds validated structured dimensions; `rawProviderPayload` is an optional audit copy and never the only structured state |
| `DiagnosticSkillResult` | attemptId, skill, status, score?, band?, itemsScored?, itemsTotal? | `@@unique([attemptId, skill])`. V2's primary output is the profile, so each skill carries its own score/band/state relationally. `band` stores an **internal band key only** — no CEFR code is stored or derived |

---

## 5. Listening script privacy

`script` lives on `DiagnosticListeningClip`, not in the question's learner payload. A service projection can therefore serve the item without the transcript and reveal it later if product design allows. The schema makes withholding possible; the projection is Step 2+ work.

---

## 6. Active-assessment selection

```sql
-- pre-existing, authoritative, left untouched
CREATE UNIQUE INDEX "DiagnosticAssessment_single_active_key"
  ON "DiagnosticAssessment" ("isActive") WHERE "isActive" = true;

-- added: one truth, two representations
ALTER TABLE "DiagnosticAssessment"
  ADD CONSTRAINT "DiagnosticAssessment_status_matches_isActive"
  CHECK (("status" = 'ACTIVE') = "isActive");
```

A second partial unique index on `status` was written first and then **removed**: two independent guarantees would have permitted `status='ACTIVE'` with `isActive=false`, which is the two-sources-of-truth problem this design exists to avoid. Verified in rehearsal: a second ACTIVE row is refused by the pre-existing index, a divergent row is refused by the check, and a V2 DRAFT inserts cleanly.

---

## 7. Versioning semantics

```text
V1   scoringVersion   = OBJECTIVE_POOLED_V1      (column default; backfilled)
     blueprintVersion = V1_LEGACY_20_ITEM        (backfilled in-migration)
     contentVersion   = 1
     status           = ACTIVE

V2   scoringVersion   = FOUR_SKILL_PLACEMENT_V2  (Step 2 authoring)
     blueprintVersion = V2_2026_01
     status           = DRAFT  until the readiness guard passes
```

Production resolves the scorer with `resolvePersistedScoringVersion(assessment.scoringVersion)`, which takes **only the stored string** — arity 1, so no id, title, count or item metadata can reach the decision. It fails closed on an absent, unknown, or known-but-unimplemented version. `FOUR_SKILL_PLACEMENT_V2` is listed as known-unimplemented, so a V2 form authored before its scorer exists is refused rather than scored by the V1 algorithm.

Attempts copy the three versions at creation, so a later form or scorer cannot reinterpret a historical result.

---

## 8. Submission / grading lifecycle (for Step 2)

```text
objective item        answered -> scored inline by the pinned scorer

productive task       NOT_SUBMITTED -> SUBMITTED -> QUEUED -> GRADING
                        -> GRADED            (score + validated scoreMetadata + rubricVersion)
                        -> GRADING_FAILED    (failureReason; never a 0 score)

skill (DiagnosticSkillResult)
                      NOT_STARTED -> IN_PROGRESS -> PENDING_GRADING
                        -> COMPLETE | GRADING_FAILED

attempt (resultState) IN_PROGRESS -> PENDING_GRADING -> COMPLETE | GRADING_FAILED
                      overallScore stays NULL unless all four required skills are COMPLETE
```

---

## 9. V1 compatibility

- 1 assessment / 20 questions / 0 attempts unchanged by the migration.
- Legacy `skill` strings intact (`Grammar, Listening, Reading, Speaking, Vocabulary, Writing`); `skillCode` is NULL for every V1 row.
- All 20 questions default to `taskType = MCQ`, which is what they are.
- V1 scoring vectors re-verified after migration: 0/8/9/14/15/18/19/20 of 20, with DB == POST == GET on all ten vectors, including the two that exercise the Speaking-labelled MCQs.
- Result UI still shows internal bands, no CEFR conversion.

## 10. Step 2 inputs

Author against: `skillCode`, `taskType`, `subskill`, `intendedLevel`, `difficulty`; `DiagnosticReadingPassage` for the 3 passages; `DiagnosticListeningClip` (with `script` + `scriptSha256`) for the 4 clips; `DiagnosticRubric` for the Speaking and Writing rubrics; `correctIndex = -1` on productive tasks; the new assessment row with `scoringVersion = FOUR_SKILL_PLACEMENT_V2`, `blueprintVersion = V2_2026_01`, `status = DRAFT`.

The V2 **scorer** is not implemented yet, by design — `resolvePersistedScoringVersion` will refuse a V2 form until it is.
