# Entry Diagnostic V2 — Step 2A authoring report

Authored 2026-10-25. Draft only: nothing persisted to the database, no audio
generated, no external provider called.

**This phase authored the content. It did not review it.** Every quality
judgement — item validity, distractor quality, level appropriateness, rubric
validity, overall content review — is `NOT_REVIEWED_IN_AUTHORING_PHASE` and
belongs to Step 2B.

---

## 1. Difficulty scale (Option C)

A new authoring-side scale `D1–D4` was introduced, independent of the result
bands:

| | |
|---|---|
| `scaleId` | `BREADTRANS_AUTHORING_DIFFICULTY_D1_D4` |
| `status` | `DESIGN_HYPOTHESIS_NOT_CALIBRATED` |
| Describes | an **item** |
| Result bands describe | a learner **outcome** (Starter / Foundation / Intermediate / Upper) |
| Mapping between them | **none — deliberately not defined** |
| CEFR | not used; tiers were assigned from the previous draft's intended relative progression, not by converting A2/B1/B2 |

Tiers were derived per skill by ordering the subskills the blueprint already
listed from most to least accessible. The previous CEFR string is retained in
each matrix row only as `previousDraftDifficultyNote`, to show where the tier
came from, and is not persisted as an item level.

The validator enforces this: it fails if any item carries a CEFR token or a
difficulty value outside `D1–D4`.

## 2. Counts — all conform to the blueprint

```text
TOTAL_ITEMS                 29
LISTENING_ITEMS             10      LISTENING_CLIPS      4
READING_ITEMS               10      READING_PASSAGES     3
SPEAKING_PRODUCTIVE_TASKS    2
WRITING_PRODUCTIVE_TASKS     2
LANGUAGE_USE_ITEMS           5      (overallWeight 0, auxiliary)
EXPECTED_COMPLETION_MINUTES 46      (DESIGN_ESTIMATE)
```

## 3. Distribution

```text
ITEMS_BY_DIFFICULTY_TIER (25 objective)   D1=6  D2=9  D3=6  D4=4
Productive tasks carry ranges            SPK_01 D1-D2   SPK_02 D2-D4
                                         WRT_01 D1-D2   WRT_02 D2-D4

LISTENING_ITEMS_BY_CLIP    CLIP_01=2  CLIP_02=3  CLIP_03=3  CLIP_04=2
READING_ITEMS_BY_PASSAGE   P_01=3     P_02=4     P_03=3
```

Subskill coverage:

| Skill | Subskills |
|---|---|
| Listening | gist 2, specific detail 4, purpose 1, speaker intention 1, inference 2 |
| Reading | main idea 2, specific detail 3, meaning in context 2, reference 1, inference 2 |
| Speaking | short personal response 1, extended opinion/situation 1 |
| Writing | short functional 1, short opinion/extended 1 |
| LanguageUse | grammar 3, vocabulary 2 |

## 4. Correct-option distribution

```text
first pass    A=5  B=9  C=9  D=2        <- D learnably rare
after fix     A=5  B=7  C=7  D=6
sequence      BADBCDCABCDACBDDCDBABCABC
```

Four items (`LST_Q_003`, `LST_Q_006`, `RDG_Q_006`, `RDG_Q_008`) had the correct
option swapped into the final slot. Options and `distractorRationales` are
positional, so both arrays were swapped together and the validator re-checks
that the `CORRECT` marker still sits at the correct index. No attempt was made
to force a perfectly even spread.

## 5. Listening — audio is required to answer

```text
LISTENING_AUDIO_REQUIRED_FOR_ANSWER=true
LISTENING_TRANSCRIPT_REQUIRED_FOR_ANSWER=false
```

No learner-facing prompt contains the script. Prompts are of the form "What
are the speakers mainly discussing?", "Which area is closed this week?", "Why is
the speaker calling?". The authoritative script lives on the clip object, which
Step 1's schema stores on `DiagnosticListeningClip.script` rather than in the
question payload, so a service projection can withhold it.

```text
LISTENING_SCRIPT_WORD_COUNTS   CLIP_01=76  CLIP_02=76  CLIP_03=77  CLIP_04=65
LISTENING_ESTIMATED_DURATIONS  32s  40s  38s  34s      (estimates, not measured)
```

Naturalness choices: contractions throughout (`That's the plan`, `wouldn't
read`), interruption and incomplete answers in CLIP_04, and no speaker states
information purely to expose an answer. CLIP_04 deliberately contains no
negative statement at all — the inference items depend on hesitation,
deflection and a reported equipment failure.

## 6. Reading

```text
READING_PASSAGE_WORD_COUNTS   P_01=97  P_02=150  P_03=159
READING_TOTAL_WORD_COUNT      406
```

Contexts: a campus bicycle-parking notice (functional), a short explanatory
article on why rereading notes feels more effective than it is, and a community
repair café. None requires specialist background. Total reading load was kept
near 400 words so the 46-minute design target stays plausible.

## 7. Speaking

Two tasks gathering deliberately different evidence, each with a construct
rationale recorded in the draft:

| Task | Prep / Response | Evidence |
|---|---|---|
| `SPK_TASK_01` | 15s / 45s | describing a familiar place, giving reasons, sustaining a short turn |
| `SPK_TASK_02` | 30s / 60s | stating and supporting an opinion, comparing options, organising an extended turn |

`minimumUsefulResponseSeconds` is 15 and 25 respectively. Neither task needs an
image, so `imageRequired=false` and no image is generated in this phase. Both
topics are answerable from ordinary student experience and both positions in
task 2 are equally defensible.

## 8. Writing

| Task | Words | Time | Evidence |
|---|---|---|---|
| `WRT_TASK_01` | 60–90 | ~7 min | three required functions; informal register; basic sentence control |
| `WRT_TASK_02` | 90–130 | ~9 min | clear position; two developed reasons; paragraph-level organisation |

Word ranges were derived, not borrowed. Task 1: three required functions need
roughly 15–25 words each, so 60 is the floor at which all three can appear and
beyond ~90 the task stops yielding new evidence. Task 2: an opinion plus two
developed reasons needs ~90 words before organisation is observable at all, and
130 keeps it inside its slot and gradeable consistently. The rationale is
recorded per task in the draft.

## 9. Rubrics

```text
SPEAKING_RUBRIC_VERSION  SPK_RUBRIC_V1
SPEAKING_CRITERIA        task_fulfilment, intelligibility, fluency, language_use      (4, each 0-4)

WRITING_RUBRIC_VERSION   WRT_RUBRIC_V1
WRITING_CRITERIA         task_achievement, organisation, vocabulary, grammar          (4, each 0-4)
```

Two selection decisions worth flagging to the reviewer:

- **Speaking has no separate coherence criterion.** In a 45–60 second turn,
  discourse organisation is only visible as part of whether the speaker
  addressed the prompt, so a separate score would largely restate
  task_fulfilment and add noise to an AI-graded total. Pronunciation is folded
  into intelligibility because the construct that matters for placement is
  being understood, not accent.
- **Writing does separate organisation**, because both written tasks are long
  enough for paragraphing and linking to be observable and task 2 explicitly
  asks for two developed reasons. Vocabulary and grammar are also kept apart,
  which written production makes independently visible.

Every anchor describes observable performance; the validator rejects any anchor
shorter than 20 characters or beginning with a bare value word such as "good"
or "excellent". Normalisation **intent** is recorded (mean of criteria → percent
of the 0–4 range; mean across the two tasks; round once at skill level; a failed
grading is never 0). No formula is implemented — that is Step 4.

## 10. Mechanical validation

`scripts/audit/validate-entry-diagnostic-v2-draft.ts` — read-only, no DB access.

```text
DRAFT_KEY_UNIQUENESS_PASS=true
BLUEPRINT_COUNT_CONFORMANCE_PASS=true
OBJECTIVE_KEY_STRUCTURE_PASS=true
RUBRIC_STRUCTURAL_VALIDATION_PASS=true
NO_CEFR_IN_CONTENT_PASS=true
DUPLICATE_EXACT_CONTENT_COUNT=0
UNRESOLVED_DRAFT_REFERENCES=0
CONTENT_HASH_MANIFEST_CREATED=true
MECHANICAL_VALIDATION_PASS=true
```

It also checks: every item has a prompt and a difficulty value; exactly one
option matches `correctAnswer`; no duplicate option text within an item; a
rationale for every option with `CORRECT` at the right index; orders contiguous
1–29; declared passage word counts match the authored text; all media, passage
and rubric references resolve in both directions; anchors cover the full score
range.

Two failures were found and fixed during authoring: three declared passage word
counts disagreed with the text (corrected to the counted values), and the
correct-option distribution was skewed (rebalanced as in §4).

## 11. Known authoring uncertainties — for Step 2B

Flagged honestly rather than resolved by the author:

1. **`LST_Q_009` difficulty.** The inference may be easier than intended for a
   learner who reads tone well, since "Everyone clapped at the end" is a strong
   cue. It may behave as D3 rather than D4.
2. **`LST_Q_008` wording.** "Meeting it would avoid a month's delay" requires
   combining the Friday deadline with "rolls into the next cycle". A reviewer
   should confirm the audio makes that link audible without the transcript.
3. **`RDG_Q_009` distractor C** ("the café cannot accept responsibility") is a
   realistic institutional motive the passage never raises. It is intended as
   the strongest distractor; a reviewer should confirm it is not *also*
   defensible from the text.
4. **`LU_Q_002` distractor D** ("by") changes meaning rather than being
   ungrammatical. Deliberate, but a reviewer may judge it unfair at D1.
5. **Clip durations are estimates** from word counts, not measured. Real
   durations are only known after Step 3 TTS.
6. **Speaking rubric has no coherence criterion** (§9). This is a construct
   decision a reviewer may disagree with.
7. **`RDG_PASSAGE_02` uses the term "the fluency trap"**, which `RDG_Q_006`
   then asks about. The term is defined in context, but a reviewer should check
   the item is not answerable from the term's wording alone.
8. **Vietnamese assessment title** was drafted (`Kiểm tra đầu vào bốn kỹ năng`)
   while all item content is in English, matching the existing product. A
   reviewer should confirm instruction language expectations.

## 12. Files

```text
artifacts/entry-diagnostic-v2-content-draft.json      29 items, 4 clips, 3 passages
artifacts/entry-diagnostic-v2-rubrics-draft.json      2 versioned rubrics
artifacts/entry-diagnostic-v2-content-draft.sha256    13 hash entries
artifacts/entry-diagnostic-v2-authoring-report.md     this file
artifacts/entry-diagnostic-v2-blueprint.json          updated with the D1-D4 scale
scripts/audit/validate-entry-diagnostic-v2-draft.ts   read-only validator
```

## 13. Safety

```text
DB_MUTATED=false
LEGACY_ASSESSMENT_COUNT=1      LEGACY_QUESTION_COUNT=20
V2_CANONICAL_CONTENT_ROWS_CREATED=0
AZURE_CALL_COUNT=0  TTS_CALL_COUNT=0  GEMINI_CALL_COUNT=0
R2_DIAGNOSTIC_MEDIA_CREATED=0  R2_UNRELATED_MEDIA_MUTATED=0
```

The hash manifest exists so Step 3 can prove the scripts it sends to TTS are
byte-identical to what Step 2B reviewed.

---

# Step 2C — applied content-review revisions

Appended on 2026-10-25. Nothing above this line was edited: sections 1-13 are
the Step 2A record, and section 11's uncertainties are kept as written, so the
review history stays readable. Full per-revision evidence lives in
`artifacts/entry-diagnostic-v2-step2c-revisions.json`.

Content version: **1 -> 2**. Rubrics: **SPK_RUBRIC_V1 -> V2**, **WRT_RUBRIC_V1 -> V2**.

## 2C.1 What was applied

All 10 register entries classified BLOCKER/MAJOR/MINOR were applied. The three
NOTE entries were not, each for the reason the register itself gives.

```text
REV-001  MAJOR  4 clips + 4 items + 2 passages   locale consistency, option (a) en-US
REV-002  MAJOR  RDG_Q_006                        options rewritten; key no longer paraphrases the term
REV-003  MAJOR  SPK_RUBRIC_V2                    fluency re-anchored on flow, not elapsed time
REV-004  MAJOR  LST_Q_009                        options made parallel in specificity
REV-009  MAJOR  WRT_RUBRIC_V2                    organisation given per-task anchors
REV-005  MINOR  LST_Q_003                        stem no longer asserts a week-long closure
REV-006  MINOR  LST_Q_008                        implausible distractor replaced
REV-007  MINOR  LST_Q_010                        false rationale corrected; projector distractor replaced
REV-008  MINOR  LU_Q_002                         targetFeature re-declared to match the option set
REV-012  MINOR  RDG_PASSAGE_02                   "fluency trap" -> "illusion of fluency" (evidenced)
REV-010  NOTE   RDG_Q_009                        register requiredChange is "None."
REV-011  NOTE   RDG_Q_003                        register requires no change; subskill retained
REV-013  NOTE   DIAG_V2_ASSESSMENT               open product decision on instruction language
```

## 2C.2 A count error in my own Step 2B review

The Step 2B review summary declared `major: 4`. Five register entries carry
severity MAJOR: REV-001, REV-002, REV-003, REV-004 and REV-009. REV-004 was
miscounted as MINOR in the summary while its own entry says MAJOR, and the
minor count was correspondingly one too high. The error is mine, from Step 2B.
It changed no outcome, because Step 2C applied every BLOCKER/MAJOR/MINOR entry
regardless of the summary. The register file was not edited — Step 2C may not
mutate Step 2B artifacts — so the correction is recorded in the Step 2C
evidence artifact instead.

## 2C.3 Validator fixed before use

The Step 2A validator regenerated the hash manifest on every run, so a
read-only review pass mutated the evidence it was checking. It now has two
explicit modes:

```text
--check          default; recomputes hashes in memory and compares. Never writes.
--write-hashes   regenerates the manifest on purpose, after an intentional revision.
```

```text
VALIDATOR_MODE=check            MANIFEST_WRITTEN=false
HASH_MISMATCH_COUNT=0           POST_REVISION_HASH_CHECK_PASS=true
manifest md5 before=ce99be4340d63e4440a8eb9610654ff8
manifest md5 after =ce99be4340d63e4440a8eb9610654ff8
SECOND_HASH_CHECK_MUTATED_FILES=false
```

The manifest was regenerated exactly once, deliberately, after the revisions.

## 2C.4 Where I did not follow the register literally

Three places, each documented in full in the evidence artifact:

- **REV-001** asked for British lexis to be Americanised. I did not replace
  `book them online` in `LST_CLIP_02`. It is natural American English, and
  `LST_Q_004`'s stem says *reserve* — that mismatch is the paraphrase the item
  measures. Replacing it would have handed the learner a verbatim match and
  made a D2 item easier. Same reasoning for `I've still got` in `LST_CLIP_01`.
  Rubric identifiers (`task_fulfilment`, `organisation`) were left alone: they
  are machine-contract fields in `aiGradingRequirements.requiredFields`, never
  shown to a learner.
- **REV-007** suggested replacing the projector distractor with *The file would
  not open at all*. I rejected it: the clip says the projector *wouldn't read
  my file*, so that option would be a true statement about the clip and
  defensible as a cause, breaking the one-defensible-answer requirement. I used
  *The projector trouble delayed the start* — plausible, traceable to the same
  audible failure, unambiguously false.
- **REV-008** offered two options. I took (b), re-declaring the targetFeature,
  rather than (a), inventing a fourth slot-level distractor. *starts for* and
  *starts from half past nine* are unnatural in a way that teaches nothing, and
  the review itself called `by` the most informative distractor.

## 2C.5 Post-revision verification

```text
ITEM_COUNT_TOTAL=29   L=10 CLIPS=4 R=10 PASSAGES=3 S=2 W=2 LU=5
OBJECTIVE_ITEMS=25    ALL_25_KEYS_RESOLVE_AND_ALIGN=true
CORRECT_OPTION_DISTRIBUTION   A=5 B=7 C=7 D=6      (unchanged by Step 2C)
CORRECT_OPTION_SEQUENCE       BADBCDCABCDACBDDCDBABCABC  (unchanged)
OBJECTIVE_TIER_DISTRIBUTION   D1=6 D2=9 D3=6 D4=4  (unchanged)
LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=0
CEFR_CONTENT_LEAK_COUNT=0
LEARNER_FACING_BRITISH_FORM_COUNT=0
DUPLICATE_EXACT_CONTENT_COUNT=0   UNRESOLVED_DRAFT_REFERENCES=0
READING_TOTAL_WORD_COUNT=407      (RDG_PASSAGE_02 150 -> 151 words)
MECHANICAL_VALIDATION_PASS=true
```

Hashes that moved: `script:LST_CLIP_02`, `script:LST_CLIP_04`,
`passage:RDG_PASSAGE_02`, `passage:RDG_PASSAGE_03`, `rubrics:json`,
`contentDraft:json`. The four productive prompts and `RDG_PASSAGE_01` did not
move, which is correct — no revision targeted them.

## 2C.6 Originality spot-check — now complete

DEF-002 is closed. The check that Step 2B could not run, because the web-search
tool returned a classifier error throughout that pass, was completed here over
all 11 content objects — 3 passages, 4 scripts, 2 speaking prompts, 2 writing
prompts — not a sample. 12 verbatim spans probed, **0 verbatim matches**.

The searches did return pages on the same topics: studying alone versus in
groups, university lecture-recording policy, owner-led repair cafes, the
fluency illusion. None contained this draft's wording. A shared everyday topic
is not a copied item; that result is what original content on common topics
looks like.

One probe did more than check originality — it supplied the evidence for
REV-012. The established term is **the illusion of fluency** / fluency illusion
(Bjork's work on desirable difficulties; Benjamin, Bjork & Schwartz 1998 on
retrieval fluency misleading metamnemonic judgements). *The fluency trap* is
not the standard label, so the passage's attribution to researchers is now
accurate and was kept rather than dropped.

## 2C.7 Safety

```text
DB_MUTATED=false                      V2_CANONICAL_CONTENT_ROWS_CREATED=0
AZURE_CALL_COUNT=0  TTS_CALL_COUNT=0  GEMINI_GRADING_CALL_COUNT=0
R2_DIAGNOSTIC_MEDIA_CREATED=0         R2_UNRELATED_MEDIA_MUTATED=0
V2_ACTIVATED=false                    LEGACY_ASSESSMENT_UNTOUCHED=true
STEP_2B_REVIEW_ARTIFACTS_MUTATED=false
FRONTEND_FILES_CHANGED_BY_STEP_2C=0
  (8 frontend files are modified in the working tree, all from this session's
   earlier TOEIC-routing and DIAG-007 passes; every mtime predates Step 2C)
```

## 2C.8 What this pass does not establish

I authored the Step 2A content, wrote the Step 2B review and applied these
revisions. An apply pass by the same author is not an independent review, and I
am not declaring one.

- REV-002's non-recoverability was verified by argument and a mechanical
  lexical-overlap check, not by a blind trial with a reviewer who had not read
  the passage.
- REV-004's parallelism was verified by option form and character length, not
  by item statistics.
- D1-D4 remains `DESIGN_HYPOTHESIS_NOT_CALIBRATED`.
- Neither rubric version has double-marking, rater-agreement or
  standard-setting evidence. Rubric validity is unestablished.
- en-US voice availability in the Step 3 TTS voice set is unconfirmed, because
  this pass may not call Azure. Carried as DEF-003; it must be confirmed before
  any audio is generated from these scripts.

```text
CONTENT_REVIEW_PASS=REQUIRES_STEP2D_REVIEW
```
