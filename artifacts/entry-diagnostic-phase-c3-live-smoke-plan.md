# Entry Diagnostic V2 — bounded live smoke plan (awaiting authorization)

**Status: NOT RUN. Requires the explicit authorization in §7.** Reading the existing credentials in `.env`
is not authorization.

## 1. Purpose

This run answers the questions that C3's mocks cannot. It is not a calibration study.

1. Do Azure continuous unscripted assessment and the push-stream session work end to end with the real
   service, and does the result JSON have the shape the adapter parses (scores, word timing, prosody)?
2. Is the single-pass unscripted transcript accurate enough? The run measures word error rate against what
   the speaker actually said. The answer decides between the current design (option A) and two-pass STT +
   scripted assessment (option B).
3. Does Gemini structured output satisfy the strengthened contract: echoes, every criterion integer
   0–4, per-criterion notes, verbatim grounded quotes? What fraction needs the one retry?
4. Do the failure paths behave as designed against real responses: silence gives `INSUFFICIENT_EVIDENCE`
   with no model call; prompt injection does not produce all-4 scores by itself?
5. What are the latency and the actual call counts?

## 2. What is sent where

| Data | Destination | Volume |
|---|---|---|
| 4 recordings of **the developer's own voice**, made for this test, normalized to 16 kHz mono PCM | Azure Speech, region from `AZURE_SPEECH_REGION` | ≤ 3.5 audio minutes in total |
| 5 synthetic Writing texts (`artifacts/c3-fixtures/writing-smoke-fixtures.json`), approved task prompts and rubrics, 3 Azure transcripts with evidence numbers | Gemini via `GEMINI_API_KEYS`, model from the router (`gemini-3.5-flash-lite`) | ≤ 16 structured calls |

**No learner data. No database. No Redis. No R2 upload. The running application is not involved.** The
harness writes only its result file.

## 3. Hard limits, enforced in code

- **Azure:** at most **6** recognition sessions (4 recordings + 2 transient retries). The 7th call throws
  `HARD_CAP_REACHED` and stops the run.
- **Gemini:** at most **16** gateway calls (5 Writing + 3 Speaking, each with at most one retry). One
  gateway call may rotate across up to 3 configured keys internally on a rate-limit or auth error.
- **Cost estimate:** `NOT_VERIFIED` against the account's price sheet. Speech-to-text-based assessment of
  ≤ 3.5 minutes is far below the 5-hour monthly free quota that `admin.service.ts` assumes for F0. On a
  paid tier it is cents. 16 flash-lite calls of a few thousand tokens each cost well under one US dollar.
- **Duration:** a few minutes.

## 4. Inputs the user prepares

Record the four files described in `artifacts/c3-fixtures/speaking-smoke-recordings.md` into one local
folder (`S1_ON_TASK_45`, `S2_ON_TASK_PAUSES_60`, `S3_SILENCE_10`, `S4_OFF_TOPIC_45`). Add a `.txt` file
with what you actually said next to each spoken one. Writing fixtures are already in the repository.

## 5. Procedure

1. Read-only `pg_stat_user_tables` counters and snapshot of `kltn_db` (baseline). They are expected to be
   untouched, because the harness opens no database.
2. Dry run: `npx ts-node --transpile-only scripts/audit/c3-live-smoke.ts --dry-run`.
3. Live run, with credentials loaded from `.env` inside the process only and never printed:
   `C3_LIVE_SMOKE_AUTHORIZED=bounded-c3-live-smoke npx ts-node --transpile-only scripts/audit/c3-live-smoke.ts --live --audio-dir <folder>`
4. Read-only counters and snapshot of `kltn_db` again; compare.
5. Scan the result file and console output for anything credential-like before writing it into a report.
6. Write `artifacts/entry-diagnostic-phase-c4-live-smoke-report.md` with per-case results and flags.

## 6. Stop conditions

Stop at once, keep partial results, and do not retry manually when:

- any `PROVIDER_PERMANENT` (auth, forbidden, bad request, safety) occurs;
- a hard cap is reached;
- anything credential-like appears in output;
- `kltn_db` counters or content change;
- a recording would need to be re-sent beyond the cap.

## 7. Authorization requested

Reply with an explicit statement covering each point. For example:

> Cho phép C3 live smoke: gọi Azure Speech (tối đa 6 phiên, chỉ 4 bản ghi giọng của chính tôi, ≤ 3.5 phút)
> và Gemini (tối đa 16 lệnh structured JSON trên 5 bài viết tổng hợp + 3 transcript), dùng khóa hiện có trong
> `.env`, không ghi DB/Redis/R2. Thư mục ghi âm: `<path>`. Ngôn ngữ feedback: tiếng Việt [đồng ý / đổi
> thành ...].

Scope that is **not** requested and stays unauthorized after this approval: grading any learner's real
submission; enabling `DIAGNOSTIC_GRADER_MODE=real` in the running application; activating assessment id 5;
executing `artifacts/entry-diagnostic-phase-c3-content-version-fix.sql` on `kltn_db`; Listening TTS.

## 8. What PASS would and would not mean

| PASS means | It does NOT mean |
|---|---|
| The wiring works with the real services on these inputs | That grades are valid or calibrated |
| Gemini output satisfies the contract on these 8 gradable cases | That it always will |
| The WER figure is a first estimate for this speaker | That it holds for Vietnamese learners' accents; that needs a larger consented sample |

A human-rated calibration set, and a decision on option A vs B for real learner speech, remain separate
later phases.
