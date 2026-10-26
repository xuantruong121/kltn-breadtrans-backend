# Entry Diagnostic checkpoint — 2026-10-26

Scope: finish the Entry Diagnostic V2 (assessment id 5, `FOUR_SKILL_PLACEMENT_V2`) as far as it can go
without real providers, protected writes or activation. No Admin CMS work was started.

## 1. Evidence statuses

```
ISOLATED_MOCK_E2E_PASS=PASS          finalization-diagnostic-v2-browser.ts, 35/35, harness clone, mock grader
REAL_BROWSER_E2E_PASS=PASS (harness) same run: Chromium, real UI, real queue/worker, fake microphone tone
AUTHENTICATED_HTTP_PASS=PASS (harness) result API read with the learner's token inside the same run
FINAL_SCORER_PASS=PASS (formula)     scores, overall and stored rows equal the blueprint formula
REAL_AZURE_SMOKE_PASS=NOT_RUN        needs authorization + owner recordings
REAL_GEMINI_SMOKE_PASS=NOT_RUN       needs authorization
REAL_MEDIA_PLAYBACK_PASS=NOT_RUN     listening used a stand-in practice MP3 (HARNESS_FIXTURE_NOT_SCRIPT_AUDIO)
PLACEMENT_BAND=WITHHELD_DEF_004_OPEN
ID5_STATUS_KLTN_DB=DRAFT, inactive, contentVersion=1 (unchanged)
```

What "PASS" here does not prove: the mock grader returns fixed rubric scores, and the fake microphone
records a tone. The run proves the pipeline (upload, normalisation, queue, worker, result refresh,
retry, UI), not the quality of Azure or Gemini grading on spoken or written English.

## 2. What changed

Backend (`kltn-breadtrans-backend`)
- `src/modules/diagnostic/diagnostic-four-skill.ts` (new, pure): the blueprint scorer. L and R =
  round(correct/10 × 100); S and W = round(mean of graded task %); Language Use is reported with weight 0;
  overall = round((L+R+S+W)/4) only when all four are COMPLETE. A pending task gives PENDING_GRADING, a
  failed task gives GRADING_FAILED, and neither becomes 0. An objective item without a known section is
  refused (`DIAGNOSTIC_SCORER_V2_UNSCORABLE`). No band is produced.
- `diagnostic-four-skill.store.ts` (new): writes `DiagnosticSkillResult` rows and keeps
  `resultState`/`overallScore` in step after submission, after every grading outcome or retry, and on read.
- `diagnostic.service.ts`: attempts pin `scoringVersion`/`blueprintVersion`/`contentVersion`; the result
  returns `fourSkill`, `administeredForm`, and per-task criteria, criterion feedback and rubric version for
  Speaking (score 0–100, only when GRADED).
- `diagnostic.logic.ts`: V2 is a supported scorer; readiness lists the open DEF-004 as a blocker, so the
  assessment cannot be activated through the normal path.
- Tests: diagnostic suite 400/400; `tsc` clean; lint clean on changed files.

Frontend (`kltn-breadtrans-frontend-junior`)
- `src/lib/diagnostic/diagnosticTaskLogic.ts` (new, tested 5/5): form counts from the administered items,
  per-task recording limit, word count identical to the backend, word-range guidance (never a gate),
  criterion and state labels.
- `src/app/(student)/diagnostic/page.tsx`: removed the hard-coded "52 nhiệm vụ / 48 trắc nghiệm / 35–50
  phút / 16-16-16"; shows task instructions; preparation countdown that starts recording by itself;
  recording stops at the task's `responseSeconds`; re-record before confirming; word guidance; listening
  NOT_READY message; four-skill result (overall only when complete, Language Use auxiliary, internal
  practice indicator wording); Speaking and Writing cards with 0–100 score, 0–4 criteria and feedback;
  retry for failed Speaking and Writing; the polled result supersedes the submit response so grading
  progress updates without a reload. Removed: Writing "x/5" label and the note that claimed failed
  recordings were "ghi nhận đầy đủ … để tham chiếu năng lực". The answer review no longer shows a grading
  status ("GRADED") as the learner's answer.
- `src/components/profile/DiagnosticResultTab.tsx`: same hard-coded counts removed; V2 shows the four-skill
  line instead of a level; "Điểm phát âm" relabelled "điểm Nói".
- FE: `tsc` clean, lint 0 errors, `test:ci` 635/635.

Harness (`scripts/qa`)
- `harness-fake-s3.ts` (new): a local S3-compatible store on 127.0.0.1:9460 for the private bucket, so
  speaking uploads work in the harness without any R2 credential.
- `finalization-diagnostic-v2-browser.ts` (new): the V2 journey and the failure/retry phase.
- Clone state after the run is restored: id 1 ACTIVE, id 5 DRAFT.

## 3. Run summary (harness clone only)

29 tasks answered in the UI. L 50, R 50, S 69 (tasks 62.5 and 75), W 75, overall 61 =
round((50+50+69+75)/4). Attempt row: `FOUR_SKILL_PLACEMENT_V2 / V2_2026_01 / 6 / COMPLETE / 61`, five
skill rows. Then one Speaking and one Writing row were set to GRADING_FAILED on the clone: the API and the
stored attempt both moved to GRADING_FAILED with no overall, the page said the overall is withheld and
showed two "Chấm lại" buttons, and both retries regraded to COMPLETE with the overall back at 61.
Screenshots: `evidence/diag-v2-result-desktop.png`, `diag-v2-result-mobile.png` (no horizontal scroll at
390 px), `diag-v2-grading-failed.png`. Log: `evidence/diag-v2-browser-run.txt`.

## 4. Owner decisions — each is a separate request

### Request A — C3 live smoke (Azure + Gemini)
- Calls: Azure Speech ≤ 6 sessions, ≤ 3.5 min audio in total; Gemini ≤ 16 calls.
- Needs from you: four recordings in your own voice (`artifacts/c3-fixtures/speaking-smoke-recordings.md`:
  on-task 45 s, on-task with pauses 60 s, 10 s silence, off-topic 45 s) plus a `.txt` of what you said.
  I will not synthesise or imitate your voice.
- Target: harness only, `DIAGNOSTIC_GRADER_MODE=real` on the harness process, never kltn_db.
- Credentials present in `.env` (values not read into reports): Azure key and region SET, `GEMINI_API_KEYS` SET.
- Reply needed: "authorize C3 smoke" and the folder holding the recordings.

### Request B — Listening audio (4 clips, 10 questions)
- B1 casting decision (proposed, en-US, voices that already produced the published practice audio):
  CLIP_01 A female (Jenny) / B male (Guy); CLIP_02 narrator male; CLIP_03 narrator female; CLIP_04 A male /
  B female. Scripts are the approved text, unchanged (SHA-256 checked).
- B2 generate: 4 Azure TTS calls, about 1,692 characters (403 / 545 / 410 / 334), output to
  `artifacts/entry-diagnostic-v2-audio` for you to listen to first. Guard:
  `DIAG_V2_TTS_AUTHORIZED=generate-4-clips`.
- B3 publish (after you approve the audio): 4 objects to public R2 `diagnostic/v2/LST_CLIP_0n.v1.mp3`, then
  one transaction on kltn_db updating the 10 pending `DiagnosticListeningClip` rows and the 10
  `options.audioUrl` values of id 5. Refuses unless id 5 is an inactive DRAFT. Rollback: restore the 10
  rows to `.pending` / null in one transaction (statement prepared with the run); the R2 objects can stay
  unreferenced or be deleted. Guard: `DIAG_V2_AUDIO_PUBLISH_AUTHORIZED=publish-4-clips`.

### Request C — contentVersion on live id 5 (1 → 6)
- File: `artifacts/entry-diagnostic-phase-c3-content-version-fix.sql`. One row, guarded (id 5, V2 source
  key, still 1, still inactive DRAFT), self-rolls-back unless exactly one row changes. Rehearsed on a clone.
- Reply needed: "authorize contentVersion SQL".

### Request D — DEF-004 placement band
The scorer gives per-skill scores and an overall; the open question is whether to map them to a named band.
- D1 (recommended): no band. Show the four skill scores and the overall as an internal practice
  indicator, and record "no band" as the decision so readiness can pass. Reason: there is no calibration
  data for V2, so any threshold today would be invented. A band can be added later from real attempt data.
- D2: adopt the earlier documented bands (Starter 0–44, Foundation 45–64, Intermediate 65–79, Upper
  80–100). They exist in documents only, were never calibrated, and the old code used three bands, not four.
- D3: reuse V1 thresholds (≥ 75 Intermediate, ≥ 45 Foundation). V1 scored objective items only, so the
  construct differs.
None of these maps to CEFR or TOEIC, and none will be labelled that way.

### Request E — Grammar question 9 correction
- Row: `GrammarQuestion` id 9 (topic 2). Before: "The store ______ early because of the storm." After:
  "The store ______ early yesterday because of the storm." Explanation: "Yesterday chỉ thời điểm đã qua
  nên dùng quá khứ đơn: closed." Rollback: restore the old text and explanation.
- Then publication of topics 1 and 3–12 (and 2 after the fix) through the Admin publish endpoint;
  rollback by unpublish. Details: `grammar-publication-readiness.md`. Nothing is published automatically.

### Request F — Activation of id 5
Not requested now. It needs A (or an explicit decision to launch without a real-provider smoke), B, C and
D first. Activation would make id 1 READY and id 5 ACTIVE in kltn_db; rollback is the reverse swap.

## 5. External blockers

| Area | Feature | Local status | Missing test | Config present (no values) | Call limit proposed | Authorization |
|---|---|---|---|---|---|---|
| Azure Speech | Diagnostic and practice Speaking grading | mock-graded pipeline passes on harness | real recognition and scoring | key, region SET | ≤ 6 sessions / 3.5 min | Request A |
| Gemini | Diagnostic and practice Writing grading, Speaking rubric | mock passes; failure path passes | real rubric output | `GEMINI_API_KEYS` SET | ≤ 16 calls | Request A |
| Azure TTS | V2 listening audio | tool ready, plan verified read-only | generation | key, region SET | 4 calls, ~1,692 chars | Request B2 |
| R2 public | V2 listening audio publish | — | upload | account, keys, public URL SET | 4 objects | Request B3 |
| R2 private | Speaking audio storage | works on harness via local fake S3 | real bucket round-trip | private bucket and key SET | — | with Request A if wanted |
| PayOS | Plan purchase | fail-closed when not configured | sandbox checkout + webhook | client id, API key, checksum SET (sandbox or live not known) | 1 sandbox order | separate request, prepared next |
| SMTP | Password-reset email delivery | token logic unit-tested 5/5 | real delivery | `SMTP_*` NOT_SET | — | needs SMTP settings |

## 6. Next (learner only)

1. With the fake S3 in place, re-test ordinary Speaking practice end to end on the harness (mock scorer),
   which was blocked only by private storage.
2. Arena real match flow with two browser sessions; Store/Pet browser checks.
3. Prepare the bounded PayOS sandbox request; confirm whether the configured PayOS keys are sandbox.
4. Remaining items from the learner tracker. Admin CMS stays deferred.
