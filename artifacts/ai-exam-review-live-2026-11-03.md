# AI answer review: live run of 2026-11-03

One full TOEIC Listening & Reading exam generated with the real providers on
the disposable harness, generation only. Nothing was applied, so no Azure
audio and no R2 upload ran.

## Setup

```
TARGET=harness BE :3101 (scripts/qa/ai-exam-review-live-server.ts), DB nx_qa @ harness-pg :5460, Redis :6392
KLTN_DB_TOUCHED=NO
OWNER_PORTS_3000_3001_TOUCHED=NO
GENERATOR=gemini-3.5-flash-lite (Gemini, 3 rotating keys)
SOLVER_CHAIN=cloudflare @cf/openai/gpt-oss-120b, fallback gemini
EXPLANATION_CHECK=gemini-3.5-flash-lite
JOB=1c2a7d03-e765-43ee-9500-7f8d6bd47861
JOB_STATUS=GENERATED (READY_FOR_REVIEW_WITH_ERRORS)
ELAPSED_SECONDS=1502
JOB_FAILURES=0
APPLY=NOT_RUN (by design)
REVIEW_RULE_VERSION=as committed in ca266a4..a652bd0 (before the matcher fixes below)
```

### Cloudflare json_schema smoke test (before the run)

```
CF_JSON_SCHEMA_SMOKE=PASS
MODEL=@cf/openai/gpt-oss-120b
VALIDATION=VALID (validateSolveOutput, fail-closed)
VERDICT=AGREE on a Part 3 item, evidence quoted verbatim from the transcript
USAGE=370 input / 261 output tokens, 3.2 s
```

## Results as measured (old rule)

```
QUESTIONS_GENERATED=152 of 200
QUESTIONS_BY_PART=P1 6, P2 25, P3 9, P4 12, P5 30, P6 16, P7 54
FAILED_UNITS=21 (CONTENT_CONTRACT_FAILURE 6: P3 x4, P4 x2; ANSWER_REVIEW_FAILED 15)
STORED_BATCHES=31
GROUP_STATUS_P2_7=REVIEWED_INDEPENDENT 40, REJECTED 32, UNREVIEWED 9 (in refused batches, explanation step skipped)
PART1_GROUPS=6 (reviewed on the Draft after Apply: NOT_RUN)
SOLVE_STEPS=81 OK, all cloudflare, all INDEPENDENT
EXPLANATION_STEPS=40 OK, all gemini, all SAME_PROVIDER
REVIEWER_FALLBACKS=0
REVIEW_INVALID=0
```

Verdicts over every reviewed draft (accepted drafts plus every refused draft):

| Verdict | Count |
|---|---|
| AGREE | 226 |
| EVIDENCE_NOT_FOUND | 69 |
| EVIDENCE_INSUFFICIENT | 21 |
| DISAGREE | 18 |
| UNANSWERABLE | 17 |
| EXPLANATION_MISMATCH | 2 (causes: DOES_NOT_SUPPORT 2, CONTRADICTION 1) |
| AMBIGUOUS | 1 |
| REVIEW_INVALID | 0 |

Regeneration:

```
BATCHES_REDRAFTED=23 of 31 stored
REDRAFTS_FOR_REVIEW=53
REDRAFTS_FOR_CONTENT=4 (stored batches only; the 6 content-failed units used 3 tries each, not itemised)
ACCEPTED_AFTER_REDRAFT=8
FINAL_REFUSED_BATCHES=15
```

## The rule refused answers the solver had right

128 question-drafts were refused. 87 of them were refused by the evidence rule,
not by the solver: in each the solver had picked the marked key.

| Cause | Items | Fix |
|---|---|---|
| Part 2: the quote repeats the chosen response, but options were not in the match source | 51 | options join the source; Part 2 needs no stimulus quote |
| Part 5: no stimulus, so the solver set evidenceSupportsAnswer=false | 21 | Part 5 skips evidence checks |
| Part 6: blank markers "[131]" inside the passage broke the match | 11 | markers stripped before matching |
| Part 7: non-breaking hyphen (U+2011), option quotes, "NOT true" questions | 6 | dash variants normalised; NOT questions need no quote of an absence |
| Part 3: quote began with the speaker label "W:" | 1 | leading speaker label ignored |

```
RULE_FALSE_REJECTIONS=87 of 128
REJUDGED_OFFLINE=87 -> 21 AGREE (Part 5), 66 PASSES_EVIDENCE_EXISTENCE
EVIDENCE_SUPPORT_FOR_THE_66=NOT_RECORDED (the run did not store evidenceSupportsAnswer; now stored)
REJUDGE_SCRIPT=scripts/qa/ai-exam-review-rejudge.ts (reads the run JSON, calls no provider)
FIXED_RULE_LIVE_RERUN=NOT_RUN
```

The rerun was not started: Cloudflare's free allocation is 10,000 Neurons per
day and this run used about 7,071 (ESTIMATE below), so a second full run today
would exhaust it and fall back to Gemini, which measures the degraded path
instead.

## Triage of the 41 refusals the rule did not cause

Label: `AI_TRIAGE` (classified by Claude reading the item; not ground truth).
`HUMAN_VERIFIED=0`.

| Outcome | Items |
|---|---|
| Generator defect, refusal correct | 32 |
| Reviewer or checker wrong (false rejection) | 6 |
| Unclear | 3 |

Question numbers repeat across the drafts of a batch, so each refers to the
draft (attempt) it was refused in.

Generator defects found, by kind:

- Part 7 "NOT true" items with two or three unmentioned options (q164, q170, q178, q185, q188, q198, q200; AMBIGUOUS q152).
- Part 7 "closest in meaning" items whose word is not in the text (q180 "accommodate", q189 "current", q194 "limited"), and a question about a schedule that is not there (q179, attempt 1).
- Wrong key: Part 6 q145 attempt 0 ("are experiencing" for a future delay), Part 7 q184 attempt 2 (30 minutes, not 45).
- Part 2 responses that do not answer (q9 jacket answered with a tie, q14, q15 x2, q18, q20 "No, we already submitted").
- Part 3/4: "Look at the graphic" with no graphic (q49), a graphic listing three issues for "the reported issue" (q48, q49), a talk that recommends no plan (q88), the pen given the wrong way (q46).
- Part 6: a sentence-position blank given one-word options (q140); two defensible options (q144 attempt 0, q137, q145 attempt 2).
- Part 5 q126: "until" and "after" both fit.
- Part 7 q168: the key itself claims "free" classes the notice never mentions; the explanation check caught it.

False rejections (6): Part 3 q45 (speaker label, now fixed), Part 5 q124
(explanation acceptable; the checker over-read the tense labels), Part 7 q152
attempt 0 and q154 (sentence insertion: the solver read the [n] markers as after, not
before, the sentence), Part 7 q184 attempt 1 and q179 attempt 2 (NOT questions
refused for quoting an absence, now fixed).

Unclear (3): Part 2 q18 attempt 2 (an indirect "He is on a business trip"
answer to "Who"), Part 6 q138 and q144 attempt 2 (no option fits well).

```
FALSE_REJECTION_RATE_OF_SOLVER_AND_CHECKER=6 of 41 (AI_TRIAGE)
FALSE_REJECTION_RATE_TOTAL_OLD_RULE=93 of 128 (87 rule + 6), AI_TRIAGE for the 6
```

## Agreed items, stratified sample

15 agreed items, seed 20261103, quota P2 2, P3 2, P4 3, P5 3, P6 2, P7 3, from a
pool of 106. 6 of them sit in refused batches whose explanation step never ran.

```
AGREED_SAMPLE_CORRECT=14 (AI_TRIAGE; q45 P3 "form is incomplete" is weak wording)
AGREED_SAMPLE_FLAWED_ACCEPTED=1 (P6 q146: "finalized until the meeting", no option is right)
HUMAN_VERIFIED=0
```

## Asset integrity (structure only)

```
PART1_GROUPS_WITH_IMAGE_BRIEF=6 of 6
LISTENING_AUDIO_SCRIPT_BUILDABLE=38 of 38 groups (P1-P4)
STIMULUS_PRESENT=51 of 51 groups (P2-P4, P6-P7)
TOTAL_QUESTIONS=152 of 200 (6 Listening batches failed the content contract)
REAL_IMAGES=NOT_RUN
REAL_AUDIO=NOT_RUN
```

## Cost and quota

From the harness Redis counters, deltas over the run.

| Provider | Requests | OK | Input tokens | Output tokens | Mean latency |
|---|---|---|---|---|---|
| Cloudflare gpt-oss-120b (solver) | 68 | 68 | 43,182 | 83,561 | 15.8 s |
| Gemini (explanation check) | 17 | 17 | 10,576 | 5,001 | 2.1 s |
| Gemini, all tasks | 110 | 108 | 72,232 | 79,197 | |

```
GEMINI_GENERATION_CALLS=91 OK + 1 PROVIDER_TRANSIENT failure (32 batches planned; the rest are redrafts)
GEMINI_DAILY_QUOTA_COUNTER=+91 of 500
CLOUDFLARE_NEURONS=ESTIMATE 7,071 (43,182 x 31,818/M + 83,561 x 68,182/M, Cloudflare pricing page read 2026-11-03)
CLOUDFLARE_DASHBOARD_CHECK=NOT_VERIFIED
```

gpt-oss-120b spends most of its output on reasoning: about 1,230 output tokens
per solve call. Each refused batch also costs a new Gemini generation, so the
false rejections above roughly doubled the generation calls.

## Findings for the owner

1. The reviewer catches real defects the structural checks miss: 32 confirmed
   by triage in one exam, mostly Part 7 "NOT true" and vocabulary items, and two
   wrong keys.
2. The first version of the evidence rule was too strict and refused 87 correct
   answers. Fixed, with regression tests built from these items; the fix is not
   yet confirmed by a live rerun.
3. The content contract still lets through Part 7 vocabulary questions whose
   word is absent and "Look at the graphic" questions without a graphic. Not
   changed here (out of scope).
4. Sentence-insertion items ([1]-[4]) confuse the solver about marker position;
   expect some false rejections there until the prompt says markers precede the
   sentence.

## Rerun with the fixed rule, 2026-11-04

Same setup (harness `nx_qa` cloned from `kltn_db` that morning, live server on
:3101 with real Gemini and Cloudflare, generation only, no Apply). Job
`66a851f4-618b-43be-8074-41c3862a8891`, 901 s. Data:
`%TEMP%/breadtrans-harness/live-review-2.json`.

| Measure | 2026-11-03 (old rule) | 2026-11-04 (fixed rule) |
|---|---|---|
| Time | 1,502 s | 901 s |
| Questions generated | 152 / 200 | 170 / 200 |
| Failed units (content contract) | 6 | 6 (Part 3 "3 speakers") |
| Refused items, all drafts | 128 | 28 |
| Refusals where the solver chose the key (rule false rejection) | 87 | 6 |
| Solve steps | 81 Cloudflare | 78 Cloudflare INDEPENDENT, 9 Gemini fallback (SAME_PROVIDER) |
| Explanation steps | 40 Gemini | 83 Gemini |
| Final groups | — | P2 25, P3 4, P4 9, P5 27 + 3 degraded, P6 4 REJECTED, P7 9 + 6 degraded, P1 6 (Draft gate) |
| Cloudflare usage | 68 req, 43,182 in / 83,561 out tok, ~7,071 neurons | 43 req, 24,387 in / 44,746 out tok, ~3,827 neurons (ESTIMATE) |

Verdicts over all drafts: AGREE 186, EVIDENCE_NOT_FOUND 17, DISAGREE 6,
UNANSWERABLE 3, EXPLANATION_MISMATCH 1, REVIEW_INVALID 1.

**Triage of the 28 refusals (AI_TRIAGE, not human-verified):**

- **12 true generator defects, whole batch:** one Part 6 batch was written
  entirely in Vietnamese (passage, options and questions, e.g. "Kính gửi
  toàn thể nhân viên…"). The content contract does not check the language.
- **5 other true defects:** P2 q8 (key "Tea or coffee…" to a room question),
  P3 q43 (key not in the talk), P5 q118 (`while` and `although` both fit),
  P6 q145 twice (key `Therefore` where `However` fits; key `quickly` where
  `quicker … than` is required).
- **6 rule false rejections:** Part 6 sentence-insertion blanks. The solver
  chose the key but quoted only the option sentence, which is not in the
  passage, and the rule still asks a Part 6 quote to come from the passage.
- **2 reviewer errors:** P5 q108 (`herself` is right; the solver chose `her`)
  and P5 q112 (`because` is right; the solver chose `although`).
- **3 unclear:** P2 q8 (second draft) and q10 (indirect answers), P2 q28
  (explanation names no option).

**Agreed sample (15, seed 20261103):** 14 sound, 1 flawed (P6 q144: the
inserted sentence does not lead into "Because of this milestone…"); the
same rate as 2026-11-03, again in a Part 6 sentence-insertion item.

```
LIVE_RERUN=RUN (2026-11-04, 901 s)
RULE_FALSE_REJECTIONS=6 (was 87)
REFUSALS_TRUE_DEFECTS=17 (AI_TRIAGE)
REVIEWER_ERRORS=2 (AI_TRIAGE)
AGREED_SAMPLE_SOUND=14/15 (AI_TRIAGE)
CLOUDFLARE_NEURONS=3827 (ESTIMATE, dashboard NOT_VERIFIED)
HUMAN_VERIFIED=0
```

Open: the content contract lets a non-English Part 6 batch through, and the
evidence rule still refuses Part 6 sentence-insertion items whose solver
quotes only the option.
