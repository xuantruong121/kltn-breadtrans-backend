# Grammar publication readiness (decision record)

**Status: NOT PUBLISHED. Live publication is not authorized.** Nothing in `kltn_db` was changed.

## Baseline (read-only, `kltn_db`, 2026-10-26)

| Item | Value |
|---|---|
| `GrammarTopic` rows | 12, all `publicationStatus = DRAFT` |
| `GrammarQuestion` rows | 60 (5 per topic) |
| `GrammarAttempt` / `UserGrammarReward` | 3 / 3 (history from an earlier period; preserved by unpublish) |
| `CourseActivity.grammarTopicId` references | 0 |
| Content identity live vs clone | identical: question-row md5 `264600888cf48fbaf74c313896a6196c`; topic content md5 `dbead0030ce7e767f08cabd9d8ad05dd` (title, description, keyFormula, level) |

## Verification on the disposable clone

- The existing Admin action `POST /grammar/topics/:id/publish` (readiness checks: at least one
  question, non-empty text, ≥ 2 options, `correctIndex` within range) returned **201 for all 12
  topics**.
- With all 12 published, a learner sees 12 topics. Each opens with 5 questions and no answer key.
  Attempts score from the stored keys and reward the first completion once (`finalization-grammar-vocab-api.ts`,
  `finalization-practice-browser.ts`).
- `POST /grammar/topics/:id/unpublish` returns the topic to DRAFT, the learner gets 404, and the
  learner's attempt history is kept. Re-publishing works.
- Learner rejected: a STUDENT calling publish gets 403.

## Content review (all 60 questions, by hand)

Prompt, options, key and explanation checked for every question.

| Topic | Title | Verdict | Note |
|---|---|---|---|
| 1 | Present Simple & Adverbs of Frequency | READY | Q4 "My colleagues ___ lunch … most days": *had* is also grammatical as a past habit. The habit cue makes *have* the expected answer. Advisory only. |
| 2 | Past Simple & Time Expressions | **BLOCKED** | **Q9 (id 9)** "The store ______ early because of the storm." Key *closed*, but option *is closing* is equally natural with no time cue, and a learner choosing it is marked wrong (confirmed on the clone). |
| 3 | Present Perfect | READY | — |
| 4 | Future Forms | READY | — |
| 5 | Parts of Speech | READY | — |
| 6 | Modals & Polite Requests | READY | — |
| 7 | Passive Voice | READY | — |
| 8 | Comparatives & Quantifiers | READY | — |
| 9 | Conditionals | READY | — |
| 10 | Relative Clauses | READY | — |
| 11 | Gerunds & Infinitives | READY | — |
| 12 | Connectors & Coherence | READY | — |

No topic has a video (`videoYoutubeId` null); the UI shows "Chưa có video minh họa". That is
honest, not a blocker.

## Decision requested

- **READY_TO_PUBLISH:** 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 (11 topics).
- **BLOCKED:** 2, until Q9 is corrected. Proposed minimal correction (one row, `GrammarQuestion`
  id 9): question → "The store ______ early yesterday because of the storm."; explanation →
  "Yesterday chỉ thời điểm đã qua nên dùng quá khứ đơn: closed." Options and key unchanged. It can be
  made in the Admin grammar editor or authorized separately; it was **not** applied.
- **Expected affected rows on publish:** `GrammarTopic` only, one row per published id; columns
  `publicationStatus` (DRAFT → PUBLISHED) and `updatedAt`. No question, attempt or reward row
  changes.
- **Proposed method:** the existing Admin action (Admin → Ngữ pháp → Xuất bản), or
  `POST /grammar/topics/:id/publish` as an ADMIN. It re-runs the readiness checks per topic. Raw SQL
  is not needed.
- **Before:** take a protected checkpoint (`pg_dump -Fc` via the existing backup flow) and record
  `select id, "publicationStatus" from "GrammarTopic"`.
- **Rollback:** `POST /grammar/topics/:id/unpublish` per id (Admin "Gỡ xuất bản"). Topics return
  to DRAFT and learner attempts and rewards are kept. A full restore from the checkpoint is not
  required, and is not permission to restore into `kltn_db`.
- **After:** read-only check that exactly the authorized ids are PUBLISHED, and that a learner
  session lists them.
