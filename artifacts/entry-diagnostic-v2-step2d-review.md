# Entry Diagnostic V2 — Step 2D final content re-review

```text
STEP2D_VERDICT=REVISIONS_REQUIRED
ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS=false
```

Reviewed 2026-10-25 against content version 2, blueprint `V2_2026_01`.

---

## 1. Independence — read this before the findings

The agent writing this file **authored the content**. It wrote Step 2A, wrote the
Step 2B review, and applied the Step 2C revisions. It cannot run a blind Stage A
and does not claim to.

Stage A was therefore run by a reviewer **started cold, with no conversation
context**, barred from the review, the register, the Step 2C evidence and the
authoring report, and not told who wrote the content.

```text
BLIND_REVIEW_COMPLETED_BEFORE_PRIOR_ISSUE_DISCLOSURE
  for the Stage A reviewer   = true
  for the author of this file = false

independence achieved     = BLIND_TO_PRIOR_ISSUE_LIST
independence NOT achieved = INDEPENDENT_OF_THE_AUTHORING_MODEL
STAGE_A_FINDINGS_FROZEN_BEFORE_RECONCILIATION=true
```

That distinction is not pedantry. The same model family authored and reviewed
this content; a genuinely independent review needs a human assessment
specialist or a different system. What the blind pass *did* prove is that the
mechanism works: it found a MAJOR defect that two of my own earlier passes had
examined and explicitly dismissed.

The Stage A reviewer self-disclosed one exposure (IR-021): the content draft —
an allowed file — ends with a `revisionProvenance` block naming three forbidden
files and listing ten opaque revision IDs. It read that, opened no forbidden
file, and reports the only substantive thing absorbed was the existence of an
open instruction-language question it had already reached on its own. Accepted.

---

## 2. Verdict

**One MAJOR finding and three of ten required revisions not fully closed.**

```text
STAGE_A_BLOCKER_COUNT=0
STAGE_A_MAJOR_COUNT=1
STAGE_A_MINOR_COUNT=16
STAGE_A_NOTE_COUNT=7
NEW_INDEPENDENT_ISSUE_COUNT=22

ITEMS_REVIEWED=29/29          LISTENING_SCRIPTS_REVIEWED=4/4
READING_PASSAGES_REVIEWED=3/3 SPEAKING_TASKS_REVIEWED=2/2
WRITING_TASKS_REVIEWED=2/2    RUBRICS_REVIEWED=2/2
```

Section 31's approval rule fails on three counts: `STAGE_A_MAJOR_COUNT` is 1 not
0, `MULTIPLE_DEFENSIBLE_ANSWER_ITEMS` is 1 not 0, and three required revisions
are not `CLOSED`.

### The MAJOR — IR-001, `LU_Q_002`

```text
The session starts ____ half past nine.     options: on / in / at / by
```

`by` yields an acceptable English sentence under a no-later-than reading —
*Doors open by seven*, *The train leaves by six*. Nothing in the stem forces a
point-in-time reading, so **two options are defensible**.

**This is my error twice over.** The Step 2B register offered (a) replace `by`
with a slot-level distractor, or (b) keep `by` and re-declare the construct. I
chose (b), on the stated ground that *"starts by half past nine is semantically
incoherent for a start event"*. That ground is false. My Step 2B review had
already considered this exact ambiguity and dismissed it in the same words — so
two consecutive passes of mine got it wrong on the same reasoning.

Worse, the Step 2C rewrite wrote the false rule **into the artifact**. The
`answerRationale` now asserts that *"a start event does not take [a limit]"*,
which is untrue of English and would propagate into learner feedback and into
any later item that reuses the rule (IR-002). Option (a), the one I rejected,
would have avoided both.

---

## 3. Three flags I reported in Step 2C that do not survive

| Step 2C claim | Step 2D finding | Why mine was wrong |
|---|---|---|
| `LEARNER_FACING_BRITISH_FORM_COUNT=0` | `LISTENING_EN_US_CONSISTENCY_PASS=false` | My regex's word list was written by me. Its silence proved only that the list was incomplete — it missed `student card`, `favour`, `From 1 March`, `Only at weekends`, `campus store`. I presented that silence as proof of locale consistency. |
| `LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=0` | `=2` (`LST_Q_005`, `LST_Q_007`) | My check was a 6-word verbatim-overlap proxy between stem and script. I documented in the same artifact that bypassability "cannot be decided mechanically" — then reported the proxy's result under the flag that asks the real question. The blind pass did the actual judgement. |
| `REV-006` closed | `PARTIALLY_CLOSED` | The criterion was *"a reviewer given only the stem and options cannot eliminate more than one option a priori."* I never ran that test. My replacement distractor says nothing about the deadline the stem asks about, so the field is still two. I traded one weak distractor for another. |

I also found, independently of the blind pass, that `RDG_Q_004`'s option still
reads **"revising them"** although the passage's `revision` became `studying`
under REV-001 — my scan matched `revision` but not `revising`.

---

## 4. Revision closure

```text
REV_REQUIRED_TOTAL=10   CLOSED=6   PARTIAL=3   OPEN=1   REGRESSIONS=3
```

| REV | Sev | Object | Status | Criteria met |
|---|---|---|---|---|
| 001 | MAJOR | Clip locale | **PARTIALLY_CLOSED** | no |
| 002 | MAJOR | `RDG_Q_006` | CLOSED | yes |
| 003 | MAJOR | SPK fluency | CLOSED | yes |
| 004 | MAJOR | `LST_Q_009` | CLOSED (regression) | yes |
| 005 | MINOR | `LST_Q_003` | CLOSED | yes |
| 006 | MINOR | `LST_Q_008` | **PARTIALLY_CLOSED** | no |
| 007 | MINOR | `LST_Q_010` | CLOSED (regression) | yes |
| 008 | MINOR | `LU_Q_002` | **NOT_CLOSED (regressed)** | no |
| 009 | MAJOR | WRT organisation | CLOSED | yes |
| 012 | MINOR | `RDG_PASSAGE_02` | CLOSED | yes |
| 010 / 011 / 013 | NOTE | — | NOTE_NO_CHANGE_REQUIRED | yes |

**Three regressions were introduced by the Step 2C fixes themselves**, all in
rationale prose, none in a key, option set or count:

- **IR-014** — the REV-004 rewrite left editorial residue in `LST_Q_009`'s
  rationale: *"now stated as specifically as the correct option"* is a statement
  about a revision, not about the stimulus.
- **IR-022** — the REV-007 rewrite wrote *"a section **he** was unsure about"*
  into `LST_Q_010`'s rationale. `LST_CLIP_04` establishes no gender for that
  speaker, and it would bind TTS voice casting to an assumption the script does
  not make.
- **IR-002** — the false claim about English in `LU_Q_002`, above.

```text
POST_REVISION_REGRESSION_PASS=false
```

---

## 5. What held up

The blind pass confirmed, against its own reading rather than my account:

- **All 25 answer keys correct**, and `CORRECT` at the right index in all 25
  rationale arrays. `INVALID_ANSWER_KEYS=0`.
- **`RDG_Q_006` (REV-002) is now a strong item.** Blind, all four options are
  live readings of the phrase and no surface cue favours the key; with the
  passage, exactly one answer. Judged one of the better items in the set. The
  reviewer did pick the key blind — from published knowledge of the term, which
  it disclosed as domain expertise, not an exploitable cue. Recorded both ways:
  `RDG_Q_006_NO_PASSAGE_KEY_IDENTIFIABLE` = false for a test-wise learner, true
  for a domain expert.
- **Speaking fluency (REV-003) is correctly length-independent.** Case A — a
  smooth 30-second answer on the 45-second task — reaches 4, on the anchor *"A
  complete, smooth response scores 4 however much of the available time it
  uses."* Case B — 45 seconds of searching pauses — cannot exceed 2. No
  back-door length penalty in the other three criteria. No issue raised.
- **Writing full range (REV-009) holds for both tasks.** An excellent 60–90
  word message can reach 4 on every criterion including organisation.
- **Accent is not penalised.** No anchor references nativeness or
  accentedness.
- **Originality**, re-run fresh: 11/11 objects, 12 queries, 0 meaningful
  matches, 0 unresolved.
- Passages and scripts judged genuinely natural, coherent and age-appropriate;
  no specialist knowledge required anywhere.

```text
READING_PASSAGE_QUALITY_PASS=true      READING_QUESTION_VALIDITY_PASS=true
LISTENING_SCRIPT_NATURALNESS_PASS=true LISTENING_QUESTION_SEMANTIC_PASS=true
SPK_TASK_01/02_CONSTRUCT_PASS=true     WRT_TASK_01/02_CONSTRUCT_PASS=true
SPEAKING_FLUENCY_LENGTH_DEPENDENCY_ABSENT=true
WRITING_TASK1/2_CAN_ACCESS_FULL_SCORE_RANGE=true
CEFR_CONTENT_LEAK_COUNT=0   ITEM_TIER_TO_RESULT_BAND_MAPPING_DEFINED=false
BLUEPRINT_CONFORMANCE_STILL_PASS=true
```

---

## 6. The 16 MINORs, batched

**Before audio generation** (both need `LST_CLIP_02` script edits, so generating
TTS first means paying for it twice):

- **IR-003** — `student card` → `student ID` in script and `LST_Q_005` option.
- **IR-012** — elevator servicing does not plausibly close a second-floor room
  when stairs exist. The causal clause looks bent to support `LST_Q_003`'s
  north-side distractor. Make the cause sufficient or the access limit explicit.

**Locale batch** — IR-004 (`favour`), IR-005 (`From 1 March`, `Only at
weekends`, ambiguous `campus store`), plus `revising` in `RDG_Q_004`.

**Listening option hardening** — IR-006 (`LST_Q_001`: the key is the only gerund
among three indefinite-article noun phrases — an odd-one-out cue), IR-007
(`LST_Q_003`: "the printing service" is not an area), IR-008 (`LST_Q_004`: an
option that denies the stem's presupposition), IR-009 (`LST_Q_005`: world
knowledge converges on the student ID), IR-010 (`LST_Q_007`: the key is 58
characters against distractors of 28–48, and it shares content with
`LST_Q_006` — local dependence on one clip), IR-011 (`LST_Q_008`).

**Rubric anchors** — IR-015 (double penalisation: "beyond the prompt" is scored
under both `task_fulfilment` and `language_use`; "pace" under both
`intelligibility` and `fluency`), IR-016 (`task_achievement` 2's undefined
"length falls well below the stated range" collapses *short but complete* onto
the same score as *incomplete*).

**Tier** — IR-013 (`RDG_Q_004` is D1 but harder than the D2 lookups beside it).
`TIER_CHANGE_RECOMMENDATION_COUNT=2`, review status `QUALITATIVE_ONLY`.

**Product decision, before activation not persistence** — IR-017: English
procedural instructions (*"You will have 15 seconds to think, then 45 seconds to
speak"*) make task comprehension part of the measurement for exactly the weakest
learners in a Vietnamese 16–24 population. Independently reached, and it
strengthens REV-013.

**NOTE worth acting on** — IR-018: no wording match exists anywhere, but
`SPK_TASK_01` is functionally congruent with a standard TOEFL independent task
*and carries the identical 15s/45s configuration*. The
`contentOriginalityDeclaration` says nothing was "copied **or adapted**" from
commercial practice material; `or adapted` is stronger than the evidence
comfortably supports for task structure and timing. Narrowing the declaration to
wording would make it defensible without changing content.

---

## 7. Integrity and safety

```text
CONTENT_TARGET_STABLE_DURING_REVIEW=true   HASH_MISMATCH_COUNT=0
VALIDATOR_CHECK_MODE_READ_ONLY_PASS=true   CONTENT_DRAFT_HASH_INTEGRITY_PASS=true
CONTENT_FILES_MUTATED=false

DB_MUTATED=false   (read-only SELECT only)
LEGACY_ASSESSMENT_COUNT=1   LEGACY_QUESTION_COUNT=20
V2_CANONICAL_CONTENT_ROWS_CREATED=0
  all 5 V2 tables verified empty by direct query
AZURE_CALL_COUNT=0  TTS_CALL_COUNT=0  GEMINI_GRADING_CALL_COUNT=0
R2_DIAGNOSTIC_MEDIA_CREATED=0   V2_ACTIVATED=false
DEF_003_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
```

All 7 artifacts were hashed before the review, mid-review, and again after a
session restart that interrupted the blind pass. All three snapshots are
byte-identical, and the manifest `b60559a2…` is unchanged across every `--check`
run.

---

## 8. What this review does not establish

- **Independence from the authoring model.** Blind to the prior issue list is
  not the same as a third party.
- **Any psychometric property.** No calibration, item statistics, rater
  agreement or standard setting. `D1-D4` remains
  `DESIGN_HYPOTHESIS_NOT_CALIBRATED`.
- **Rubric validity.** Neither rubric has been double-marked or trialled. The
  full-range tests were analytic readings of the anchors, not empirical.
- **That a human specialist would find nothing further.** Two consecutive
  passes of mine missed the `LU_Q_002` ambiguity the blind pass caught. That is
  direct evidence that single-reviewer passes of this kind leak.

---

## 9. Gate

Fix **IR-001 + IR-002** on `LU_Q_002` and reopen **REV-008**, **REV-001** and
**REV-006**. The MAJOR is one zero-weight auxiliary item and the fix is one
option or one clause of stem context — a short gate, not a rework. Nothing was
changed in this pass.
