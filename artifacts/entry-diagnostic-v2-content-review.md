# Entry Diagnostic V2 — Step 2B independent content review

Reviewed 2026-10-25. Audit-only: no content, rubric, hash or database change.

## Verdict

```text
STEP2B_VERDICT = APPROVE_WITH_REQUIRED_REVISIONS
ENTRY_DIAGNOSTIC_V2_STEP2B_REVIEW_COMPLETE = true
ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS    = false
REVISION_REQUIRED = true
```

4 MAJOR, 6 MINOR, 3 NOTE. **No blocker, no invalid answer key, no ambiguous
item, no multiply-defensible item, no bypassable Listening item.** The package
is structurally sound; what fails are two rubric construct problems, one reading
item that does not measure its declared subskill, one option-parallelism defect,
and a package-wide locale inconsistency that matters because Step 3 bakes it
into audio.

### Independence caveat, stated plainly

The reviewer is the same agent that authored the package. Genuine reviewer
independence was not achievable here. The procedure compensated as far as it
can: every item was re-read from the artifact and attacked before the author's
uncertainty list was opened, and the reconciliation was written afterwards. The
only objective evidence that the pass was not circular is that **7 of the 13
findings were not on the author's list**, including both rubric defects. A human
or separate-session review before persistence is still recommended.

## Integrity and mechanical baseline

```text
CONTENT_DRAFT_HASH_INTEGRITY_PASS = true
HASH_MANIFEST_ENTRY_COUNT = 13     HASH_MISMATCH_COUNT = 0
STEP2B_MECHANICAL_BASELINE_PASS = true    (29 / 10 / 4 / 10 / 3 / 2 / 2 / 5)
```

## Blocking and major issues

### REV-001 · MAJOR · all four Listening clips · locale/lexis mismatch
Every clip declares `en-US` and "general American", but the scripts are
British: **"lifts"** and **"study centre"** (CLIP_02), **"practised"**
(CLIP_04). An American voice reading "the lifts on the north side are being
serviced" is a dialect mismatch, and "lifts" may be unfamiliar to learners
whose input is American English. This is MAJOR rather than cosmetic because
Step 3 generates canonical audio from these exact scripts under the declared
locale — the inconsistency would be published and expensive to undo.
Fix: Americanise the lexis, or switch the declared locale to `en-GB` and
confirm an en-GB voice exists in the pipeline.

### REV-002 · MAJOR · RDG_Q_006 · reading context leak
The correct option, "mistaking ease of reading for real understanding",
paraphrases the term it asks about: "fluency" → "ease of reading", "trap" →
"mistaking". A learner who knows the word *fluency* can answer from the stem and
options **without reading the passage**, so the item does not measure its
declared meaning-in-context subskill. Confirms author uncertainty AU-7.

### REV-003 · MAJOR · SPK_RUBRIC_V1 · fluency measures length, not flow
Every fluency anchor is defined by how much of the available time is filled
("well under half", "half to two thirds", "most of the time", "continuously for
the available time"). A learner who answers SPK_TASK_01 completely and smoothly
in 30 of the 45 seconds scores **2 on fluency** while task_fulfilment awards 4.
The criterion penalises concision and measures response length. Not on the
author's list.

### REV-009 · MAJOR · WRT_RUBRIC_V1 · one rubric does not fit both tasks
This is the §28 question, and the answer is no. The organisation criterion's
anchor 3 explicitly names only task 2 ("task 2 separates its reasons
recognisably") and anchor 4 requires ideas "grouped deliberately and
signposted" — neither is available in a 60–90 word three-function message. So
WRT_TASK_01 is capped near the middle of that scale **by genre, not ability**,
and because the skill score is the equally weighted mean of both tasks, every
learner's Writing score is depressed systematically. The authoring rationale's
claim that "both writing tasks are long enough for paragraphing" does not hold.
Not on the author's list.

## Minor issues

| id | key | type | summary |
|---|---|---|---|
| REV-004 | LST_Q_009 | DISTRACTOR_NOT_PARALLEL | *(MAJOR)* one hedged option among three specific ones lets strategy substitute for inference |
| REV-005 | LST_Q_003 | QUESTION_WORDING_DEFECT | stem says "closed this week"; script says "closed until Thursday" |
| REV-006 | LST_Q_008 | WEAK_DISTRACTOR | "Missing it would be faster overall" is not a reasoning a learner would reach |
| REV-007 | LST_Q_010 | DISTRACTOR_RATIONALE_DEFECT | rationale claims running out of time "would make it longer" — wrong reasoning; projector distractor weak |
| REV-008 | LU_Q_002 | DISTRACTOR_NOT_PARALLEL | "by" is a semantic-shift distractor among slot-error distractors |
| REV-012 | RDG_PASSAGE_02 | PASSAGE_QUALITY_DEFECT | attributes "the fluency trap" to researchers; established term is *illusion of fluency* |

REV-004 is counted as MAJOR in the totals; it appears here for adjacency with
the other item-level findings.

## Per-skill summary

**Listening (10/10 reviewed, 4/4 scripts).** All ten keys correct, all ten
require audio. `LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT = 0` — no item is
answerable with certainty from learner-visible text. Two have *reduced* audio
dependency through option design: LST_Q_009 (REV-004) and LST_Q_008 (REV-006).
Scripts are genuinely spoken English — contractions, ellipsis, interruption — and
no speaker states information purely to expose an answer. Script naturalness
fails only on REV-001.

**CLIP_04 inference load**, checked in both directions as §15 requires: not too
obvious, because the clip contains no negative statement at all; not too
speculative, because three independent cues converge — the hedge "Well.", the
interlocutor's challenge "That's not really an answer", and the reported
projector failure plus the admitted cut.

**Reading (10/10 reviewed, 3/3 passages).** All keys correct, one defensible
answer each, no outside knowledge required. Passages are natural, coherent, age-
appropriate and specialist-knowledge-free. One subskill mismatch (REV-002) and
one attribution weakness (REV-012).

**Speaking (2/2).** Both constructs pass: the tasks gather genuinely different
evidence, topics need no specialist knowledge, and both positions in task 2 are
equally defensible. Prep and response times are appropriate. The rubric is the
problem, not the tasks.

**Writing (2/2).** Both constructs pass. Word ranges are defensible and their
rationales are task-derived rather than borrowed. The rubric is the problem.

**Language Use (5/5).** All five keys correct with one defensible answer.
Adversarial checks: LU_Q_001's "have tried" is arguable in a complaint reading
but the natural perfect form "have been trying" is absent, so it does not
compete; LU_Q_003's natural alternative "have been studying" is likewise not
offered. One non-parallel distractor set (REV-008).

## Rubric summary

```text
SPEAKING_RUBRIC_CRITERIA_DISTINCT_PASS = true
SPEAKING_RUBRIC_OBSERVABLE_PASS        = false   (REV-003 fluency)
SPEAKING_RUBRIC_ANCHORS_PASS           = false   (REV-003 fluency)

WRITING_RUBRIC_CRITERIA_DISTINCT_PASS  = true
WRITING_RUBRIC_OBSERVABLE_PASS         = false   (REV-009 organisation)
WRITING_RUBRIC_ANCHORS_PASS            = false   (REV-009 organisation)
WRITING_SINGLE_RUBRIC_TWO_TASKS_PASS   = false   (REV-009)
```

Double-counting was checked explicitly and **not** found: Speaking's
task_fulfilment absorbs content coverage but not organisation; Writing's
task_achievement covers *which* elements appear while organisation covers their
*arrangement*; vocabulary and grammar anchors stay on range/precision versus
accuracy respectively.

Both author omissions are **defensible**: no separate coherence criterion for a
45–60 second turn, and pronunciation folded into intelligibility because the
placement construct is being understood, not accent. The description states
accent is not assessed and no anchor references nativeness.

## Difficulty tiers

```text
DIFFICULTY_TIER_REVIEW_STATUS = QUALITATIVE_ONLY
ITEM_LEVEL_STATUS = DESIGN_HYPOTHESIS_NOT_CALIBRATED
ITEM_TIER_TO_RESULT_BAND_MAPPING_DEFINED = false
TIER_CHANGE_RECOMMENDATION_COUNT = 0
CEFR_CONTENT_LEAK_COUNT = 0
```

Both skills progress coherently (gist → detail → purpose/reference →
inference). **LST_Q_009's tier is defensible** despite the author's concern: the
inference requires combining three cues and no negative statement is available.
The real weakness there is option parallelism, so no tier change is
recommended. RDG_Q_003 sits slightly above pure lookup but remains plausible at
D2. Nothing here calibrates anything — inspection cannot.

## Author uncertainty reconciliation (8/8)

| id | concern | verdict | action |
|---|---|---|---|
| AU-1 | LST_Q_009 may be D3 not D4 | **PARTIALLY_CONFIRMED** | tier fine; option parallelism is the real issue → REV-004 |
| AU-2 | LST_Q_008 link audible without transcript? | **PARTIALLY_CONFIRMED** | link is audible; one distractor is weak → REV-006 |
| AU-3 | RDG_Q_009 distractor C also defensible? | **REJECTED** | passage gives an explicit competing reason; C is outside knowledge and works as intended |
| AU-4 | LU_Q_002 "by" unfair at D1 | **PARTIALLY_CONFIRMED** | one defensible answer, but non-parallel set → REV-008 |
| AU-5 | clip durations are estimates | **CONFIRMED** | unavoidable pre-TTS; Step 3 must write measured durations back (DEF-001) |
| AU-6 | Speaking lacks coherence criterion | **REJECTED** | omission defensible; a different rubric defect found instead → REV-003 |
| AU-7 | RDG_Q_006 answerable from the term itself | **CONFIRMED** | genuine context leak → REV-002 |
| AU-8 | Vietnamese title, English content | **CONFIRMED** | consistent with the product but an unconfirmed decision → REV-013 |

Totals: 2 confirmed, 4 partially confirmed, 2 rejected.

## Reviewer-found issues not on the author's list

```text
NEW_REVIEWER_ISSUE_COUNT = 7
```

REV-001 locale mismatch · REV-003 Speaking fluency measures length ·
REV-009 Writing rubric task mismatch · REV-005 LST_Q_003 wording ·
REV-006 LST_Q_008 weak distractor · REV-007 LST_Q_010 rationale error ·
REV-012 passage term attribution.

## Option-reorder regression (§10)

```text
OPTION_REORDER_REGRESSION_PASS = true
OPTION_REORDER_ITEMS_CHECKED   = LST_Q_003, LST_Q_006, RDG_Q_006, RDG_Q_008
```

For each: the correct option text now sits at index 3, `correctAnswer` matches
it, `CORRECT` sits at index 3 of `distractorRationales`, each moved distractor
kept its own rationale, and `answerRationale` still describes the key. No
semantic bug introduced by the swap.

## Fairness and originality

No cultural-fairness or age-suitability concerns. Contexts are campus, housing,
study habits, community repair and lecture recording — all plausible for 16–24
without wealth, nationality or specialist assumptions. The only named character
is a housing officer in a neutral role. No violence, sexual content, political
or religious persuasion.

```text
ORIGINALITY_SPOT_CHECK_PASS = NOT_COMPLETED
ORIGINALITY_CONCERN_COUNT   = 0
```

**The §35 external spot-check could not be run.** The web-search tool returned a
transient classifier error on every attempt in this pass. That is a tool
failure, not a finding, but it is an unmet requirement: §47 needs "no unresolved
originality concern", so it independently blocks approval and must be completed
before persistence (DEF-002). Internally, nothing indicates copied text — all
passages and scripts are plain contemporary prose carrying BreadTrans-specific
detail (Building C, the study-centre notice, the housing voicemail). One
attribution weakness was found without any external check: REV-012.

## Safety

```text
CONTENT_DRAFT_MUTATED = false   RUBRIC_DRAFT_MUTATED = false   HASH_MANIFEST_MUTATED = false
DB_MUTATED = false   LEGACY_ASSESSMENT_COUNT = 1   LEGACY_QUESTION_COUNT = 20
V2_CANONICAL_CONTENT_ROWS_CREATED = 0
AZURE_CALL_COUNT = 0   TTS_CALL_COUNT = 0   GEMINI_CALL_COUNT = 0
R2_DIAGNOSTIC_MEDIA_CREATED = 0   R2_UNRELATED_MEDIA_MUTATED = 0
```

## Next step

`STEP 2C — APPLY REVIEW REVISIONS`, working from
`artifacts/entry-diagnostic-v2-content-revision-register.json` (13 entries, each
with acceptance criteria). The four MAJOR entries — REV-001, REV-002, REV-003,
REV-009 — plus the originality spot-check must clear before persistence.
