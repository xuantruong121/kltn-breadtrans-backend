# Test evidence summary (finalization)

Only observed results are recorded. Every run below targets disposable services unless stated.

## P0 — test and database isolation (C3-INC-001) — PASS

**Defect.** Four integration specs created `new PrismaService()` with no URL, so Prisma read
`.env` and wrote (insert, then delete) to `kltn_db`. Two specs, and the E2E app, used Redis 6379.
The E2E setup also accepted `kltn_test_db`, which lives on the protected 5432 cluster.

**Fix** (backend `test/safety/`):

| Piece | Behaviour |
|---|---|
| `test-target-guard.ts` | Pure checks. Protected names `kltn_db`/`kltn_shadow`; protected cluster IDs `7674533776495505443`, `7699757546958700579`; local ports 5432/5433; Redis port 6379; Redis run_id alias check. |
| `target-identity.ts` | Read-only identity reads: `current_database()` and `pg_control_system()` under `default_transaction_read_only=on`, plus Redis `INFO server`. Adds the identities currently behind `.env` (parsed, never loaded). |
| `jest-global-setup.ts` | `TEST_DATABASE_URL`/`TEST_REDIS_URL` are optional. If set, they must pass identity verification, or the whole run aborts. |
| `jest-setup-isolation.ts` | In every worker, **always** overwrites `DATABASE_URL`, `SHADOW_DATABASE_URL`, `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`: a verified TEST_* target, or else a refusing sentinel at `127.0.0.1:9`. Prisma never falls back to `.env`. |
| `isolated.ts` | `describeWithIsolatedDatabase/Redis/...`: the 5 real-connection specs skip unless verified targets exist. |
| `e2e-global-setup.ts` | Replaces `test/setup-env.js`. E2E **requires** both targets, verified by identity. |

**Negative tests** (`test/safety/test-target-guard.spec.ts`, 30/30): missing URL; `kltn_db` (any host,
any case, percent-encoded); `kltn_shadow`; any DB on local 5432/5433 incl. `host.docker.internal`; a
harmless URL whose connection reaches a protected cluster ID; unreadable identity; Redis missing, 6379,
default port, run_id alias, unreachable; shell `DATABASE_URL=kltn_db` overridden to the sentinel;
unverified or forged verification ignored; `new PrismaClient()` with no URL reaches only the sentinel.

**Live alias refusal** (`evidence/p0-alias-refusal-check.log`): `postgresql://***@172.17.112.1:5432/kltn_test_db`
passes the static check, then is **refused by cluster identity** (`7674533776495505443`). Only read-only
SELECTs were issued.

**Bare full suite** (`npx jest --ci`, no TEST_* set): 146 suites passed, 5 skipped (the gated specs);
1 503 tests passed, 29 skipped. kltn_db `pg_stat_user_tables` insert/update/delete counters were
**identical** before and after (`evidence/p0-kltn-db-stats-*.txt`). Shared Redis
`total_connections_received` rose by 1, which matches the running app's idle rate (+1 per ~90 s,
measured). Every Redis client in `src` reads `REDIS_URL`, which is the sentinel under Jest.

**Positive path:** with verified disposable PG (cluster `7700839956956897314`) and Redis 6391, the
gated specs ran: 31 suites / 254 tests passed (`evidence/p0-isolated-integration.log`).
`TEST_DATABASE_URL=…/kltn_db` aborted the run in global setup.

**E2E:** `npm run test:e2e` now refuses `.env.test`'s `kltn_test_db@localhost:5432`. It needs a
disposable cluster: `BLOCKED_PENDING_DISPOSABLE_TARGET` until one is configured.

## Disposable full-stack harness

`scripts/qa/finalization-harness.sh up|backend|down`:
- PG 15 clone on 127.0.0.1:5460, from the protected pre-import checkpoint, with `migrate deploy` and the
  approved V2 import;
- Redis on 6392;
- backend built to a scratch directory, on :3101, with every provider and storage-write secret blanked
  and `DIAGNOSTIC_GRADER_MODE=mock`;
- a second Next dev server on :3100 (`NEXT_DIST_DIR=.next-harness`).

The owner's :3000/:3001 servers are not touched. The R2 backup job logs "skipped: credentials not
configured", as intended.

## Learner crawl — renders

`scripts/qa/finalization-learner-crawl.ts`: a fresh STUDENT opened 31 static routes and 2 detail pages
with 0 API errors, 0 console errors, 0 page errors and 0 leaked values. Catalog cards navigate with
buttons, so per-module workflow tests are separate (tracker).

## Frontend checks

`tsc --noEmit` 0 errors. `npm run test:ci` 628/628 (before and after the copy fixes).

## Checkpoint 2 (2026-10-26)

| Suite (harness unless stated) | Result |
|---|---|
| `finalization-practice-api.ts` (Listening + Reading) | PASS |
| `finalization-practice-browser.ts` (Listening, Reading, Grammar, Flashcard) | PASS |
| `finalization-grammar-vocab-api.ts` | 24/24 |
| `finalization-course-api.ts` / `finalization-course-browser.ts` | 18/18 / 6/6 |
| `finalization-toeic-api.ts` / `finalization-toeic-browser.ts` | 20/20 / 8/8 |
| `finalization-writing-browser.ts` (grader unavailable path) | 5/5 |
| `finalization-diagnostic-browser.ts` (active id 1) | 7/7 |
| `finalization-shop-api.ts` | 15/15 |
| `finalization-plans-api.ts` | catalog and gating pass; purchase `BLOCKED_EXTERNAL` (PayOS) |
| `finalization-auth-api.ts` / `finalization-auth-browser.ts` | all except reset-link-from-log (`NOT_VERIFIED`; covered by `auth.password-reset.spec.ts` 5/5) / 6/6 |
| Backend `npx jest --ci` (bare, safe after P0) | 149 suites passed, 5 skipped; 1 527 tests passed, 29 skipped |
| Backend tsc / lint:check / diff --check | 0 / 0 / clean |
| Frontend tsc / lint / test:ci / diff --check | 0 / 0 errors (44 pre-existing warnings) / 630/630 / clean |

**Protected services.** kltn_db `pg_stat_user_tables` counters were identical before and after the bare
suite. Since checkpoint 1 they changed by exactly one `ListeningPracticeAttempt` insert (+2 updates) and
one `UserPet` update. Attempt 71 belongs to user 31 (gmail.com) and started at 06:38:38 UTC, which matches
the owner's own server log at 13:38:38 local, so these writes came from the owner using the app on
:3000/:3001. Zero `@harness.local` accounts exist in `kltn_db`. All finalization scripts target FE :3100 /
BE :3101 and the clone `harness-pg` (identity-checked).
