# Entry Diagnostic V2 — completion report (updated 2026-10-26)

Scope: assessment id 5 (`FOUR_SKILL_PLACEMENT_V2`, 29 tasks). DEF-004 decided by the owner as **D1**
(advisory scores and evidence-based advice; no named level). Local development; demo 2026-10-29.

## Status labels

```
FOUR_SKILL_SCORER_PASS=PASS          unit 418/418 (diagnostic), harness E2E
MOCK_PIPELINE_PASS=PASS              upload, normalise, queue, worker, refresh, retry (mock grader, fake S3)
REAL_BROWSER_MOCK_E2E_PASS=PASS      full journey 44/44; skip/resume journey 14/14
RECOMMENDATION_E2E_PASS=PASS         advice built from this attempt, links open real published pages
PROTECTED_DATA_SAFETY_PASS=PASS      only id 5 contentVersion written in kltn_db (see F)
REAL_AZURE_SMOKE_PASS=PASS          1 graded Speaking task (synthetic voice), transcript near-verbatim
REAL_GEMINI_SMOKE_PASS=PASS          Speaking + Writing rubric output validated, 2 requests
REAL_GRADING_RESULT_PASS=PASS        scores, criteria and advice from the real grades (harness)
REAL_MEDIA_PLAYBACK_PASS=PASS        published clip plays in Chromium (currentTime advancing, no error)
ACTIVATION=DONE                      kltn_db id 5 ACTIVE, id 1 READY; DIAGNOSTIC_GRADER_MODE=real in .env
```

## A. Writing content (id 5, verified in the database)

| Task | Type | Prompt (learner-visible) | Instructions | Words | Rubric |
|---|---|---|---|---|---|
| WRT_TASK_01 (q 88) | short functional message | "You agreed to meet a classmate tomorrow to work on a shared assignment, but you can no longer come. Write a short message to your classmate. In your message: explain why you cannot come, suggest another time, and ask them to send you one thing you need for the assignment." | "Write 60-90 words. You have about 7 minutes." | 60–90 | WRT_RUBRIC_V3 |
| WRT_TASK_02 (q 89) | short opinion | "Your university is considering making one lecture each week available as a recording instead of teaching it in person. Do you think this is a good idea? Write your opinion and give at least two reasons for it." | "Write 90-130 words. You have about 9 minutes." | 90–130 | WRT_RUBRIC_V3 |

Grading: rubric criteria task_achievement / organisation / vocabulary / grammar, each 0–4, task score
= criteria percentage (0–100); the skill score is the mean of both tasks and exists only when both are
GRADED. The word range is guidance shown live under the text box ("vẫn được chấm" when short); length is
never a submission gate. No model-answer similarity is used. The "about N minutes" is shown as text; no
timer enforces it.

## B. Skip / incomplete behaviour

- Speaking: "Bỏ qua phần này" stores the task as `SKIPPED` (existing status).
- Writing: new "Bỏ qua bài viết này" button; the answer is sent as the empty string, which the server
  accepts as an explicit skip, stores in the attempt answers, and never grades (no grading row).
  The Writing status enum was not changed (no migration).
- Scorer reports per skill `tasksGraded / tasksPending / tasksFailed / tasksSkipped`. A skipped, pending
  or failed task never scores 0. A productive skill needs both tasks GRADED. The overall exists only when
  L, R, S and W all have scores.
- Before submitting with skipped tasks the learner sees a confirmation naming them and stating that they
  are not graded, not counted as 0, remove the overall, and cannot be redone after submission.
- Resume: objective choices and Writing text are kept locally per attempt (localStorage); Speaking
  confirmations come from the server. Verified by pausing after five answers and resuming.
- Results: Listening/Reading shown; Speaking "Đã bỏ qua"; Writing "Bỏ qua 1/2 bài"; "Điểm tổng chưa có
  vì …" names the missing skills. Browser evidence: `evidence/diag-v2-skip-run.txt` (14/14).
- Pending and failed grading: overall withheld and stored as null; "Chấm lại" for both skills; retries
  regrade through the queue (main E2E).

## C. Results and recommendations (D1)

- `diagnostic-v2-advice.ts` (pure, 16 tests): strengths and up to three priorities from this attempt's
  evidence only — wrong items grouped by each item's authored construct (Listening: gist, detail,
  purpose/intention/inference; Reading: main idea, detail, meaning in context/reference, inference) and
  the lowest rubric criteria of graded Speaking/Writing, quoting the grader's own per-criterion comments.
  Skills within 10 points (one objective item) are reported as balanced. Language Use is supplemental.
  Skipped, pending or failed skills are listed as "chưa đánh giá được", never as weak; skipped ones get a
  general-practice link labelled as such. Mock-graded evidence is flagged to the learner.
- `diagnostic-advice-catalog.service.ts`: each cited resource is checked at request time (exists,
  published, learner-facing) and marked LOCKED with the existing requirement ("Cần gói PLUS hoặc PRO",
  "Cần gói PRO") when the learner's plan does not cover it. Nothing enrols the learner.
- Resources cited (all exist and are published in kltn_db and the clone): Listening 1, 12, 23, 24, 26,
  27; Reading 2, 6, 13, 16; Writing 17, 34, 36; Speaking exercises 11, 16, 17; courses 8, 12.
- For V2 the V1 lists (score-threshold strengths, fixed Grammar-topic routes that point at DRAFT topics,
  course ranking) are no longer returned.
- Advice links use full page navigation: in a long browser session a client-side jump from the result
  page into a practice room stayed on its loading screen; a fresh load works. Root cause not identified.

## D. Real providers

Owner confirmed: Azure Speech resource on F0; the three Gemini keys' project has no billing.
Usage in total (hard caps: Azure 6 sessions / 210 s, Gemini 16 requests):

| Use | Azure sessions | Azure audio | Gemini requests |
|---|---|---|---|
| Clip coverage check (4 clips) | 4 | 119.4 s | 0 |
| Grading smoke (1 Speaking, 1 Writing) | 1 | 34.5 s | 2 |
| **Total** | **5** | **153.9 s** | **2** |
| Azure TTS (separate F0 quota) | 4 synthesis calls, ~1,692 characters | | |

Gemini requests are read from the credential manager's own counter (`gemini:telemetry:total_requests`,
incremented on every outbound attempt) on the harness Redis.

Smoke (harness, `scripts/qa/diagnostic-v2-real-grading-smoke.ts`, evidence
`evidence/diag-v2-real-grading-smoke.json`):
- Speaking SPK_TASK_01 with a **synthetic** answer (Windows "David" voice, labelled; not a person):
  GRADED 93.75; Azure transcript near-verbatim ("comfort rible" for "comfortable" is the only ASR slip);
  criteria task_fulfilment 4, intelligibility 4, fluency 4, language_use 3; the language_use comment cites
  the actual slip. A synthetic voice is not evidence of grading accuracy on learner speech.
- Writing WRT_TASK_01, synthetic message with a deliberate verb error ("my manager ask me"): GRADED 87.5,
  grammar 3 / vocabulary 3 / organisation 4 / task_achievement 4; a suggestion points at verb tense. The
  comments are generic rather than quoting the sentence.
- Defect fixed: Writing rows were labelled `gemini+azure-speech`; now `gemini` (`providerFor`).

## E. Listening media

Azure neural TTS (en-US Jenny female / Guy male, registry 2026-09-21.v1), approved casting, scripts
verbatim. Owner delegated the voice choice; neural was chosen over the offline previews for quality.
Coverage by Azure recognition: recall 99 / 98 / 99 / 95 % (misses are numbers recognised as digits and
the name "Mai"). Published: `diagnostic/v2/LST_CLIP_0{1..4}.v1.mp3` on public R2 (HTTP 200,
audio/mpeg, sizes match; publish refuses to overwrite a different existing object), 10 clip rows
active and 10 question audioUrls set, in one transaction. Backup before:
`kltn_db_DiagListening_PRE_AUDIO_PUBLISH_20261026_173411.dump`. Evidence:
`evidence/diag-v2-audio-asr-verify.txt`, `evidence/diag-v2-audio-publish.txt`.

## F. Data and activation

- kltn_db write (authorized): `DiagnosticAssessment` id 5 `contentVersion` 1 → 6 via
  `artifacts/entry-diagnostic-phase-c3-content-version-fix.sql`. Guards held (sysid 7674533776495505443,
  sourceKey, DRAFT, inactive, version 1); UPDATE 1. Before/after diff: only that field. Question hashes of
  id 1 and id 5 unchanged; id 1 still ACTIVE. Backups: automatic dump 14:06 and a table dump
  `.local-backups/breadtrans-auto/kltn_db_DiagnosticAssessment_PRE_CV_FIX_20261026_172153.dump`.
  Rollback: set it back to 1 for id 5. Log: `evidence/content-version-fix-run.txt`.
- Activation: `artifacts/entry-diagnostic-v2-activation.sql` (guards: id 5 DRAFT/inactive/v6/V2, id 1
  ACTIVE, 10 active clips matching question URLs; single active assessment afterwards). Rehearsed on the
  clone: activate, re-run aborts, rollback, activate. Run on kltn_db: id 5 ACTIVE, id 1 READY. Backup
  `kltn_db_DiagnosticAssessment_PRE_V2_ACTIVATION_20261026_174755.dump`. Rollback:
  `artifacts/entry-diagnostic-v2-activation-rollback.sql`.
- `.env`: `DIAGNOSTIC_GRADER_MODE=real` (copy of the previous file in `.local-backups/`). The running
  backend must be restarted to read it.

## G. Testing

Backend diagnostic 418/418; FE `test:ci` 638/638; FE and backend tsc clean; lint 0 errors on changed
files. Browser E2E on the disposable harness (clone DB, Redis 6392, fake S3, mock grader): main 44/44,
skip/resume 14/14. Cross-account: another learner cannot read the result or retry its grading.

## H. Demo status: DEMO_READY

Verified after the owner restarted `npm run dev:backend` (17:58, after the .env change at 17:47): one
consumer per queue on Redis 6379, no standalone worker (legacy mode). Advice links re-checked: the two
exam-internal Writing quizzes were replaced; all 18 cited routes open for a FREE learner.

Honest limitations:
- Real grading was smoke-tested with a synthetic voice and a synthetic text; accuracy on a real
  learner's speech is shown only by a human run.
- Writing feedback is generic in places (does not quote the learner's sentence).
- A long-session client-side jump from the result page could stay on the loading screen; advice links
  use full navigation. Root cause unknown.

Owner trial (one run, real voice): log in as a test learner, open /diagnostic, do all 29 tasks
(Listening clips should play), record both Speaking tasks, write both Writing tasks, submit, wait for
grading (about a minute), then check: no "bộ chấm thử nghiệm" notice (that would mean mock grading),
four skill scores and the overall, per-criterion feedback, priorities with links, reload keeps the result.
