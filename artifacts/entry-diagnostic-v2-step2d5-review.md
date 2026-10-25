# Entry Diagnostic — Step 2D5 final targeted content approval

```text
STEP2D5_REVIEW_COMPLETE=true

STEP2D5_VERDICT=CONTENT_APPROVED
ENTRY_DIAGNOSTIC_CONTENT_REVIEW_PASS=true

STEP2E_LIVE_PERSISTENCE_ALLOWED=false

CONTENT_BLOCKER_COUNT=0   CONTENT_MAJOR_COUNT=0
CONTENT_PERSISTENCE_BLOCKING_MINOR_COUNT=0
NONBLOCKING_MINOR_COUNT=3   NOTE_COUNT=2
```

Reviewed against content version **6**.

**Approval covers authored content only.** It does not approve database
migration, canonical import, runtime integration, audio generation, AI grading,
final scoring or activation. Content approval never authorises a database
mutation.

---

## 1. Independence

```text
INDEPENDENCE_MODE=COLD_CONTEXT_PROXY
STAGE_A_FINDINGS_FROZEN_BEFORE_RECONCILIATION=true
```

I made the Step 2C5 stem change under review, so I am not the reviewer. Stage A
was run by an agent with no session context, barred from all 22 prior review
artifacts, and **deliberately not told what the stem had been changed to** — it
had to read the live file and judge.

It reports reading none of the forbidden artifacts and inspecting no diff or
history; the only git command it ran was `git status --porcelain artifacts/` to
confirm it had mutated nothing, which returns filenames and status only.

**This is the first cold pass in the sequence to approve.** The four before it
each found something real I had cleared: a MAJOR dismissed twice, four
over-claimed closures, two more over-claims plus eleven unexamined defects, and
a MAJOR of a class I had just fixed on the neighbouring clip.

---

## 2. D4-001 — independently confirmed closed

The reviewer reached this in Stage A, before opening either reconciliation
artifact.

```text
LST_Q_010  "What reason does the speaker give for how long the presentation ran?"
```

> *"how long the presentation ran" is **direction-neutral**. It does not say
> shorter, longer, over-running or cut short.*

The decisive test it ran: **`LST_Q_010`'s option set contains no technical,
equipment or malfunction content at all** — all four are time/omission
hypotheses — so nothing in it realises `LST_Q_009`'s key proposition.

It did find a weaker effect and named it honestly: the shared frame nudges away
from Q009's two positive options toward its two non-positive ones. But it
**eliminates no option and singles out none**, leaving a live two-way field →
`WEAK_CONTEXTUAL_PRIOR`, not counted.

Reverse direction: `HARMLESS_SHARED_CONTEXT`. Q010's key shares no material
with any Q009 option, and if anything the pressure runs **the wrong way** for a
learner — Q009's key suggests Q010's *distractor* "ran out of time", since a
projector failure is exactly what eats a slot.

```text
D4_001_CLOSED=true
LST_Q_009_AUDIO_REQUIRED=true   LST_Q_010_AUDIO_REQUIRED=true
LST_Q_010_STEM_NATURALNESS_PASS=true
LST_Q_009/010_EXACTLY_ONE_DEFENSIBLE_ANSWER=true
CLIP_04_CROSS_ITEM_LEAK_COUNT=0
```

Construct preserved: the script never says *"I ran twelve minutes **because** I
cut a section"*. The learner must bind an elliptical answer to the next
sentence and reject two salient external causes, one of which is explicitly in
the audio as a competing explanation.

---

## 3. Listening regression — all four clips

```text
LISTENING_AUDIO_REQUIRED_ITEM_COUNT=10   BYPASSABLE=0
CLIP_01=0  CLIP_02=0  CLIP_03=0  CLIP_04=0   LISTENING_CROSS_ITEM_LEAK_COUNT=0
```

Two weak priors reported but not counted — `LST_Q_004`'s "this week" marking a
temporary arrangement (leaving a 1-in-3 guess, which is not an answer), and the
`LST_Q_006`→`LST_Q_007` alignment, where Q007's other three options posit wholly
different scenarios so no single frame dominates.

Worth repeating, because it is a design compliment and it is earned: several
distractors are built to catch the answer **world knowledge** supplies, with the
audio explicitly closing them off — *"your ID card alone won't start the
machines"*, *"our online booking system is down"*.

---

## 4. Package integrity

```text
TOTAL_ITEMS=29   OBJECTIVE_ITEMS=25   OBJECTIVE_KEYS_VALID=true (0 defects on 25/25)
ACTUAL_CONTENT_VERSION=6
37 draft keys, 0 duplicates   0 unresolved references   order clean 1-29
BLUEPRINT_CONFORMANCE_PASS=true   tier {D1:5 D2:9 D3:7 D4:4} matches exactly
HASH_MISMATCH_COUNT=0   VALIDATOR_CHECK_MODE_READ_ONLY_PASS=true
CONTENT_TARGET_STABLE_DURING_REVIEW=true   CONTENT_FILES_MUTATED=false
```

It also **hand-checked `blueprint.scoring`**, which the validator does not cover
(D4-010), and found it self-consistent — weights summing to 1.00 with
LanguageUse 0, `perSkillFormulas` denominators matching actual item counts, and
"mean across the 2 graded tasks" matching both rubrics.

**Collateral-change check: PASS.** All three passage word counts match recomputed
values exactly; every key still matches its rationale and `CORRECT` index; and
the two CLIP_04 rationales are coherent with the **new** stem with no trace of
the removed framing — precisely the inconsistency an incomplete edit would have
left.

---

## 5. The three MINORs

### D5-001 — `internalLabel` is answer-bearing *(verified by me)*

The most striking thing in the report, and it checks out:

```text
LST_CLIP_04.internalLabel  "Presentation that did not go to plan"
LST_Q_009 key              "A technical problem spoiled their plan"

LST_CLIP_01.internalLabel  "Two students deciding to work together"
LST_Q_001 key              "Working on their project together"

RDG_PASSAGE_02.internalLabel "Why rereading notes feels better than it works"
RDG_Q_004 key                "Rereading feels effective but recalling from memory works better"
```

**The exact proposition D4-001 was raised to remove from the stem still sits,
near-verbatim, in that clip's own metadata.** The field is correctly named and
nothing suggests it is learner-facing — hence MINOR, not MAJOR — but if any
delivery step ever mapped it to a title, caption, alt text or player label,
D4-001 reopens as a `DIRECT_ANSWER_LEAK` on three of four Listening clips at
once, in a field no content review would look at.

**Partial mitigation the reviewer could not weigh**, because it sits outside the
content package it was given: `internalLabel` is already on
`AUTHORING_ONLY_FIELDS` in `v2-import-mapper.ts:27` and in the persistence
contract's exclusion list, and `assertNoAuthoringFields` throws on it — covered
by 37 passing mapper tests. So the **import** path cannot carry it. What is
still genuinely missing is what the reviewer asks for: an executable test that
no `internalLabel` string appears in any learner-facing payload. The mapper
guard does not protect a future delivery path that reads the artifact directly.

### D5-002 — `ground-floor` / `second-floor` *(verified by me)*

The script contains both. A building with a ground floor and a second floor and
no first floor is a BrE/AmE hybrid in a clip declaring `en-US` /
`general American`. Zero construct impact — no item depends on the clause —
raised from NOTE purely on **cost asymmetry**: a two-word edit now versus a TTS
regeneration plus a hash change after audio is cut. Must be decided **before
Phase E**.

The validator cannot catch it, and says so itself: `KNOWN_BRITISH_FORM_COUNT=0`
ships with the caveat that the list is fixed and absence proves only that those
forms are absent.

### D5-003 — British rubric identifiers

`criterionKey: "organisation"` / `"task_fulfilment"` are identifiers the AI
grader must match character-for-character. **No learner-facing field is
affected** — the reviewer swept every prompt, instruction, script, text and
option and found all learner English correctly American.

This is the same fork recorded as **D3-007 in Step 2C4**, where the decision was
to **keep** them, conditional on any rename happening before the first rubric
row is persisted (`DiagnosticRubric.criteria` is a Json snapshot). The reviewer
reached the same fork independently. The decision stands; recorded again so it
is not silently re-litigated.

---

## 6. Two criticisms of my own work — both accepted

**"No basis to prefer" was too strong.** My Step 2C5 reasoning claimed a learner
has *no basis* to prefer Q009's key. The reviewer's correction: the shared frame
does shift probability; **"no material basis"** is the accurate claim. Right
conclusion, overstated reasoning.

**`assertedGuards` was the project's recurring failure mode, inside the fix for
it.** I recorded that the new stem is "asserted free of the tokens plan,
shorter, short, problem and technical". True — but *token-absence is not
leak-absence*, and a lexical guard reported inside a leak-closure record is
exactly the narrow-check-under-a-broad-flag shape earlier passes were faulted
for. What closes D4-001 is the independent **semantic** check, not my token
list.

In my favour, the reviewer judges Step 2D4's **D4-002** overstated: option `[0]`
"It was submitted after the deadline" *is* bounded and plausible, so the key is
not the only bounded option. It rates NOTE, not MINOR.

---

## 7. What this approval does **not** mean

- **It does not authorise a database write.** `STEP2E_LIVE_PERSISTENCE_ALLOWED`
  stays `false`: GAP-1 is unresolved, no importer exists, and D4-011 means a
  careless import would take the diagnostic down for every learner.
- **It does not mean the runtime can deliver this content.** D4-012 and D4-013
  are designs, not implementations.
- **It does not clear a path to scoring.** The blueprint declares its own
  `levelSystem` `UNRESOLVED_DO_NOT_IMPLEMENT`, with DEF-004 open.
- **No psychometric property is established.** D1–D4 uncalibrated, equal
  weighting a declared hypothesis, neither rubric trialled against a real
  response.
- It is a **cold-context proxy** for independence, not human
  assessment-specialist validation.

```text
DB_MUTATED=false  V2_CANONICAL_CONTENT_ROWS_CREATED=0  V2_ACTIVATED=false
AZURE=0  TTS=0  GEMINI_GRADING=0  R2=0
CONTENT_FILES_MUTATED=false  (4 artifacts byte-identical, re-verified after the report)
```

**Next:** Phase B, persistence foundation — the only phase that writes to the
database, and separately authorised. D5-002 decided before Phase E; D5-003
before the grading contract.
