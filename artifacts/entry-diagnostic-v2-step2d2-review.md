# Entry Diagnostic V2 — Step 2D2 cold targeted re-review

```text
STEP2D2_VERDICT=REVISIONS_REQUIRED
ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS=false

STEP2D2_BLOCKER_COUNT=0   STEP2D2_MAJOR_COUNT=0
STEP2D2_MINOR_COUNT=10    STEP2D2_NOTE_COUNT=3
```

Reviewed 2026-10-25 against content version 3.

---

## 1. Independence

The agent writing this file authored the content, wrote the Step 2B review,
applied the Step 2C revisions, wrote the Step 2D artifacts and applied the
Step 2C2 revisions. It is not a cold reviewer and did not claim to be.

The cold pass was run by a reviewer started with no conversation context and
no history with the author. The author contributed only the stability baseline,
the read-only validator run, and independent re-verification of every disputed
claim against the actual files.

```text
independence achieved     = COLD_CONTEXT_NO_PRIOR_SESSION_STATE
independence NOT achieved = INDEPENDENT_OF_THE_AUTHORING_MODEL
```

Cold context has now earned its keep twice. Step 2D caught a MAJOR that two
author passes had examined and dismissed. This pass caught **four over-claimed
closures in the author's own Step 2C2 evidence**. All four were re-verified
directly against the files; all four were confirmed, and three were worse than
the cold report stated.

---

## 2. The good news first

**The MAJOR is genuinely closed.** `to` has no licit reading in
`The session starts ____ half past nine`. The cold reviewer tried to defend
all four options and could defend only `at` — applying the same adversarial
standard that broke `by` in Step 2D. `LU_Q_002` now has exactly one defensible
answer and a coherent construct.

Also holding, each independently re-derived rather than taken on trust:

```text
all 25 answer keys correct; CORRECT aligned 25/25 (own script)
REV-006 acceptance test repeated option by option -> eliminable count 0 (max 1)
LST_Q_005 IR-009 fix works: world knowledge points at a WRONG option
LST_Q_007 no intra-item bypass; key no longer longest, no longer names Q006's answer
IR-003, IR-012, IR-014, IR-022 all CLOSED
SPEAKING_RUBRIC_REGRESSION_PASS=true   WRITING_RUBRIC_REGRESSION_PASS=true
  (fluency still length-independent; nothing double-scored across 8 descriptions
   and 40 anchors; both Writing tasks still reach max on every criterion)
RDG_Q_004 coherent, one defensible answer, retier plausible
CEFR_CONTENT_LEAK_COUNT=0   ITEM_TIER_TO_RESULT_BAND_MAPPING_DEFINED=false
ORIGINALITY 1 object rechecked (claim verified), 0 matches, 0 unresolved
CONTENT_TARGET_STABLE_DURING_REVIEW=true   CONTENT_FILES_MUTATED=false
```

Substantively this is draft-safe content. The cold reviewer said so plainly:
if the product owner wants rows down now against a documented MINOR list, no
learner is harmed. The approval flag is withheld because four named gate
conditions are unmet — not because the content is unsound.

---

## 3. Why it still fails the gate

```text
LU_Q_002_FEEDBACK_OVERGENERALIZATION_PRESENT=true   <-- false required
LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=2             <-- 0 required
STEP2D_MINOR_OPEN_BLOCKING_PERSISTENCE=2            <-- 0 required
CANONICAL_CONTENT_REVISION_PROVENANCE_LEAK=true     <-- false required

REV_001_CLOSED=false    REV_008_CLOSED=false
```

---

## 4. Four places my Step 2C2 evidence over-claimed closure

All verified by me directly, not accepted on report.

| # | My Step 2C2 claim | Reality |
|---|---|---|
| 1 | *"No occurrence of `favour` remains anywhere in the item"* | `LU_Q_004.answerRationale` still reads **`"Do someone a favour" is the fixed collocation.`** `grep` returns `favor`, **`favour`**, `favor`. I edited `prompt` and `distractorRationales`, and my assertion checked only `distractorRationales` — so it passed while the defect sat in a field I never opened. **D2-001** |
| 2 | *"A scan for pass names now returns zero rows"* | **`REQUIRES_STEP2D2_REVIEW` appears 7×** — 5 in the content draft's `reviewStatus`, 2 in the rubrics. I wrote those values in the Step 2C2 patch, then scanned with `STEP_2[ABCD]` / `Step ?2[ABCD]`, which structurally cannot match `STEP2D2`. The draft now asserts *"No revision identifier, pass name or review filename appears anywhere in this content draft"* — contradicted five lines above it. **D2-003** |
| 3 | `LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=0` | **2 bypassable** (`LST_Q_004`, `LST_Q_009`), plus 3 more whose option field is halved by a neighbouring stem. My test was per item; the defect class is per clip. **D2-004, D2-005, D2-006** |
| 4 | IR-002 *"no rationale states a rule untrue of English"* | `A clock time takes "at"` is untrue as a universal — `by/from/until/around/after half past nine` are all licit. Worse, it contradicts the item's **own** distractor rationale, which says `to` is used with clock times. The phase brief warned about this exact wording in advance and I shipped it anyway. **D2-007** |

Two aggravating facts about #2, both verified: the rubrics file has **no**
`excludedFromPersistence` declaration at all, and nothing enforces the one in
the content draft — `grep` for `excludedFromPersistence` and
`authoringOnlyFields` across all TypeScript returns **zero rows**. It is a
sentence in a JSON file with no consumer and no guard: credible as intent, not
as a guarantee.

---

## 5. The pattern, stated plainly

Seven instances of **one** failure mode across three passes: reporting a weak
check's result under a strong flag's name, by scanning one inflection or one
field and treating the silence as proof for the whole object.

```text
Step 2C   British-form count 0, from a word list I wrote myself
Step 2C   bypassable count 0, from a 6-word overlap proxy I had already
          documented as unable to decide bypassability
Step 2C   closed REV-006 without running the test its criterion describes
Step 2C2  revision/revising — matched the noun, missed the participle
Step 2C2  favor/favour — edited two fields, asserted over the whole item,
          assertion only checked the edited fields
Step 2C2  provenance scan with a pattern that cannot match the token the
          same patch had just introduced
Step 2C2  per-item bypass test where the defect class is per-clip
```

The structural fix is not "be more careful". It is: stop asserting over a
scope wider than what was checked, execute a criterion's test at the scope the
criterion names, and move the checkable claims into the validator as guards —
the provenance guard (D2-003), the blueprint/content version comparison
(D2-012) and the CEFR literal (D2-013) all belong there rather than in prose.

---

## 6. The 10 MINORs

**Single-field edits** — D2-001 (`favour` → `favor` in one rationale),
D2-007 (scope the `LU_Q_002` rationale: *"For the exact start time in this
sentence, use 'at'"*), D2-002 (`zip` → `zipper` in `RDG_PASSAGE_03` — the only
true dialect mismatch left in any learner-facing field, and never in scope for
any prior en-US finding, which shows the sweep followed the prior flag list
rather than the text).

**Option-set edits** — D2-004: `LST_Q_010`'s *"**The** projector trouble
delayed the start"* presupposes the trouble occurred, which is `LST_Q_009`'s
key; and `LST_Q_010`'s stem eliminates `LST_Q_009`'s *"called off before it
could begin"* outright. `LST_Q_009` is one of only two D4 Listening items, so
this removes the hardest discrimination the section has. D2-005: `LST_Q_004`'s
key `Online` **is** the world-knowledge default — the exact inverse of the
standard IR-009 set on the same clip.

**Before TTS** — D2-008: *"The north-side elevators are out of service too —
please use the main entrance"*. Elevators are vertical, entrances horizontal;
the remedy doesn't follow from the fault, and that gap is what `LST_Q_003`'s
third distractor trades on. IR-012's described defect is genuinely gone, so it
grades CLOSED — but a second, smaller implausibility was authored in its place
for the same distractor.

**Metadata and guards** — D2-003, D2-009, D2-010.

D2-009 deserves a note where I differ from the cold reviewer. It treats
`"this is Mai"` as establishing a conventionally female speaker, making this a
casting-constraint gap. My position is stronger: **a name does not establish
anyone's pronouns**, so `LST_Q_008`'s *"she would rather not"* and *"her
accommodating tone"* assume pronouns the script never supplies — the same
defect as IR-022, not its mirror. `LST_CLIP_03` has zero gendered pronouns on
a word-boundary search. Either neutralise the rationales as was done for
`LST_Q_010`, or record an explicit speaker-identity decision in the clip
metadata. Either way `LST_CLIP_03` joins the pre-TTS gate.

D2-010: `task_achievement` anchor 3 says *"within the stated length"* while
anchor 2 covers only under-length, so a complete 120-word response to a
90-word-max task matches no anchor cleanly. A grading-consistency hole, not a
ceiling — the full-range test still passes.

---

## 7. The 3 NOTEs

**D2-011** — `intelligibility` points pace at `fluency`, but `fluency` never
names pace in its description or any of its five anchors. Deliberately not
raised to a defect: IR-015's actual double-scoring defect *is* closed, and
adding speech rate to `fluency` would risk penalising a slow-but-smooth
speaker, which is worse than an inaccurate pointer.

**D2-012** — the blueprint file's `blueprintVersion` is
`FOUR_SKILL_PLACEMENT_V2`; the content package's is `V2_2026_01`. That is the
*scoring* version sitting in a *blueprint* version field, and the validator
never compares them. The content package is right; the blueprint artifact is
wrong. This is precisely the field confusion the project's version contract
exists to prevent.

**D2-013** — validator line 166: `/\b(Pre-A1|A1|A2|B1|B2|C1|C2)\b/` omits the
literal token `CEFR`, so `NO_CEFR_IN_CONTENT_PASS` would pass on *"CEFR
level"*. Content is clean today; the guard is narrower than its flag name —
the same class of problem as the regex silences above.

---

## 8. Safety

```text
DB_MUTATED=false   V2_CANONICAL_CONTENT_ROWS_CREATED=0   V2_ACTIVATED=false
AZURE_CALL_COUNT=0  TTS_CALL_COUNT=0  GEMINI_GRADING_CALL_COUNT=0  R2=0
CONTENT_FILES_MUTATED=false   HASH_MISMATCH_COUNT=0   MANIFEST_WRITTEN=false
all 6 artifacts byte-identical pre- vs post-review

DEF_003_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_04_VOICE_CASTING_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_03_VOICE_CASTING_STATUS=NEWLY_ADDED_TO_STEP3_PRE_TTS_GATE
IR_017_SAFE_TO_DEFER=true  (blocks activation only)
```

---

## 9. What this review does not establish

- Independence from the authoring model.
- Any psychometric property. `D1-D4` stays
  `DESIGN_HYPOTHESIS_NOT_CALIBRATED`.
- Rubric validity. Four anchor edits across three passes, never trialled
  against a real response.
- That the MINOR list is complete — this was a targeted re-review by design.
- That my self-certification is reliable. Two cold passes have each found real
  defects I had cleared. That is the finding to act on, not just the ten
  items.

---

## 10. Gate

Reopen **REV-001** (D2-001, D2-002) and **REV-008** (D2-007). Three of the ten
are single-field edits; two are option-set edits; the rest are metadata and
validator guards. D2-006 also changes how the gate is evidenced: the Listening
bypass test must be re-run **per clip**, not per item, with the result recorded
per clip.

Nothing was changed in this pass.
