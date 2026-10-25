# Entry Diagnostic V2 — Step 2D3 final cold targeted content gate

```text
STEP2D3_REVIEW_COMPLETE=true
STEP2D3_VERDICT=REVISIONS_REQUIRED
ENTRY_DIAGNOSTIC_V2_CONTENT_REVIEW_PASS=false

BLOCKER_COUNT=0   MAJOR_COUNT=0
PERSISTENCE_BLOCKING_MINOR_COUNT=0   PRE_TTS_CONTENT_BLOCKING_ISSUE_COUNT=0
NONBLOCKING_MINOR_COUNT=13   NOTE_COUNT=6
```

Reviewed against content version **4** (the brief expects 3; Step 2C3 bumped it —
the brief's expectation is stale, the content is not wrong).

---

## 1. Independence

```text
INDEPENDENCE_MODE=COLD_CONTEXT_PROXY
STAGE_A_FINDINGS_FROZEN_BEFORE_RECONCILIATION=true
```

I authored this content and every revision pass including Step 2C3, so I am not
the reviewer. Stage A was run by an agent started with no session context and
barred from all eleven prior review and evidence artifacts. It was deliberately
not told any expected version values, so its reading of the actuals is
independent of both the brief and me.

Not claimed: human assessment-specialist independence, or psychometric
validation.

Three cold passes have now each found real defects I had cleared — a MAJOR that
two of my passes dismissed, four over-claimed closures, and now two more
over-claims plus eleven defects no previous pass examined at all.

---

## 2. Why the verdict is revisions-required when the reviewer said approve

**The cold reviewer recommended `APPROVE_FOR_DRAFT_PERSISTENCE`.** Its reasoning
is sound and I am not overruling it on the content. I am overruling it on the
gate arithmetic, because §17 states two of its approval conditions as values
that are not met:

| §17 criterion | Actual |
|---|---|
| `LISTENING_CROSS_ITEM_LEAK_COUNT=0` | **1** — `CLIP_03`, graded **MATERIAL** (D3-001) |
| canonical provenance safe / mapping guard | `PERSISTENCE_MAPPING_AUTHORING_METADATA_GUARD_PASS=false` (D3-009) |

The reviewer judged the CLIP_03 leak deferrable because no learner is scored off
a DRAFT and the script stays byte-unchanged. That is reasonable product
reasoning. But the criterion is stated as a number, and self-approving against
an explicit unmet number is precisely the failure mode this gate sequence
exists to prevent. Relaxing it is a decision for the product owner to take
explicitly, not for me to take silently.

**Substantively the content is sound**: internally consistent, structurally
conformant, byte-stable, no CEFR or process-provenance leakage in canonical
content, and no item the reviewer could answer without its audio or passage. If
you decide to accept the documented MINOR list and persist inactive DRAFT rows
now, that is defensible — it is just not a passed gate.

---

## 3. Two Step 2C3 flags of mine that were wrong

Both verified by me directly against the files, not accepted on report.

**`LISTENING_CROSS_ITEM_LEAK_COUNT=0` → actually 1.** I recorded the
`LST_Q_006` → `LST_Q_007` cue as a residual that "neither eliminates an option
nor names the key" and counted it as zero. The reviewer graded it **MATERIAL**:
exactly one of Q007's four options realises the presupposition Q006's stem
asserts — *"To request one more thing for the form"* — while payment, refusal
and meeting are all off-dimension, and the option's wording mirrors the stem
closely. It also notes the pair is largely redundant *even with* the audio. I
accept its reading over mine; mine was the self-serving one.

**`PERSISTENCE_MAPPING_AUTHORING_METADATA_GUARD_PASS=true` → false.** I set it
true on the ground that deleting the `authoringOnlyFields` block "proved there
is nothing to map". There is a great deal to map — the same note then lists
eight authoring-only field families that still exist. Deleting the declaration
removed the only in-artifact signal a future importer author would meet, and
nothing executable replaced it. A strong flag name over a check not performed,
in the flag that specifically guards the next step.

Also: `LEARNER_FACING_EN_US_RESIDUE_COUNT=0` → **1**. `"Overgeneralises"` in
`RDG_Q_010.distractorRationales[1]`. My validator's stem list is
`organis|recognis|apologis|realis|analys`, which structurally cannot see
`generalis`. Note what did work: the tool-level fix held — the flag is honestly
named `KNOWN_BRITISH_FORM_COUNT` and carries "absence proves only these forms
are absent". I then went and made the broad claim anyway in my own artifact.
The caveat was right; I ignored my own caveat.

---

## 4. The three findings that matter most — all blueprint, all verified by me

**D3-004 — the blueprint argues for the wrong weights.** This is the most
dangerous finding in the pass and I never checked it across four revision
passes:

```text
overallWeights   {L:0.25, R:0.25, S:0.25, W:0.25}      receptive 50 / productive 50
overallFormula   round((L + R + S + W) / 4)
counts.writingProductiveTasks  2

overallWeightRationale  "Not equal-by-default. … Speaking carries 2
                         rubric-graded tasks and Writing 1 … Receptive 60 /
                         productive 40 is the deliberate compromise"
knownWeakness           "With a single Writing task the Writing band is the
                         least stable of the four."
weightingRationale      "The secondary overall figure uses EQUAL weighting."
```

The blueprint is the specification the V2 scorer gets written from, and one of
its two weighting paragraphs argues 60/40 from a one-Writing-task premise that
is no longer true. An implementer reading the rationale rather than the
dictionary ships the wrong weights.

**D3-012 — DEF-004 is understated; the cutoffs disagree too.**

```text
blueprint.levelSystem.bands   Starter 0-44 | Foundation 45-64 | Intermediate 65-79 | Upper 80-100
resolveEstimatedLevel()       Intermediate >= 75 | Foundation >= 45 | else Starter
```

A learner at 70% is `Intermediate` by the blueprint and `Foundation` by the
code. That mid-scale boundary conflict survives even if the fourth band is
added, so the band count and the `Intermediate` lower bound have to be resolved
in one decision — without inventing a fourth cutoff by inference.

**D3-003 — the declared tier spread does not reconcile.** Blueprint declares
`{D1:4, D2:7, D3:5, D4:4, range:D1-D2:2, range:D2-D4:2, D1-D3:5}`; the items
actually give `D1:5 D2:9 D3:7 D4:4` across all 25. No grouping reproduces the
declared figures, and the validator prints the real distribution but never
compares it to the claim.

---

## 5. Guard fixture tests — my guards are narrower than their names

The reviewer built throwaway fixtures in its own temp directory (nothing
injected into any canonical file) and exercised the guards end to end.

**Provenance guard** fires on 6/6 ordinary tokens, **silent on 7/7 awkward
variants**: `REV_014`, `REV-7`, `REVISION-012`, `IR017`, `IR_017`, `Pass 2C`,
`Phase 2C`, `REQUIRES STEP`, `STEP 2 D 2`, and **any `REV-nnn` preceded by an
underscore** (`STATUS=CLOSED_BY_REV-014`) — because `\b` does not fire between
`_` and `R`. It also hardcodes only the `IR` and `D2` prefixes, so `D3-nnn` and
`DEF-nnn` pass straight through. The token shape most likely in this project is
a `SCREAMING_SNAKE` status value: the one shape my anchor defeats. (D3-008)

**CEFR guard** does not scan the blueprint at all. Fixture-proved that
`levelSystem.bands[3].band="B2"` — a placement *result* band — and
`difficultyScale.tiers[0].cefrEquivalent="A1"` — an *item difficulty* — both
pass while the flag still reads true. Today's blueprint CEFR strings are all
legitimate rationale so `CEFR_CONTENT_LEAK_COUNT=0` is correct, but the guard
cannot see the one file where a CEFR token could reach a band field. (D3-010)

**Version guard** compares like with like, and fires on three planted
mismatches — but is silent on a wrong `rubrics.scoringVersion` and on any
`contentVersion` disagreement, neither of which is compared. (D3-014)

**`NO_DB_IDS` is a dead check.** It applies `/\bid\b"\s*:\s*\d/` to `allKeys`,
an array of draft-key *strings*, so it can never fire. Confirmed at line 149. I
was carrying a guard that cannot fail while writing about guards that only ever
pass. (D3-016)

---

## 6. What held up

```text
TOTAL_ITEMS=29  L10/clips4  R10/passages3  S2  W2  LU5  OBJECTIVE 25
OBJECTIVE_KEYS_VALID=25/25   structure problems 0/25   36 draft keys, 36 unique
UNRESOLVED_DRAFT_REFERENCES=0      V2_SCORER_FAILS_CLOSED=true
HASH_MISMATCH_COUNT=0   CONTENT_TARGET_STABLE_DURING_REVIEW=true

LU_Q_002_VALID=true  (only "at" defensible; "to" survived the standard that broke "by")
LU_Q_002_RATIONALE_VALID=true   OVERGENERALIZATION_PRESENT=false
LISTENING_AUDIO_BYPASSABLE_ITEM_COUNT=0   (all 10 require their audio)
LST_CLIP_02_SEMANTIC_REGRESSION_PASS=true  LST_Q_004_AUDIO_REQUIRED=true
LST_Q_005_CROSS_ITEM_LEAK_FOUND=false
LST_CLIP_04_INFERENCE_VALIDITY_PASS=true
LST_CLIP_03_PRONOUN_INTEGRITY_PASS=true   unsupported gender assumptions: 0
SPEAKING_RUBRIC_REGRESSION_PASS=true   WRITING_RUBRIC_REGRESSION_PASS=true
D2_011_SAFE_TO_RETAIN=true
CEFR_CONTENT_LEAK_COUNT=0   ITEM_TIER_TO_RESULT_BAND_MAPPING_DEFINED=false
ORIGINALITY 11/11 objects, 0 matches, 0 unresolved
```

The booking-channel inversion works: `Online` is genuinely wrong, `LST_Q_004`
cannot be answered from world knowledge, and the outage, booking channel,
elevator fault and remedy form one coherent announcement. The reviewer rechecked
originality on **all 11** source objects rather than the 1 I judged materially
rewritten — broader coverage, same result.

---

## 7. Open before the next steps

**Before any row is written** — D3-011. The mapping is undefined and three
collisions are waiting: `DiagnosticQuestion` has one rationale column,
`explanation`, which `diagnostic.service.ts` returns to the learner at two
sites, so the obvious mapping for `answerRationale` is exactly the forbidden
one; `distractorRationales` is a positional array with `CORRECT` at the key
index while the delivery layer permutes option order per attempt, so positional
storage must be re-indexed or every rationale attaches to the wrong option; and
`difficultyTier` must map to `difficulty`, never to `intendedLevel`.

**Before the V2 scorer** — D3-004, D3-003, D3-012.

**Deferred, justified:**

```text
IR_017  instruction language        blocks activation only
DEF_003_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_03_VOICE_CASTING_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
LST_CLIP_04_VOICE_CASTING_STATUS=DEFERRED_TO_STEP3_PRE_TTS_GATE
DEF_004_RESULT_BAND_MODEL_MISMATCH=OPEN  (widened by D3-012)
  blocks draft persistence: false — zero band tokens in content or rubrics,
  independently confirmed, so the bands are scorer output, not content
  blocks V2 scorer implementation: true
```

---

## 8. Safety

```text
CONTENT_FILES_MUTATED=false   (all 5 files byte-identical pre vs post)
DB_MUTATED=false   V2_CANONICAL_CONTENT_ROWS_CREATED=0   V2_ACTIVATED=false
  legacy 1 assessment / 20 questions; all 5 V2 tables verified empty
AZURE_CALL_COUNT=0  TTS_CALL_COUNT=0  GEMINI_GRADING_CALL_COUNT=0  R2=0
```

---

## 9. What this gate does not establish

- Human or psychometric independence.
- Any psychometric property. `D1-D4` stays `DESIGN_HYPOTHESIS_NOT_CALIBRATED`.
- Rubric validity — five anchor edits across four passes, never trialled.
- That a future importer is safe (D3-009, D3-011).
- That the finding list is complete. Three cold passes have each found defects
  I had cleared, and this one found eleven that no previous pass examined.

The pattern across this whole sequence is worth stating once more: every time I
have reported a flag, the error has been in the same direction — a narrow check
reported under a broad name. The tool-level fixes worked. The reporting-level
discipline did not hold on its own.
