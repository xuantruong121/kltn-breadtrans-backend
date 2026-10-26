# BreadTrans — existing feature inventory (finalization baseline)

Started 2026-10-26. Scope is frozen to what the repository already contains. Status vocabulary:
`EXISTING_COMPLETE`, `EXISTING_PARTIAL`, `EXISTING_BROKEN`, `EXISTING_UNVERIFIED`,
`EXISTING_UNREACHABLE`, `NOT_IMPLEMENTED`. Evidence levels: `CODE_PRESENT`, `UNIT_TEST_PASS`,
`INTEGRATION_PASS`, `HTTP_E2E_PASS`, `BROWSER_E2E_PASS`, `REAL_PROVIDER_VERIFIED`.

"Renders" below means the route was opened by a fresh STUDENT on the disposable harness, with no API
response ≥ 400, no console error, no uncaught page error, and no leaked `undefined`/`NaN`
(`evidence/learner-crawl.json`). That does **not** mean the workflow works; workflows are tracked in
`learner-completion-tracker.md`.

## Learner modules

| Module | Routes | Backend | Status | Evidence | Known defects / open work |
|---|---|---|---|---|---|
| Public landing, help, terms, privacy | `/`, `/help`, `/terms`, `/privacy` | — | EXISTING_PARTIAL → fixed copy | renders | **Fixed F-001:** fabricated metrics, testimonials, ETS/CEFR claims (see tracker) |
| Auth: register, email login, Google, logout, refresh, forgot/reset password, change password | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/change-password`, `/auth/*` | `auth` | EXISTING_UNVERIFIED | register + email login used by harness scripts | Google OAuth needs real Google; password reset email delivery unverified |
| Dashboard / student home / hub (profile, plan) | `/dashboard`, `/student-home`, `/hub` | `user`, `gamification` | EXISTING_UNVERIFIED | renders | — |
| Entry Diagnostic | `/diagnostic` | `diagnostic` | EXISTING_PARTIAL | C1/C2/C3 reports | Listening audio, real grading, DEF-004, browser E2E, activation (see Entry Diagnostic section of tracker) |
| Courses & lessons | `/courses`, `/courses/[id]`, `/my-courses/...` | `course` | EXISTING_UNVERIFIED | renders | `/my-courses` and `/classes` redirect to `/courses` |
| Listening practice | `/listening`, `/listening/[id]`, submissions | `quiz`, `content` | EXISTING_UNVERIFIED | renders | free vs PLUS gating present |
| Reading practice + mistakes | `/reading`, `/reading/[id]`, `/reading/mistakes` | `reading` | EXISTING_UNVERIFIED | renders | `/grammar` redirects to `/reading?category=grammar` |
| Speaking practice | `/speaking`, `/speaking/[id]` | `speaking` (+ worker) | EXISTING_UNVERIFIED | renders | real scoring needs Azure (blocked in harness) |
| Writing practice | `/writing`, `/writing/[id]`, submissions | `writing` | EXISTING_UNVERIFIED | renders | real grading needs Gemini (blocked in harness) |
| Vocabulary / flashcard | `/flashcard`, `/flashcard/[id]`, `/vocabulary/saved`, `/vocabulary/study` | `vocab` | EXISTING_UNVERIFIED | renders | review scheduling is fixed growing intervals, not an SRS algorithm |
| Grammar | `/grammar` → reading category | `grammar` | EXISTING_UNVERIFIED | renders | — |
| TOEIC exams (L&R, S&W, 4-skill assessments), history, results, review | `/exams`, `/toeic/...` | `toeic` | EXISTING_UNVERIFIED | renders | other certifications are Coming Soon (keep) |
| Gamification: Bánh Mì, pet, shop, leaderboard/league, arena, notifications | `/pet`, `/market`, `/arena`, `/notifications` | `gamification`, `market`, `events`, `notifications` | EXISTING_UNVERIFIED | renders | — |
| Plans / payment | `/plans` | `subscription`, `payment` | EXISTING_UNVERIFIED | renders | PayOS is external |
| Messages / support | `/messages` | `support` | EXISTING_UNVERIFIED | renders | — |

## Admin CMS (P2 — inventoried, not yet audited)

`/admin` overview, users, courses + curriculum + lesson studio, enroll, payments, plan purchases,
quizzes, exams (+ AI import jobs, learner preview), listening, reading, speaking, writing, TOEIC
assessments and writing sets, grammar, vocab, market, currency, assignments, practice, costs,
AI tools, suggestions, issue reports, messages.

Noted for P2: `/admin/ai-tools` has an "Import Đề ETS" flow (PDF + audio extraction of ETS papers),
which conflicts with the product contract that BreadTrans uses original material.
`SCOPE_DECISION_REQUIRED`.

## Cross-cutting

| Item | Status |
|---|---|
| Test isolation (C3-INC-001) | **Fixed in P0**; see `test-evidence-summary.md` |
| ~130 operational `scripts/` connect to `.env` targets by design | documented; not test infrastructure |
| QA scripts that created users directly in `kltn_db` (older phases) | superseded by the disposable harness `scripts/qa/finalization-harness.sh` |
