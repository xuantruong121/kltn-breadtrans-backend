# Entry Diagnostic V2 — research basis

Research conducted 2026-10-25 for the BreadTrans Entry Diagnostic four-skill
rebuild. Purpose: ground the blueprint, the scoring contract and the level
claim in authoritative language-assessment guidance rather than in convenient
thresholds.

Target population: Vietnamese students / university students, approximately
16–24, general English. Purpose: **placement inside a learning product** (low
stakes, used to route a learner to suitable content), not certification.

**Revision note (correction pass).** An earlier draft of this document
overstated three things: it said BreadTrans "cannot claim CEFR, not even an
estimate"; it said the CEFR "rejects the traditional four-skill model"; and it
cited Cambridge/Aptis as support for a 30/30/20/20 cross-skill weighting. All
three are corrected below. The first two were wording errors; the third was a
reasoning error — the cited sources support equal item weighting *within* a
paper and a compensatory overall model, not any particular split *between*
skills.

---

## 1. Council of Europe — CEFR Companion Volume (2020)

**Source:** Council of Europe, *Common European Framework of Reference for
Languages: Learning, Teaching, Assessment — Companion Volume*, 2020.
<https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4>
Descriptor overview: <https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors>

**Principle.** The CEFR organises proficiency through illustrative "can-do"
descriptors arranged by *communicative language activity* — **reception,
production, interaction and mediation** — each with spoken and written modes.
This is a broader communicative model than a list of four isolated skills, and
the Companion Volume adds mediation and online-interaction descriptors that the
four-skill vocabulary does not express. Listening, Reading, Speaking and
Writing nevertheless remain **recognisable within reception and production**:
reception-spoken, reception-written, production-spoken, production-written.
The six levels A1–C2 are retained, the plus levels (A2+, B1+, B2+) are more
fully described, and Pre-A1 is added.

**How it affects BreadTrans.** The learner-facing organisation of V2 stays
**Listening / Reading / Speaking / Writing**, which is how the product and its
content library are already structured. What the broader model changes is *task
design*: a task should reflect that communicative competence is wider than an
isolated skill label, rather than testing a skill in artificial isolation. The
boundary that matters for us is reception vs production — the legacy form
violated it by measuring "Listening" with a printed script (a reading task) and
"Speaking"/"Writing" with multiple-choice items (no production at all).

**What we will use.** The reception/production boundary as the construct test:
Listening must require audio reception; Speaking and Writing must require
learner production. Subskill naming for receptive items (gist, specific detail,
purpose, speaker intention, inference) follows the Companion Volume's reception
descriptors.

**What we will not claim.** We will not assert that an item or task "is" a CEFR
level because we authored it with a level in mind; authored `intendedLevel` is
content-design metadata, not a calibration. We will **not** add Interaction or
Mediation modules simply because the framework contains them — they are not
required by this placement purpose.

---

## 2. Council of Europe — Manual for Relating Language Examinations to the CEFR

**Source:** Council of Europe, *Relating Language Examinations to the Common
European Framework of Reference for Languages: A Manual*, 2009.
<https://rm.coe.int/1680667a2d>
Companion: *Manual for Language Test Development and Examining* (ALTE/CoE, 2011)
<https://www.ecml.at/Portals/1/documents/CoE-documents/ManualLanguageTest-Alte2011_EN.pdf>

**Principle.** The Council of Europe **does** provide for examinations to be
related to the CEFR. Relating an examination is explicitly "a process of
building an argument", carried out through documented sets of procedures —
familiarisation, specification, standardisation / benchmarking, standard
setting, and validation. Standard setting is a core stage (Chapter 6),
supported by the Reference Supplement's quantitative methods: classical test
theory, IRT scaling, generalisability theory, factor analysis. The Manual
describes what can constitute a *trustworthy link*; it does not prescribe how
to build a good exam.

**How it affects BreadTrans.** CEFR linkage is a reachable goal, not a closed
door. What it requires is evidence BreadTrans does not yet have:

| Required procedure | BreadTrans status today |
|---|---|
| Familiarisation | not documented |
| Specification | partially — the V2 blueprint is the start of this |
| Standardisation / benchmarking | none (no benchmarked performance samples) |
| Standard setting | none (no panel, no cut-score study) |
| Validation | none (no candidate sample, no item calibration, no reliability study) |

The precise current conclusion is therefore: **BreadTrans V2 does not yet have
sufficient empirical and standard-setting evidence to make a defensible
CEFR-linked placement claim.** That is a statement about present evidence, not
about possibility. The previous implementation converted an internal band into
a CEFR label in the frontend (`Intermediate → B1`), which is exactly the
unevidenced link these procedures exist to prevent.

**What we will use.** The framing that a level claim requires an argument. Our
argument today supports only an internal placement band, so the product reports
internal bands. The table above doubles as the roadmap if CEFR linkage is
wanted later.

**What we will not claim.** For V2 as shipped: no CEFR level, no CEFR estimate,
no CEFR alignment, in either the backend result or the UI.

```text
LEVEL_SYSTEM=INTERNAL_BANDS
CEFR_CERTIFICATION_CLAIM=false
CEFR_ESTIMATE_CLAIM=false
FUTURE_CEFR_ALIGNMENT_POSSIBLE=true
FUTURE_CEFR_ALIGNMENT_REQUIRES_EMPIRICAL_VALIDATION=true
```

---

## 3. ALTE — Minimum Standards / Q-Mark

**Source:** ALTE, *Minimum standards for establishing quality profiles in ALTE
examinations*.
<https://www.alte.org/resources/Documents/minimum_standards_en.pdf>
Q-Mark / standard setting: <https://www.alte.org/Setting-Standards>

**Principle.** ALTE defines common minimum standards (18 in current ALTE
materials; older documents list 17) spanning the whole testing process: a
stated purpose and target population, a theoretical construct underpinning the
exam, marking "sufficiently accurate and reliable for the purpose and type of
examination", and comparability of parallel forms in content, stability,
consistency and grade boundaries. Compliance is established by **external
audit** (the Q-Mark).

**How it affects BreadTrans.** The design-side standards are achievable now:
stating purpose and population, documenting a construct, and documenting the
marking contract. The evidence-side standards are not: reliability across
administrations, parallel-form comparability (we author a single form), and
external audit.

**What we will use.** Document purpose, population, construct and the marking
contract explicitly, and version them with the assessment, so the design-side
standards are met and the remaining gap stays visible rather than implied away.

**What we will not claim.** Any ALTE conformity, Q-Mark, audit outcome, or
"exam-standard reliability".

---

## 4. Cambridge English — socio-cognitive validity framework; compensatory scoring

**Source:** Cambridge English, *Principles of Good Practice* (validity
framework; Weir's socio-cognitive framework, 2005).
<https://www.cambridgeenglish.org/Images/22695-principles-of-good-practice.pdf>
*Using the CEFR: Principles of Good Practice* (2011).
<https://www.cambridgeenglish.org/Images/126011-using-cefr-principles-of-good-practice.pdf>
Skills Test (four modules; adaptive receptive papers):
<https://www.cambridgeenglish.org/exams-and-tests/cambridge-english-skills-test/general/>
British Council, *Aptis Test Development Approach*, TR/2015/001 (item weighting).
<https://www.britishcouncil.org/sites/default/files/tech_001_barry_osullivan_aptis_test_-_v5_0.pdf>

**Principle.** Three points are relevant. (a) Validity is judged against the
test's intended purpose, and *the higher the stakes, the stricter the evidential
demands* that may reasonably be made. (b) Cambridge measures and **reports
skills separately** while treating overall ability as **compensatory** — strong
performance in one skill can offset weaker performance in another. (c) In
Aptis, all items **within** a receptive paper are equally weighted, and
candidates are told so in advance.

**How it affects BreadTrans.** (a) supports a short, low-stakes placement
instrument as a defensible design choice, provided the claim is not inflated.
(b) supports two things: reporting the four skills separately as a first-class
output, and computing any single overall figure compensatorily. (c) supports
equal weighting of items *inside* a skill, and the obligation to disclose it.

**What we explicitly do not take from these sources.** None of them establishes
a weighting *between* skills for a test like ours. Aptis speaks to equal
weighting within a paper, not across papers; Cambridge's compensatory model
says a strong skill may offset a weak one, not how much each should count.
Cambridge products themselves use a range of weighting arrangements, including
equal skill weighting. Any cross-skill split BreadTrans chooses is therefore a
**product design decision**, not an externally validated one, and must not be
presented as derived from these sources.

**What we will not claim.** Any equivalence to a Cambridge exam, to Aptis, or
to their reported scales.

---

## 5. Placement-test practice (secondary, used only for design sanity)

**Source:** *Challenges in the Design and Implementation of an English
Placement Test* (ERIC EJ1285643).
<https://files.eric.ed.gov/fulltext/EJ1285643.pdf>

**Principle.** Institutional placement tests trade measurement precision
against administration cost and learner fatigue, and are routinely far shorter
than certification exams because the decision they inform is reversible.

**How it affects BreadTrans.** Our placement decision is reversible, which
supports a compact form.

**What we will use.** Corroboration for form length only. Not used for any
scoring or level decision.

---

## 6. The weighting question — analysed, not assumed

The blueprint needs a policy for turning four skill scores into a placement.
Three candidates were compared. No external source decides this (see §4), so
the criteria are BreadTrans' own purpose and the measurement properties of our
own form.

Observation counts in the V2 blueprint: Listening 10 keyed items, Reading 10
keyed items, Speaking 2 rubric-graded tasks, Writing 1 rubric-graded task.

| Criterion | A — equal 25/25/25/25 | B — 30/30/20/20 | C — skill-profile first, overall secondary |
|---|---|---|---|
| Construct validity | Strong: the product claims four skills and treats them as equally worth measuring | Weaker: silently says productive skills matter less to placement | Strongest: each skill is a first-class result in its own right |
| Observations per skill | Ignored; 1 writing task carries a full quarter | Partially addressed, but by an unvalidated assumption | Addressed structurally — per-skill results are reported with their own evidence basis |
| Rubric uncertainty | Fully inherited by the overall figure | Reduced but not removed | Confined: rubric noise affects that skill's band, not the primary output's meaning |
| AI grading uncertainty | A single mis-grade of ~20 points moves the overall ~5 points, enough to cross a band edge | ~4 points | Same arithmetic, but the overall figure is explicitly secondary |
| Learner-facing interpretation | Simplest single number | Hard to explain why Writing counts less | Richer and directly actionable, since BreadTrans content is organised per skill |
| Receptive masking weak productive | Real risk | Higher risk (productive downweighted) | Mitigated: a weak productive skill is visible as its own band |
| One productive task causing variance | Highest impact on the headline result | Lower | Lowest impact on the primary output |

**Why B was rejected.** Its only argument was "more objective items implies
more reliable implies more weight". Item count is not reliability: reliability
depends on item discrimination and on the score distribution, neither of which
we have measured. B therefore encodes an unmeasured claim, and it downweights
precisely the two skills the legacy form could not measure at all.

**Why C was chosen over A.** A is defensible and is the least-assumption
*weighting*, but it keeps a single number as the primary output. C keeps A's
minimum-assumption weighting for the secondary figure while making the
per-skill profile the primary result. That matches how this product actually
routes learners — BreadTrans has separate Listening, Reading, Speaking and
Writing practice areas, so four bands are more actionable than one — and it is
the arrangement closest to Cambridge's "report skills separately, treat overall
as compensatory".

**Decision.** Skill-profile-first (C). The four per-skill bands are the primary
result. A single overall placement figure is additionally computed, equally
weighted across the skills that completed grading, and presented as a secondary
routing indicator.

Equal weighting is chosen for that secondary figure because, absent reliability
evidence, equal weights assert the least: any unequal split would claim we know
which skill our instrument measures better, which is exactly the unevidenced
reasoning rejected above.

```text
WEIGHTING_STATUS=PRODUCT_DESIGN_HYPOTHESIS
WEIGHTING_DECISION=SKILL_PROFILE_FIRST_EQUAL_WEIGHTED_SECONDARY_OVERALL
WEIGHTING_EMPIRICAL_VALIDATION_STATUS=NOT_YET_VALIDATED
```

Known weakness to carry: with a single Writing task, the Writing band is the
least stable of the four. Adding a second Writing task is the first change to
evaluate once pilot data exists.

---

## 7. Psychometric validation backlog (pre-claim, post-engineering)

Engineering completion is **not** psychometric validation. These two flags must
never be conflated:

```text
ENTRY_DIAGNOSTIC_V2_ENGINEERING_COMPLETE            — buildable and verifiable now
ENTRY_DIAGNOSTIC_V2_PSYCHOMETRIC_VALIDATION_COMPLETE — requires real learner data
```

Until the second exists, the assessment must not be described as validated,
calibrated, reliable, or CEFR-aligned.

### Item and form analysis (objective items)
- item difficulty (facility) per item
- item discrimination (point-biserial or equivalent)
- distractor performance — distractors chosen by nobody, or by stronger learners
- internal consistency for each receptive skill where the item count supports it
- answer-key confirmation against live response data
- score distribution per skill and overall (floor/ceiling effects)
- skill-score correlations (do the four skills behave as distinguishable constructs?)

### Productive tasks (Speaking, Writing)
- grading consistency across repeated submissions of the same response
- **human-vs-AI agreement on a validation sample** (exact and adjacent agreement)
- **score drift across provider and model versions** — re-score a fixed sample whenever the provider or model version changes, and alert on movement
- rubric dimension behaviour (are any dimensions redundant or never discriminating?)
- rubric-version comparability when a rubric changes

### Band boundaries and operations
- boundary stability — how many learners sit within a few points of a band edge
- test-retest or parallel-form evidence if a second form becomes feasible
- measured completion time: median, P75, P90, and per-section durations
- abandonment / dropout rate per section (fatigue)
- device split (mobile vs desktop) for the recording and writing tasks

### If CEFR linkage is later wanted
Run the Council of Europe Manual procedures in order — familiarisation,
specification, standardisation/benchmarking, standard setting, validation —
before any CEFR wording appears in the product.

---

## Decisions carried into the blueprint

| Question | Decision | Basis | Status |
|---|---|---|---|
| Level system | Internal bands; no CEFR level, estimate or alignment | CoE Manual — linkage needs procedures we have not run | current product decision; linkage possible later |
| Four-skill construct | Each skill measured by a task type matching its activity | CEFR reception/production split | design-grounded |
| Learner-facing organisation | Listening / Reading / Speaking / Writing | matches product and content library | design decision |
| Interaction / Mediation modules | Not added | not required by this placement purpose | design decision |
| Listening | Must require audio; script not readable before answering | CEFR reception | design-grounded |
| Speaking / Writing | Must be productive | CEFR production | design-grounded |
| Item weighting within a skill | Equal, and disclosed | Aptis TR/2015/001 | externally supported |
| Primary result | Four per-skill bands | Cambridge reports skills separately | design decision |
| Overall figure | Secondary; equally weighted across completed skills; compensatory | Cambridge compensatory model supports compensatory; the *split* is ours | **PRODUCT_DESIGN_HYPOTHESIS, NOT_YET_VALIDATED** |
| Weak-skill handling | Visible as its own band; drives recommendations | avoids masking without distorting the overall figure | design decision |
| Form length | ~41 min design estimate | stakes-proportionality; placement practice | **DESIGN_ESTIMATE, not measured** |
| Reliability / audit claims | None | ALTE requires evidence and external audit | — |

### Explicitly not claimed by BreadTrans after this phase

- No CEFR level, estimate, or alignment (possible in future, with the §2 procedures).
- No ALTE conformity or Q-Mark.
- No certification, equivalence, or exam-standard reliability.
- No calibrated item difficulty; authored `intendedLevel` is design metadata.
- No validated cross-skill weighting; the overall figure is a design hypothesis.
- No measured completion time; 41 minutes is a design estimate.

Learner-facing wording must describe the output as a **placement indication used
to route learning content**, reported per skill, using BreadTrans internal bands.

---

## Sources

- Council of Europe (2020), *CEFR Companion Volume* — <https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4>
- Council of Europe, *CEFR descriptors* — <https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors>
- Council of Europe (2009), *Relating Language Examinations to the CEFR: A Manual* — <https://rm.coe.int/1680667a2d>
- ALTE / Council of Europe (2011), *Manual for Language Test Development and Examining* — <https://www.ecml.at/Portals/1/documents/CoE-documents/ManualLanguageTest-Alte2011_EN.pdf>
- ALTE, *Minimum standards for establishing quality profiles in ALTE examinations* — <https://www.alte.org/resources/Documents/minimum_standards_en.pdf>
- ALTE, *Setting Standards / Q-Mark* — <https://www.alte.org/Setting-Standards>
- Cambridge English, *Principles of Good Practice* — <https://www.cambridgeenglish.org/Images/22695-principles-of-good-practice.pdf>
- Cambridge English (2011), *Using the CEFR: Principles of Good Practice* — <https://www.cambridgeenglish.org/Images/126011-using-cefr-principles-of-good-practice.pdf>
- Cambridge English, *Skills Test (General)* — <https://www.cambridgeenglish.org/exams-and-tests/cambridge-english-skills-test/general/>
- British Council, *Aptis Test Development Approach*, TR/2015/001 — <https://www.britishcouncil.org/sites/default/files/tech_001_barry_osullivan_aptis_test_-_v5_0.pdf>
- *Challenges in the Design and Implementation of an English Placement Test*, ERIC EJ1285643 — <https://files.eric.ed.gov/fulltext/EJ1285643.pdf>
