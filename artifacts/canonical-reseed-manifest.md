# Canonical reseed manifest — BreadTrans dev reconstruction (2026-10-23)

State captured immediately after the controlled reseed of `kltn_db`. Use this
as the input for the next reconstruction pass.

## Reconstruction source map

| Runtime entity | Canonical ID/key | Creation source | Seeded? | Needs post-seed work |
| --- | --- | --- | --- | --- |
| Admin user | `admin@breadtrans.com` | `prisma/seed.ts` (`user.upsert`) | yes | no |
| Students (12) | seeded emails | `prisma/seed.ts` | yes | no |
| Courses (8) / Lessons (64) / Classes (8) | seeded names | `prisma/seed.ts` | yes | no |
| Vocab (353) / Grammar (12) / Market (12) | seeded | `prisma/seed.ts` | yes | no |
| TOEIC L&R content set | `ToeicExamSet id=1` (FULL_TEST, 200 q) | `prisma/seed.ts` (`toeicExamSet.upsert`) | **yes** | publish + audio |
| TOEIC practice-by-part set | `ToeicExamSet id=2` | `prisma/seed.ts` | yes | publish |
| Exam 1 Listening audio | `toeic/exams/1/groups/{1..54}.mp3` | `scripts/materialize-toeic-listening-media.ts` | **no** | **regenerate (Phase 0 semantics)** |
| Exam 1 Part 1 images | `catalog/toeic/shared/images/*.png` | seed URL reference → existing R2 objects | yes (URL) | none — 10/10 objects exist |
| Generic product `Exam` rows | `Exam 1`, `Exam 22`, `Exam 23` | **admin runtime only** (`generic-exam.service.ts`) | **no** | **manual/API reconstruction** |
| `ToeicAssessment` rows | `Assessment 15` (S&W), `16` (4 skills) | **admin runtime only** (`toeic-assessment.service.ts`) | **no** | **manual/API reconstruction** |
| Speaking exam source set | `exam-22-speaking` (`SpeakingPracticeSet`) | admin runtime / AI apply | **no** | **manual/API reconstruction** |
| `ToeicWritingSet` (Writing Set 2) | id=2 | admin runtime | **no** | **manual/API reconstruction** |
| Exam 69 (AI draft) | `Exam 69` → `ToeicExamSet 86` | AI generation pipeline | **no** | **DEFERRED** (media survives, see below) |

## Post-reseed verified counts (`kltn_db`)

```
User=14  Course=8  Lesson=64  Class=8  Quiz=28  VocabWord=353
ToeicExamSet=2  ToeicQuestionGroup=81  ToeicQuestion=225  ToeicAttempt=1
Exam=0  ToeicAssessment=0  ToeicWritingSet=0  SpeakingPracticeSet=0
SpeakingExercise=30  _prisma_migrations=66 (history repaired)
```

## Exam 1 structure gate

| Check | Result |
| --- | --- |
| Part counts 6 / 25 / 39 / 30 / 30 / 16 / 54 | **PASS** |
| Total questions = 200 | **PASS** |
| Listening groups = 54 | **PASS** |
| Part 1 image references = 6 | **PASS** (R2 objects all exist) |
| Listening audio references | **FAIL — 0 / 54** (`audioUrl` NULL) |
| `publicationStatus` | `DRAFT` (seed never publishes) |
| `examId` (generic Exam wrapper) | `NULL` |
| `validateToeicExam().learnerReady` | **false** (54 × MISSING_AUDIO) |

## R2 asset status (read-only audit; nothing mutated)

Bucket inventory: **1080 objects**. Nothing was uploaded, copied or deleted.

| Prefix | Objects | Size | Reconstruction value |
| --- | --- | --- | --- |
| `vocab/pronunciation/` | 706 | 19.5 MB | vocabulary audio, referenced by seed data |
| `ai/toeic-exams/` | 108 | 30.5 MB | **Exam 69 media** (see forensics) |
| `toeic/exams/` | 58 | 11.0 MB | Exam 1 (54) + Exam 2 (4) legacy audio — **obsolete semantics** |
| `catalog/listening/` | 53 | 38.4 MB | listening practice assets |
| `catalog/courses/` | 44 | 13.3 MB | course media |
| `catalog/toeic/` | 10 | 19.9 MB | **all 10 seed-referenced TOEIC images exist** |
| `catalog/speaking/`, `speaking/*` | 46 | ~5 MB | speaking stimuli + learner audio |
| others | ~55 | — | diagnostic, market, uploads, courses/17 |

### Why surviving Exam 1 audio must NOT be reused

`scripts/materialize-toeic-listening-media.ts` composed those objects
(2026-10-09) with pre-Phase-0 semantics:

- Part 1: `options.join(' ')` — four statements with **no A/B/C/D labels**;
- Part 2: `[passage, ...options].join(' ')` — **no A/B/C labels**;
- Part 3/4: `text: passage` only — **no spoken question prompts**.

Phase 0 requires `A. <statement>` labels (SSML `say-as` letter names) and
Part 3/4 conversation **plus** spoken question prompts. The object→group
mapping is deterministic (`toeic/exams/1/groups/{groupId}.mp3`, and a fresh
seed recreates group ids 1..54), so mapping is PROVEN, but the **content is
semantically obsolete** → regenerate via `buildToeicListeningAudioScript`.

Note: the legacy script wrote `scriptHash`, a field the current readiness
validator does not inspect, so reused legacy audio would *silently pass*
readiness while being wrong. Do not reuse it.

## Exam 69 surviving assets (inventory only — reconstruction DEFERRED)

Full manifest: `artifacts/exam69-r2-forensics.json`

```
108 objects under ai/toeic-exams/exam-86/groups/{1671..1764}/
  54 × audio-regenerated.mp3  → PROVEN, Phase-0-corrected (2026-10-23 05:xx)
  54 × audio.mp3              → PROVEN mapping, pre-Phase-0 semantics (03:24)
   0 × Part 1 images          → never generated (provider outage)
```

Confidence: **PROVEN** — keys deterministically encode `toeicExamSetId=86` and
the exact `groupId`s written by `toeic-ai-exam.service.ts`. No timestamp-only
inference was used. Do not delete these objects.

## Seed destructive operations (10 total)

| Line | Operation | Scope | Classification |
| --- | --- | --- | --- |
| 1382 | `payment.deleteMany` | payments of enrollments of "old" classes | **UNSAFE_ON_POPULATED_DB** |
| 1386 | `class.deleteMany` | **every Class whose name is not a seeded offering** | **UNSAFE_ON_POPULATED_DB** |
| 6594 | `speakingSubmission.deleteMany` | id IN (300,301,302) **and** seed audioUrl | SAFE_SCOPED_SEED_CLEANUP |
| 7737 | `vocabWord.deleteMany` | reserved system topic, id NOT IN seeded | SAFE_SCOPED_SEED_CLEANUP |
| 7772 | `vocabWord.deleteMany` | id range `>= n && <= 72` | QUESTIONABLE (id-range assumption) |
| 7775 | `vocabTopic.deleteMany` | id range `> n && <= 6` | QUESTIONABLE (id-range assumption) |
| 8300 | `grammarQuestion.deleteMany` | id range `>= n && <= 30` | QUESTIONABLE (id-range assumption) |
| 8357 | `toeicQuestionGroup.deleteMany` | `examId = 1` (whole set rebuild) | SAFE for reconstruction / **UNSAFE_ON_POPULATED_DB** |
| 11555 | `toeicQuestionGroup.deleteMany` | `examId = 2` | SAFE for reconstruction / **UNSAFE_ON_POPULATED_DB** |
| 11605 | `toeicAttempt.deleteMany` | examId=1 + first 4 seeded students | SAFE_SCOPED_SEED_CLEANUP |

`npm run db:seed:safe` refuses to run when any of these would destroy
existing data, unless `--reconstruct` is passed.

## Seed idempotency

| Domain | Mechanism | Repeat-safe? |
| --- | --- | --- |
| User, Course, Lesson, Quiz, Question, VocabWord/Topic, Grammar, Market, GameSettings, UserStats | `upsert` | yes |
| `ToeicExamSet` 1 & 2 | `upsert` (fixed ids 1, 2) | yes |
| `ToeicQuestionGroup` / `ToeicQuestion` | scoped `deleteMany` + `create` | rebuilt each run — **row ids shift upward each run** |
| `ToeicAttempt` (seeded sample) | scoped `deleteMany` + `create` | rebuilt each run |
| `Class` | name-based `deleteMany` + `upsert` | **not safe on populated DB** |
| `SpeakingExercise` / stimulus | `upsert` in loops | yes |

**Consequence for media:** because TOEIC groups are deleted and recreated, the
`toeic/exams/1/groups/{id}.mp3` key convention only lines up with group ids
`1..54` on the **first** seed run after a fresh reset. Any later seed re-run
shifts ids and breaks naive key reuse.

## Remaining work for the next pass

1. Update `scripts/materialize-toeic-listening-media.ts` to compose through
   `buildToeicListeningAudioScript` (Phase 0 semantics), then materialize
   Exam 1's 54 Listening audio objects (54 Azure TTS calls).
2. Publish `ToeicExamSet` 1 and 2 (`publicationStatus = PUBLISHED`).
3. Recreate the generic product layer via the admin API: `Exam` wrappers,
   `ToeicAssessment` 15/16, `exam-22-speaking` set, `ToeicWritingSet` 2.
4. Re-run `toeic.race.integration.spec.ts` — Exam 1 learner-ready should flip
   to true once (1) and (2) are done.
5. Fix the post-reseed id collision in
   `src/modules/speaking/speaking-reward-forced-crash.integration.spec.ts`
   (it hardcodes a `SpeakingExercise.id` now taken by seeded rows).
6. Exam 69: rebuild DB rows, then attach the 54 PROVEN
   `audio-regenerated.mp3` objects; Part 1 images still need the image
   provider to recover.
