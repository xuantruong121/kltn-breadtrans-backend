# Published TOEIC tests: content and UX audit (2026-11-06)

Scope: the three published tests and Practice by Part.

| Test | Content |
|---|---|
| L&R Đề 01 (`/exams/2`) | ToeicExamSet 1, also used by Practice by Part |
| S&W Đề 01 (`/exams/3`) | `exam-3-speaking`, Writing set 1 |
| 4 Skills Đề 02 (`/exams/5`) | ToeicExamSet 3, `exam-5-speaking`, Writing set 3 |

Exam set 2 (DRAFT) and assessment 2 (ARCHIVED) are out of scope.

## 1. Structure (script, read-only)

`scripts/qa/toeic-published-content-audit.ts` on kltn_db:

```
EXAM1_NUMBERING_1_200=PASS        EXAM3_NUMBERING_1_200=PASS
EXAM1_STALE_AUDIO=0 of 54         EXAM3_STALE_AUDIO=0 of 54
EXAM1_MASTER_ORDER=PASS           EXAM3_MASTER_ORDER=PASS
EXAM1_MASTER_CLIPS_CURRENT=PASS   EXAM3_MASTER_CLIPS_CURRENT=PASS
SPEAKING_exam-3-speaking_ORDER=PASS
SPEAKING_exam-5-speaking_ORDER=PASS
FINDINGS=0
```

What these checks cover:
- options per Part, distinct and non-empty;
- key in range;
- Vietnamese explanation, and a letter named in it matches the key;
- production content guards (GRAPHIC, synonym, Part 5/6/7 shape, language, script length);
- Part 3 speaker labels have a gender;
- Part 7 single/double/triple ranges;
- Part 1, Speaking and Writing media answer HEAD 200;
- Writing slots: 2 keywords, e-mail for Q6-7, 300-word essay.

A silent script does not prove the content is right. Sections 2 and 3 are the reading.

Key spread, Part 1 only:
- exam 1: A/B/C/D = 2/2/0/2;
- exam 3: A/B/C/D = 4/2/0/0.

Changing it means re-recording Part 1 (the audio reads A–D).

## 2. Answers and wording (read)

**Exam 3, Parts 2–7.** The independent solver ran today after all of today's edits (`artifacts/ai-reasoning-verify-2026-11-06.md`).
- 193/194 correct on `medium`.
- The one miss, q192, was solved by hand: the key $24 is right.
- Part 1: all 6 pictures opened and checked against the statements. Keys right.

**Exam 1, all of Parts 2–7 read by hand; Part 1, 3 pictures re-opened (q2, q4, q6).**
Every key is right and every item has one defensible answer.

Weak spots:

| Item | Finding | Severity |
|---|---|---|
| q144 | Two distractors are not verb forms ("has beginning", "was begin"), so they are eliminated at sight. This is the A1 defect type. | medium |
| q145 | "have still" is not a usable form. | low |
| q77 | "A marketing strategy" sits close to the key "A new product launch": the talk is about a promotional timeline and an ad campaign. | medium |
| q59 | "A damaged item" for a blender whose motor failed; "defective" fits better. | low |
| q192 | The key relies on 12:00 not counting as "afternoon". | low |
| q147–175 | Passages are 40–70 words (real Part 7: about 100–250). Questions are literal look-ups. Several distractors are absurd ("Because only twelve library members exist", "To repair the hotel", "Bring tools"). | medium (difficulty, not correctness) |

**Speaking.**

| Set and item | Finding |
|---|---|
| S&W Q1–2 | Read-aloud texts are 29 and 27 words; real ones run about 40–60. |
| S&W Q8–10 | The stimulus is titled "BreadTrans Training Day". |
| 4 Skills Q8–10 | The stimulus is one run-on paragraph under the title "TOEIC Speaking information source". |
| 4 Skills Q9 | Not the "the caller states something wrong" form that Q9 uses on the real test. |

**Writing.** Sets 1 and 3 match the slot contract after A2 and D2.

## 3. UX on the harness (real Chromium)

Run: `scripts/qa/toeic-published-ux-browser.ts` on a clone of today's kltn_db. Screenshots are in
`D:/Study/KLTN/qa-artifacts/ux-audit-20261106/`. Result: 23 steps, 22 OK. The 1 BAD was the check's own fault: it read the page after leaving the tab. Screenshot 34 shows the schedule.

Seen working:
- The start screen offers both modes; Part choices show in practice mode.
- Practice shows only the chosen Parts.
- Part 3 shows no transcript; Part 2 hides its text.
- GRAPHIC groups render as a table: q62, q95, and 4 Skills q98.
- Part 7 double and triple documents render with headings.
- The practice result has no converted score and a per-Part analysis.
- The review page has explanations.
- At 390 px: 0 px overflow on the start screen, the graphic and the triple passage.
- The S&W and 4 Skills rooms hand over L&R, then Speaking, then Writing.
- The new pictures and the e-mail tasks display.
- No console errors.

UX findings:

| Area | Finding | Severity |
|---|---|---|
| Practice by Part | The countdown is always 120 min, whatever Parts are chosen: `toeic.service.ts` passes `exam.durationSeconds`. A Part 5-only practice shows 120:00. | medium |
| 4 Skills Speaking Q8–10 | The information box is a paragraph, not a list or table. The S&W set shows one item per line. | medium |

Not verified:

```
AUDIO_PLAYBACK=NOT_VERIFIED   (harness players show 0:00/0:00; media answered HEAD 200 earlier
                               and the masters were rebuilt from current clips)
EXAM1_PART1_PICTURES=3 of 6 re-opened today (q1, q3, q5 checked on 2026-11-04, unchanged since)
```

## 4. Fixes E1-E6 (2026-11-07)

All six findings fixed, with owner approval in the chat on 2026-11-07. Backup before the writes: `kltn_db_20261107_025548`. Rollback files are in `.local-backups/toeic-e/`.

| Fix | What changed | Commit |
|---|---|---|
| E1 | Practice by Part takes the minutes of its Parts: P1 5, P2 9, P3 17, P4 14, P5 11, P6 8, P7 56 (sum 120). The Part picker shows the time. | BE `3cd066f`, FE `d6e892a` |
| E2 | 4 Skills Q8-10 schedule, one item per line under "Lịch hội nghị". Q9 is a correct-the-caller item, with new prompt audio. The generator no longer stores the English title. | `a1fe104`, `7288ccb`, `c5348cc` |
| E3 | Exam 1: q144, q145, q77, q59 and the q192 passage. | `7288ccb` |
| E4 | Exam 1 Part 7 q147-175 rewritten. | `7288ccb` |
| E5 | S&W read-aloud texts lengthened; the BreadTrans name dropped from the Q8-10 schedule. | `7288ccb` |
| E6 | Part 1 key spread is now exam 1 2/1/2/1, exam 3 1/2/1/2. Five clips at `-v7`; masters rebuilt (exam 1 `e48fafaa`, exam 3 `da786b9f`). | `7288ccb` |

```
STRUCTURAL_AUDIT_AFTER=PASS          (FINDINGS=0, STALE_AUDIO 0 of 54 on both exams, masters current)
E4_SOLVER_EXAM1_PART7=54/54          (medium; the first of two calls returned invalid JSON, retried)
UX_WALK_AFTER=30/30 OK               (qa-artifacts/ux-verify-20261107; Part 5 practice 10:58, Part 3+4+7 86:5x)
AUDIO_PLAYBACK=PASS on 2 of 6 clips  (owner listened to Q9 and exam 3 Part 1 q3; the other 4 Part 1 clips not heard)
```

Correction (2026-11-07): this is not a production risk. `reviewBatch` (toeic-ai-exam.service.ts) reviews AI batches of at most 3 groups (`plan.slice(offset, offset + 3)`), about 9-15 Part 7 questions per call. The 54-question call came from the verification script, which put a whole Part in one call. A Cloudflare reply that is not JSON falls through to Gemini once (answer-review.service.ts `run`).
