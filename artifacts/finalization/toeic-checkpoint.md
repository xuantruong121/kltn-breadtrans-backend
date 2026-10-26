# TOEIC exam types — checkpoint 2026-10-26

BreadTrans creates original practice material that simulates the TOEIC structure. It is not ETS, issues
no certificate, and its scores are internal practice indicators (`docs/toeic-product-contract.md`).

## The three types (source of truth: schema + kltn_db, read-only)

| Type | How it is built | Learner-visible content |
|---|---|---|
| TOEIC Listening & Reading | `ToeicExamSet` 1 "TOEIC 2 Skills: Listening & Reading — Đề luyện tập 01", FULL_TEST, 7200 s, PUBLISHED | 1 full test |
| TOEIC Speaking & Writing | `ToeicAssessment` 1 (`TOEIC_SW`): Speaking set `exam-3-speaking` + Writing set 1 | 1 test |
| TOEIC 4 Skills | `ToeicAssessment` 2 (`TOEIC_4_SKILLS`): L&R exam set 1 + `exam-4-speaking` + Writing set 2 | 1 test |

`ToeicExamSet` 2 "Practice by Part" is DRAFT with one item per part (not learner-visible). A "4 Skills"
combination is a BreadTrans product, not a separate ETS examination.

## Content against the ETS structure

| Item | ETS structure | Stored | State |
|---|---|---|---|
| L&R parts 1–7 | 6 / 25 / 39 / 30 / 30 / 16 / 54 = 200 | identical, numbered 1–200 | COMPLETE_AND_VERIFIED |
| Part 2 options | 3 | 3 on all 25 | COMPLETE_AND_VERIFIED |
| Answer keys / explanations | — | 200/200 keys in range, 200/200 explanations, keys spread 62/45/47/46 | COMPLETE_AND_VERIFIED |
| L&R media | audio parts 1–4, photos part 1 | 54 audio + 6 images, all 60 URLs HTTP 200 | COMPLETE_AND_VERIFIED |
| Speaking tasks | 2 read aloud, 2 picture, 3 respond to questions, 3 respond using information, 1 opinion | identical in both sets (11) | COMPLETE (content) |
| Writing tasks | 5 picture sentences, 2 email responses, 1 opinion essay | identical in both sets (8) | COMPLETE (content) |

Notes: the 4 Skills Speaking and Writing sets reuse the same prompts as the S&W test (one authored
test, used twice). The respond-to-questions tasks have no question audio stored (ETS plays them aloud).
All speaking recordings are capped at 45 s (ETS allows 60 s for the opinion task).

## Defects fixed in this checkpoint

| # | Defect | Effect before | Fix |
|---|---|---|---|
| T-1 | Speaking daily limit of 10 recordings for every plan, counting exam recordings | the 11-task Speaking section of S&W and 4 Skills could not be finished by anyone | `speaking.service.ts`: practice and exam (EXAM_INTERNAL sets) have separate daily quotas, 10 and 33; exam recordings no longer use the practice allowance |
| T-2 | Exam Writing tasks have no practice topic and `isWritingQuiz` required one | every exam Writing task (16 quizzes) answered "Quiz not found"; the Writing section of S&W and 4 Skills was unusable | `writing.service.ts`: a task of a TOEIC writing set counts as a Writing task; access still restricted to a valid exam attempt |
| T-3 | Legacy Speaking poller ignored `MOCK_AZURE_SPEECH` | Speaking could not be graded on the test harness | `speaking-worker.service.ts`: mock only when explicitly enabled, never in production; provider labelled `mock` |
| T-4 | Writing completion error said "theo Set #2" for every set | misleading message | generic message |
| D-1 | Entry Diagnostic advice linked exam-internal Writing quizzes 34/36 | links answered 404 | catalog excludes exam writing tasks; links now 17 / 4 / 19; all 18 cited routes open for a FREE learner |

Tests: speaking + toeic + writing + diagnostic suites pass (254 + 16 + 418); tsc and lint clean.

## Runtime evidence (disposable harness)

- L&R: HTTP 20/20 and browser journey from checkpoint 2 (start, autosave, server deadline, no key leak,
  section lock, result, review, history); listening transcripts and Part 1–2 texts are withheld during
  the test (verified in code).
- S&W and 4 Skills (`scripts/qa/finalization-toeic-sw-api.ts`, 15/15 each): attempt start, 11 recordings
  uploaded and graded (mock evaluator), Speaking component completes, another learner gets 403, Writing
  component starts and serves its 8 tasks, a Writing task without Gemini is refused (503, nothing scored),
  Writing cannot complete without 8 graded tasks, attempt stays IN_PROGRESS.
- Browser: the exam Writing tasks open inside an attempt (picture task 29, essay 36).

## Gaps preventing full real use

1. NEEDS_REAL_PROVIDER: Writing in S&W / 4 Skills is graded by Gemini (8 tasks per test). Not run for
   TOEIC. Bounded proposal: one Writing section on the harness, at most 12 Gemini requests.
2. NEEDS_REAL_PROVIDER: TOEIC Speaking real grading (Azure, 11 recordings per test) — best covered by
   the owner's own trial; F0 audio allowance is ample, but recordings need a human voice.
3. The 4 Skills L&R component was not run end to end inside the parent attempt in this checkpoint (the
   L&R runtime itself is verified).
4. Design gaps against ETS (no question audio for respond-to-questions, 45 s cap) — content/product
   decisions, not fixed here.
