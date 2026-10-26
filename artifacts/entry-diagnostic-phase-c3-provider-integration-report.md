# Entry Diagnostic V2 — Phase C3: Real Speaking & Writing grading integration

**Date:** 2026-10-26 · **Scope:** implementation and mock-based testing only · **Verdict:**
`PROVIDER_IMPLEMENTATION_READY_FOR_LIVE_VALIDATION` (see §12 for what that does and does not mean)

No Azure Speech or Gemini request was made. No audio or text left the machine. No schema migration.
`kltn_db` and `kltn_shadow` content is unchanged (136/136 and 112/112 tables). **However, the C3 test runs
did write to `kltn_db` (insert-then-delete, net zero) through pre-existing integration specs. §10 records
this incident in full. It is the most important finding of this phase.**

---

## 1. What C3 had to solve

C2 left two gaps:

1. **Speaking had no grader.** The only speech call in the codebase is scripted pronunciation assessment
   with `ReferenceText` = task prompt. That scores whether the learner read the prompt aloud, not the
   construct. C2 refused Speaking (`SPEAKING_RUBRIC_GRADER_NOT_CONFIGURED`).
2. **Writing went through `AiService.chat`.** On inspection, `chat` wraps every prompt in the
   "Bánh Mì Gia Sư" tutor persona and **swallows provider errors**: with no keys or on failure it returns
   a friendly fallback string. A grader built on it cannot tell an outage from malformed output.

## 2. Design

```
Speaking:  normalized WAV ─► AzureUnscriptedSpeechAssessor ─► SpeechEvidence ─┐
                              (continuous, ReferenceText = "")                 ├─► generateStructuredJson ─► validateRubricGrade ─► GRADED
Writing:   learner text ──────────────────────────────────────────────────────┘    (schema-constrained)     (strict, grounded)       or GRADING_FAILED
```

### 2.1 Structured-output gateway (`generateStructuredJson`)

New optional method on `IAIEvaluator`, implemented in `GeminiEvaluatorStrategy` and exposed by
`AiService`. No persona; `responseMimeType: application/json` with a `responseSchema`;
`AiTaskType.STRUCTURED_AUTHORING` through the existing `executeWithRotation` (key rotation, cooldown,
telemetry). It **throws on every failure**, including missing credentials (`code: PROVIDER_NOT_CONFIGURED`).
It never returns a substitute string.

The installed SDK (`@google/generative-ai` 0.24.1) has no integer `minimum`/`maximum` in its schema types,
and the Gemini documentation itself says to validate values in the application. So the schema enforces
types and required keys only; ranges are enforced by `validateRubricGrade`.

### 2.2 Azure unscripted adapter (`diagnostic-azure-speech.ts`)

Per the Azure documentation (Microsoft Learn, updated 2026-07-03):

- **Unscripted** = no reference text. `PronunciationAssessmentConfig('', HundredMark, Word, enableMiscue=false)`.
  Miscue needs a reference text, so it is off.
- **Continuous recognition**, because single-shot is documented as unsuitable beyond 30 s and the tasks
  are 45 s and 60 s.
- **Prosody on** (`en-US`, SDK 1.51.0 ≥ 1.35).
- Content assessment is retired from SDK 1.46; content is judged by the language model instead.
- Audio: the normalized 16 kHz mono 16-bit WAV is parsed (`extractPcmFromWav`, refusing any other
  format) and written to a push stream.

Evidence aggregation (`aggregateSpeechEvidence`, pure): transcript; recognized word count; speaking span;
words per minute; long pauses (≥ 1 000 ms) and longest pause; Azure accuracy and overall pronunciation
weighted by words, fluency and prosody weighted by segment duration. Prosody is reported as `null` unless
every segment carried it.

Fail-closed rules:

| Condition | Result | Retried |
|---|---|---|
| fewer than 5 recognized words, or no segments | `INSUFFICIENT_EVIDENCE:SPEECH_EVIDENCE_INSUFFICIENT` | no; the model is never called |
| missing/non-finite score, missing word timing, malformed JSON | `PROVIDER_TRANSIENT:AZURE_RESPONSE_*` | once |
| `AuthenticationFailure`, `Forbidden`, `BadRequestParameters` | `PROVIDER_PERMANENT:AZURE_*` | no |
| `TooManyRequests`, `ConnectionFailure`, `ServiceTimeout`, `ServiceError`, `RuntimeError`, unknown | `PROVIDER_TRANSIENT:AZURE_*` | once |
| no end of stream within 90 s | `PROVIDER_TRANSIENT:AZURE_TIMEOUT` | once |
| non-WAV / wrong rate / stereo / non-PCM / empty | `PROVIDER_PERMANENT:AUDIO_*` | no |

Provider error details pass through `redactProviderDetails` before reaching any log or failure reason.

**No mapping from Azure numbers to rubric scores.** Azure output goes into the prompt as evidence, with the
explicit instruction *"These numbers are EVIDENCE, not rubric scores. Do not convert them to criterion
scores by any formula."* No `AzureScore / 25` style mapping exists anywhere.

**Known limitation, option A vs option B.** The Azure documentation states that unscripted assessment uses
a speech-to-text model different from standard Azure STT, and recommends a two-pass flow (standard STT for
the transcript, then scripted assessment against that transcript) when highly accurate recognized text is
needed. C3 implements **option A, the single unscripted pass**: half the Azure calls, and no reference text
derived from the task. **Option B, two-pass**, is the upgrade path. The live smoke plan measures word error
rate against what the speaker actually said, to decide between them. `TRANSCRIPT_ACCURACY=NOT_VERIFIED`.

### 2.3 Real composite grader (`ProviderDiagnosticRubricGrader`)

- **Writing:** learner text + approved `WRT_RUBRIC_V3` (descriptions and anchors from the DB rubric row) +
  the word-count guidance (`wordCountHandling`: reflected only in `task_achievement`, only below ⅔ of the
  minimum) → `generateStructuredJson`. Neither the persona chat nor the legacy TOEIC 0–5 grader is used.
- **Speaking:** Azure evidence first, then the model applies `SPK_RUBRIC_V3` to the transcript, using the
  evidence. **The adapter, not the model, attaches `transcript` and `speechEvidence`.** Any value the model
  returns under those keys is discarded.
- Learner text is delimited by `<<<`/`>>>`. The system instruction says the response is data and must not
  be obeyed, and forbids presenting the result as an official exam score, an ETS result or a CEFR level.
- Feedback is requested in **Vietnamese**, with evidence quotes verbatim in English. That language choice
  is mine and is not in the approved rubric: `FEEDBACK_LANGUAGE_DECISION=NEEDS_CONFIRMATION`.
- **Evidence reuse.** `gradeWithRubric` asks twice when output is rejected. Speech evidence for the same
  `submissionRef` is reused, so a retried model call does not pay for a second Azure recognition. Failed
  recognitions are not cached, so a transient Azure fault is retried for real.

### 2.4 Strict validation (`validateRubricGrade`, strengthened)

Rejected, never coerced: malformed JSON; non-object; different `submissionRef`; **different or missing
`rubricVersion`**; criteria missing / absent / non-numeric / NaN / ±Infinity / out of range / fractional /
unknown; **`criterionFeedback` missing, any criterion note under 8 characters, or a note for an unknown
criterion**; overall feedback empty or **under 20 characters**; **no evidence quote, a non-string quote,
more than 5 quotes, or any quote not found in the graded text** (learner text for Writing, the
adapter-attached transcript for Speaking; case, punctuation and spacing ignored, word boundaries
respected); **Speaking without transcript or speech evidence**.

`EVIDENCE_GROUNDING` proves a quote is present in the graded text. It does not prove that the quote supports
the score: `QUOTE_RELEVANCE=NOT_VERIFIED`.

### 2.5 Retry classification (`gradeWithRubric`)

`DiagnosticGraderError(kind, code)`. Kinds: `NOT_CONFIGURED`, `PERMANENT`, `INSUFFICIENT_EVIDENCE`, which
fail at once, and `TRANSIENT`, retried once. Invalid output is retried once, as before. Reason prefixes are
`PROVIDER_PERMANENT:`, `PROVIDER_TRANSIENT:`, `INSUFFICIENT_EVIDENCE:`, `INVALID_GRADER_OUTPUT:`.
Unconfigured reasons keep their C2 form. Model errors reuse the gateway's own `classifyGeminiError`:
`AUTH`, `INVALID_REQUEST`, `MODEL_NOT_FOUND` and `SAFETY` are permanent. `RATE_LIMIT`, `PROVIDER_TRANSIENT`,
`TIMEOUT` and `UNKNOWN` are transient.

### 2.6 Mock isolation and fail-closed configuration

`resolveDiagnosticGraderMode` reads explicit configuration only:

| `DIAGNOSTIC_GRADER_MODE` | Condition | Grader |
|---|---|---|
| `mock` | not production | mock |
| `mock` | `NODE_ENV=production` | unavailable (`DIAGNOSTIC_MOCK_GRADER_FORBIDDEN_IN_PRODUCTION`) |
| `real` | not `NODE_ENV=test` | real |
| `real` | `NODE_ENV=test` without `DIAGNOSTIC_ALLOW_REAL_PROVIDERS=true` | unavailable |
| unset / other | — | unavailable (`DIAGNOSTIC_GRADER_MODE_NOT_SET` / `_INVALID`) |

`MOCK_AZURE_SPEECH` and `NODE_ENV=test` no longer switch this grader to the mock. Every grader exposes
`mode`. Real mode without Azure credentials still grades Writing but fails Speaking with
`SPEECH_PROVIDER_NOT_CONFIGURED`. Credentials are only checked for **presence** at construction, and no
provider is contacted at start-up.

`evaluateAssessmentReadiness(..., { productiveGraderMode })` now blocks activation when the form has a
Speaking or Writing task and the mode is not `real`. A mode that is not stated also blocks. An
objective-only form is unaffected. **Caveat:** this evaluator is used by the audit scripts. No runtime
activation endpoint calls it today: `ACTIVATION_GATE_AT_RUNTIME=NOT_APPLICABLE`.

> **Operational consequence.** `.env` sets no `DIAGNOSTIC_GRADER_MODE`. The owner's backend on `:3001`
> runs in watch mode and reloaded itself with the C3 code during this phase (PID 23000 → 19072; I did not
> start, stop or restart it). Diagnostic Speaking and Writing grading in that dev instance therefore now
> **fails closed** (`GRADING_FAILED`, retryable). Set `DIAGNOSTIC_GRADER_MODE=mock` for local
> development, or `real` only after live validation. I did not edit `.env`.

## 3. Content version (C2-FIND-001)

- **Importer fixed:** it writes `contentVersion: draft.contentVersion` and refuses a draft without a
  positive integer version.
- **Regression test** (`v2-content-importer.spec.ts`, fake transaction): create path and update path from
  a row at version 1. **Red without the fix (2 of 3 fail), green with it.** On the disposable clone, the
  fixed importer created id 5 with `contentVersion = 6`.
- **Live correction prepared, NOT executed:** `artifacts/entry-diagnostic-phase-c3-content-version-fix.sql`.
  One `UPDATE` guarded by `id = 5 AND sourceKey = 'DIAG_V2_ASSESSMENT' AND contentVersion = 1 AND
  status = 'DRAFT' AND isActive = false`, inside a transaction that aborts unless exactly one row changed.
- **Rehearsed on the disposable clone only** (`c3-evidence/content-version-sql-rehearsal.log`): run 1
  updated 1 row (5 → 6); run 2 aborted with 0 rows (idempotent); the `status = ARCHIVED` and
  wrong-`sourceKey` guards each aborted with 0 rows. **One planned guard test did not happen:** setting
  `isActive = true` on a DRAFT row was refused by the table's own check constraint, so the `isActive` guard
  was never exercised in isolation. The log records this.
- Live `kltn_db` id 5 is still `contentVersion = 1`, `DRAFT`, inactive (read-only check after C3). Nothing
  was re-imported.

## 4. Skill completion helper (`summarizeProductiveSkill`)

A productive skill has a score only when **every** task of that skill is `GRADED` with a finite score. The
mean is rounded once at skill level. Otherwise the status is `PENDING` (any `SUBMITTED`/`QUEUED`/`GRADING`
task, reported before a failure so that a running retry stays visible), `FAILED` (`GRADING_FAILED`),
`INCOMPLETE` (no gradable answer) or `NOT_APPLICABLE`, and the score is `null`. A pending or failed task is
never counted as zero. No band or placement threshold was added.

Results now include `productiveSkills: { speaking, writing }`. **Behaviour change:** `speakingScore` used to
be the mean of whatever tasks were graded, so 1 of 2 still produced a score. It is now `null` until both are
graded, as the rubric's `missingTask` rule requires. The legacy Speaking strength/weakness labels (75 / 60)
predate C3 and were left unchanged. `DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN`.

## 5. Fixtures

- `artifacts/c3-fixtures/writing-smoke-fixtures.json`: five synthetic Writing cases written for this
  test (complete; short but complete below ⅔ of the minimum; fluent but off-task; prompt injection; strong).
- `artifacts/c3-fixtures/speaking-smoke-recordings.md`: four recordings the developer must record
  themselves for the live smoke (on-task 45 s, on-task with pauses 60 s, silence, off-topic). The phase
  generated no audio with TTS.
- Unit-test fixtures: Detailed-format Azure segments and WAV buffers built in code.

## 6. Tests

| Suite | Tests | Notes |
|---|---|---|
| `diagnostic-productive.spec.ts` | 54 (was 22) | full rejection matrix, grounding, retry kinds, skill completion |
| `diagnostic-azure-speech.spec.ts` (new) | 28 | WAV parsing, aggregation and weighting, fail-closed, error map, redaction; **SDK mocked at module boundary**: empty reference text, no miscue, prosody on, en-US, Detailed, continuous, 16 kHz/16/1 push stream, close on every path, timeout |
| `diagnostic-rubric-grader.spec.ts` (new) | 42 | mode matrix, MOCK_AZURE_SPEECH ignored, structured gateway not chat, injection delimiting, forged transcript discarded, evidence reuse, failed recognition not cached, no-speech skips model, permanent vs transient for Azure and model |
| `v2-content-importer.spec.ts` (new) | 3 | C2-FIND-001 regression (red/green shown) |
| `gemini-structured-json.spec.ts` (new) | 5 | no persona, schema/JSON config, STRUCTURED_AUTHORING, throws without keys, propagates errors |
| `diagnostic.grading-integrity.spec.ts` | 40 (+1) | activation blocked unless grader mode is `real` |
| C2 service specs (speaking 34, writing 18) | unchanged count | fakes updated to the strengthened contract; queue/stale/retry state machine untouched |

**Mutation checks:** setting the reference text to the task prompt made 1 of 28 Azure tests fail; removing
quote grounding made 5 of 96 fail; removing `contentVersion` from the importer made 2 of 3 fail. All
mutations were reverted and the suites re-run green.

**Full suite:** 150/150 suites, **1 502/1 502 tests**. It ran against the disposable PostgreSQL clone and
disposable Redis (see §10 for why that matters). `tsc --noEmit` 0 errors; `npm run lint:check` 0;
`git diff --check` clean. Build: `tsc -p tsconfig.build.json` into a scratch directory, PASS. `nest build`
was **not** run because the owner's running backend serves from `dist/`.

## 7. Isolated end-to-end — 59/59

`scripts/audit/c3-isolated-e2e.ts` runs on a disposable PostgreSQL 15 clone (protected checkpoint,
sha256 verified → `migrate deploy` → approved import) and disposable Redis on 6391. 6379 and the protected
clusters are refused.

**Real:** HTTP controller, the three services, BullMQ queues and workers, ffmpeg normalization of encoded
audio, Prisma, **and the whole C3 grader stack** (`ProviderDiagnosticRubricGrader`,
`AzureUnscriptedSpeechAssessor`, WAV parsing, aggregation, validation, retry classification).
**Fake, only at the two network seams:** the Azure recognition session and the structured-JSON gateway.
Also fake: storage, gamification, auth guard.

Highlights:

- the real normalizer's WAV is accepted by the adapter: 44.5 s → 1 424 000 PCM bytes at 16 kHz
- the stored transcript is the adapter's, not the model-forged one
- metadata holds validated speech evidence (`UNSCRIPTED_CONTINUOUS`, 1 long pause) and grounded quotes
- a rejected first model reply was retried using the **same** Azure evidence (model calls = sessions + 1)
- the Speaking prompt carries the transcript and the Azure evidence, plus the no-formula instruction
- Speaking `COMPLETE` only with both tasks graded. Writing went `PENDING` → `FAILED` (transient 503,
  retried once per task, null score) → retry → `COMPLETE`
- silence → `INSUFFICIENT_EVIDENCE`, the model was never called. Azure 429 → retried once, then transient
  failure. Model 401 → permanent, called once
- every C2 assertion still holds: duration limits, stale protection, ownership, concurrent retries
  202/409, replay rewrites nothing, DRAFT refused

**Run history, recorded honestly:** run 1 on earlier code was 58/59. The failing check expected one long
pause, and my fixture shifted only one word's offset, so later words overlapped and no gap existed after
sorting. This was a fixture defect, not an adapter defect, and the run-1 log is kept in
`c3-evidence/c3-isolated-e2e-run1-fixture-defect.log`. After the fixture fix: 59/59. After the final
classifier refactor, I rebuilt the clone from scratch and ran again: 59/59. All containers were removed.

## 8. Live smoke harness (prepared, not run against providers)

`scripts/audit/c3-live-smoke.ts`. No database, Redis or storage. It uses the production grader classes and
`new AiService(new GeminiEvaluatorStrategy())` without Redis, so the rotation keeps no telemetry. Hard caps:
6 Azure sessions and 16 model calls. `--live` refuses without
`C3_LIVE_SMOKE_AUTHORIZED=bounded-c3-live-smoke`, and that refusal was checked. `--dry-run` with fake
seams passed (5 Writing + 1 Speaking case; output in `artifacts/c3-live-smoke/dry-run-*.json`).

## 9. Protected databases

| Check | kltn_db | kltn_shadow |
|---|---|---|
| system_identifier | 7674533776495505443 (same) | 7699757546958700579 (same) |
| tables with different content, before vs after C3 | **0 / 136** | **0 / 112** |
| migrations | 68, identical | identical |
| snapshot sequences / diagnostic indexes / constraints | identical | identical |

Snapshots were taken in read-only sessions (`default_transaction_read_only=on`). Content was also unchanged
between the C2-after snapshot and the C3-before snapshot.

## 10. Incident — the full test suite wrote to `kltn_db`

**What happened.** Four pre-existing specs construct a real Prisma client with no URL (`new
PrismaService()`): `speaking-reward-forced-crash`, `plan-purchase.concurrency`,
`subscription-admin.concurrency` and `toeic.race` (`*.integration.spec.ts`). With no `DATABASE_URL` in the
environment, Prisma falls back to `.env`, which is `kltn_db`. I confirmed this with a read-only probe: the
default client connects to `kltn_db`, port 5432, sysid 7674533776495505443. These specs create users,
exercises, submissions and ledger rows, then delete them. Two of them (`speaking-queue`,
`speaking-reward-forced-crash`) also connect to `REDIS_URL || redis://localhost:6379`, the running app's
Redis.

**What I ran.** One bare `npx jest --ci` full run, and four isolated reruns of
`speaking-reward-forced-crash` when one of its tests failed once under parallel load. It passed 4/4 alone.

**Effect.** Table content is unchanged (0/136), so the cleanup worked. But the writes happened.
`pg_stat_user_tables` shows matching insert and delete counts on `User`, `SpeakingSubmission` and
`SpeakingExercise`, with an autoanalyze at 04:26 UTC, minutes after the runs. Their ID sequences advanced,
which the snapshot's sequence list does not cover. These counters are cumulative, so the share caused by
C3 cannot be separated exactly.

**Correction to C2 evidence.** C2's "kltn_db 0/136 tables changed" is true for content. The C2 full-suite
run went through the same path, so a create-then-delete write cannot be ruled out there either. Table
fingerprints cannot see such writes; `pg_stat_user_tables` counters can.

**Remediation in C3.** All later suite runs used `DATABASE_URL`/`SHADOW_DATABASE_URL` pointed at the
disposable clone and `REDIS_URL` at disposable Redis. Explicit environment variables take precedence over
`.env`. kltn_db `pg_stat_user_tables` counters were recorded before and after each of those runs and were
**identical**. I did not modify the four specs, because that is out of C3 scope.

**Recommendation for a separate fix:** make those specs refuse to run unless `DATABASE_URL` is explicitly
set and is not `kltn_db`.

## 11. Open items and risks

| Item | Status |
|---|---|
| Azure live behaviour: auth, continuous session lifecycle, real JSON shape, prosody presence | `NOT_VERIFIED`, needs live smoke |
| Gemini live behaviour: schema adherence, Vietnamese feedback quality, verbatim quotes | `NOT_VERIFIED` |
| Unscripted transcript accuracy (option A vs two-pass B) | `NOT_VERIFIED`, smoke measures WER |
| Grading validity: do the scores match the rubric anchors | `NOT_VERIFIED`, needs human-rated calibration later; the smoke is too small to calibrate |
| `MIN_RECOGNIZED_WORDS = 5`, `LONG_PAUSE_MS = 1000`, feedback minimum lengths | design choices, not validated |
| Feedback language Vietnamese | needs product confirmation |
| Real error shapes from the SDK and the Gemini rotation map onto the classes assumed | `NOT_VERIFIED` |
| One gateway call may rotate across up to 3 Gemini keys internally | known, counted per gateway call |
| `DEF_004_RESULT_BAND_MODEL_MISMATCH` | `OPEN` |
| Capture-stop allowance 500 ms (from C2) | still unmeasured in a browser |
| Pre-existing integration specs write to `kltn_db` | `OPEN`, §10 |

## 12. Verdict

```
PROVIDER_IMPLEMENTATION_READY_FOR_LIVE_VALIDATION
```

The adapters, validation, error handling, mock isolation and completion rules are implemented and pass
every mock-based and isolated test. **None of this proves that the real providers behave as assumed, or
that the grades are any good.** It means only that the next step is the bounded live smoke, which needs
explicit authorization: `artifacts/entry-diagnostic-phase-c3-live-smoke-plan.md`.

The verdict is about the implementation. Separately, the C3 process breached the "no writes to protected
databases" rule through the §10 incident (net-zero content). That incident should be closed by guarding
those four specs before any later phase runs the bare suite.
