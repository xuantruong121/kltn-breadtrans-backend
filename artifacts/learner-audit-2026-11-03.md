# Learner-side audit, 2026-11-03

Trigger: the owner found that the daily quest "Hoàn thành 1 bài luyện kỹ năng"
opened the TOEIC exam list. The audit looked for that class of defect (a
button that leads somewhere its promise cannot be kept) across the learner
side, and re-ran the existing learner QA suites.

Target: disposable harness only. Database `learner_audit` on harness-pg :5460
(a `pg_dump` clone of `kltn_db`, taken read-only), BE :3101 with the
deterministic AI server, FE :3100 from the fix worktree, fake private bucket
:9460. No write to `kltn_db`, no real AI or Azure call, :3000/:3001 untouched.
Real R2 was only read (HEAD and LIST) to check media the harness cannot serve.

## Defects found and fixed

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 1 | Quest `COMPLETE_QUIZ` advances only on standalone Listening/Reading/Writing practice, but its button said "Làm bài kiểm tra" and opened `/exams` (BE `getQuestAction` and an FE guard). Finishing a whole TOEIC exam left it at 0/1. | BE action "Luyện kỹ năng" → `/listening`; FE `resolveQuestAction` (now in `dashboardUtils.ts`) follows today's planned L/R/W practice, never `/exams` or `/toeic`. | `learner-cta-truth.ts`: button → `/listening/48`, practice done, quest 1/1, +8 Bánh mì |
| 2 | Entry Diagnostic advice marked a cited quiz OPEN from the plan alone; a learner placed at Cơ bản in Reading was sent to an Intermediate quiz that refused them. | `DiagnosticAdviceCatalogService` takes the item pages' own access decision (plan and level); such links are LOCKED with "Cần mở mức …". | `finalization-diagnostic-v2-browser.ts`: the recommended resource now opens |
| 3 | Dashboard "Bắt đầu" rows link to `/listening?mode=`, `/reading?difficulty=`, `/exams?paper=`; none of those pages read the parameter. The exam table listed "TOEIC Mini Practice", which does not exist; a Speaking row sent an unread `?category=`. | Catalogs start from the linked filter (`filterFromParam`); filter buttons expose `aria-pressed`; the two dead rows are gone. | `learner-cta-truth.ts`: each link opens with its filter selected |

```
DEFECT_QUEST_BUTTON=FIXED
DEFECT_ADVICE_LEVEL_LOCK=FIXED
DEFECT_DASHBOARD_FILTER_LINKS=FIXED
```

## Checks run after the fixes

| Check | Result |
|---|---|
| `learner-cta-truth.ts` (new): every active quest button, doing its activity, quest progress and payout, filter links | 22/22 PASS |
| `learner-mobile-sweep.ts` (new): 26 learner pages at 390 px and 1366 px, no sideways scroll, page error, API 5xx or leaked `undefined`/`NaN` | 52/52 PASS |
| `finalization-learner-crawl.ts`: every learner route, fresh account | 30 routes, no API or page error (the `/listening/1` audio 500 is the harness's empty private bucket, see media) |
| `cp57-learner-journeys-browser.ts` | 10/10 |
| `finalization-practice-browser.ts` | 17/17 |
| `finalization-writing-practice-browser.ts` | 10/10 |
| `cp57-ledger-separation-api.ts` | 10/10 |
| `cp57-writing-xp-api.ts` | 23/23 |
| `cp58-entitlements-api.ts` | 27/27 |
| `finalization-grammar-vocab-api.ts` | 23/23 |
| `finalization-toeic-api.ts` | 20/20 |
| `finalization-toeic-full-api.ts` (assessment 1) | 16/16 |
| `finalization-toeic-stats-browser.ts` | 19/19 |
| `finalization-shop-api.ts` | 16/16 |
| `finalization-arena-browser.ts` | 8/8 |
| `finalization-profile-browser.ts` | 14/14 |
| `cp60-pet-exam-browser.ts` | 6/6 |
| `finalization-reward-policy-api.ts` | 10 PASS; TOEIC L&R and S&W pay nothing and advance no quest, as the policy says |
| `finalization-diagnostic-v2-browser.ts` | 53 PASS, 2 stale checks (below) |
| `finalization-speaking-practice-api.ts` | 16 PASS, 1 harness-only (below) |
| `finalization-toeic-paper-browser.ts`, `finalization-toeic-result-browser.ts`, `toeic-exam-content-access-api.ts` | everything except the continuous Listening master, which is harness-only (below) |

```
LEARNER_CTA_TRUTH=PASS
LEARNER_MOBILE_SWEEP=PASS
LEARNER_CRAWL=PASS
REWARD_POLICY_TOEIC_PAYS_NOTHING=PASS
BE_CI=PASS (2227 tests)
FE_CI=PASS (802 tests, lint 0 errors, tsc, next build --webpack)
```

## Failures that are not app defects

- **Harness media.** The private bucket is a local fake, so practice audio
  (`/quizzes/:id/questions/:id/audio`) and the TOEIC continuous Listening
  master answer 500 / `NOT_PUBLISHED` there. On the real buckets (read-only
  HEAD/LIST): 123/123 listening audio keys, 175/175 Speaking and published
  TOEIC audio keys, and the masters of both published L&R exams (exam 1
  `f0b79903ec175e8b.v1.mp3`, exam 3 `65bb00b70125f503.v1.mp3`) exist.
  Published exams have no group missing audio or a Part 1 picture.
  `MEDIA_ON_REAL_R2=PASS`, `MEDIA_PLAYBACK_ON_REAL_APP=NOT_RUN`.
- **Scripts older than the level lock.** Several suites pick B1–C1 content
  for a fresh learner and get the intended 403 `LEVEL_LOCKED`
  (`finalization-four-skill-journeys.ts`, `finalization-practice-api.ts`, the
  Writing step of `finalization-reward-policy-api.ts`).
- **Scripts older than other product changes.** `cp57-dashboard-browser.ts`
  expects no onboarding step; `finalization-plans-api.ts` and
  `finalization-practice-entitlements.ts` use courses (removed 2026-11-01) and
  PayOS (blank on the harness); `finalization-diagnostic-v2-browser.ts`
  expects a `recommendations` field the API no longer returns, and its CEFR
  check trips on the disclaimer "không quy đổi sang trình độ CEFR".
- **Harness helper.** `harness-api.newStudent` used the label's capitals in
  the e-mail; registration lower-cases it, so the ADMIN promotion missed and
  plan grants got 403. Fixed in this branch.
- **Not run:** `finalization-speaking-practice-browser.ts` (needs an explicit
  owner approval to read the real private bucket), `cp60-acc-nav-browser.ts`
  and `cp60-feedback-ui-browser.ts` (phase scripts from an earlier
  checkpoint), `entry-diagnostic-browser-regression.ts` (its own isolated
  target setup). Real Gemini and Azure grading: `NOT_RUN`.

## Open points for the owner

- "Thực hành phát âm" (`PRACTICE_SPEAKING`, 5 lượt) advances on any Speaking
  practice, not only pronunciation tasks. Its button opens the planned
  Speaking exercise. Keep, or restrict it to pronunciation tasks?
- A missing private object answers 500 rather than 404. On the real bucket no
  object is missing today, so this is robustness only.
