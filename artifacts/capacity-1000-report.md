# Capacity: 1000 learners on a 2 vCPU / 4 GB VPS — report (2026-11-09)

Owner request: "hình như kiểm tra tải của web tao chỉ được 500 users ... muốn nâng
lên cho 1000 users". Target VPS: "Cheap 4" (2 vCPU, 4 GB RAM, 30 GB NVMe,
200 Mbps). Frontend on Vercel; the VPS runs only the backend.

```
TARGET=1000 learners online, p95 < 1 s, errors < 1%
RESULT_SUSTAINED_1000=PASS        p95 522 ms, p99 984 ms, errors 0.06% (S-final)
RESULT_BEFORE_SAME_METHOD=FAIL    holds ~560; at 1000 p95 14.3 s (S-develop-baseline)
RESULT_SPIKE_1000_SUBMIT_IN_30S=FAIL  submit p95 12.3 s, errors 4.45% (S-spike)
BANDWIDTH_PEAK=30 Mbps of 200     (before: up to 239 Mbps)
DISK=OK                           DB 20 -> 73 MB after all runs; 30 GB is ample
PRODUCTION_VPS=NOT_VERIFIED       measured on this machine, not on a VPS
PRIOR_500_FIGURE=NOT_FOUND        no earlier result exists in the repo
```

## 1. What was measured

**Environment.** The production image (`Dockerfile`, target `production`) with
the API, Postgres, Redis and Caddy pinned to the same 2 CPUs of this machine
(`docker --cpuset-cpus 0,1`), with the VPS's memory split (API 1.4 GB, Postgres
1.4 GB, Redis 0.4 GB); k6 on CPUs 2-7. Postgres and Redis are the disposable
harness containers on a copy of the data (`clone capacity`). AI providers,
payments and R2 are off; object storage is the harness fake bucket.

**Learners** (`load-tests/capacity/learner-realistic.js`). 1000 virtual
learners, each in study sessions: a dashboard, then one activity. Moving
around takes 3-8 s; a question 15-40 s (hearing the clip or reading the
passage, then answering); a vocabulary card 4-10 s. The owner chose this pace
over the first one (one action every 3-8 s, see §5).

| Share | Session |
|---|---|
| 40% | Skill practice: reading, or listening with its audio |
| 25% | A TOEIC exam: start, the Listening master (first MB), 10 answers, submit, result |
| 20% | Dashboard, pet, ranking |
| 15% | Vocabulary review |

Ramp 250 / 500 / 750 / 1000 (3 min each), hold 1000 for 10 min. Out of scope:
Writing grading (Gemini) and real Speaking grading (Azure), which are bound by
the providers' quotas, not by the VPS.

## 2. Results

Same method, same pace, same data; only the build differs.

| | Before (`develop` ff34192) | After |
|---|---|---|
| Holds with p95 < 1 s | ~560 learners | 1000 learners |
| p95 / p99, whole run | 14.3 s / 19.1 s | 0.52 s / 0.98 s |
| Errors | 0.44% | 0.06% |
| Requests served | 60,717 | 86,559 |
| Pool timeouts in the API log | 253 | 0 |
| Peak bytes the VPS sends | 239 Mbps | 30 Mbps |
| API memory (RSS) | 301 MB | 295 MB |

Per 30-s window while 1000 learners hold, after: p95 0.3-0.6 s; one window at
1.0-1.7 s. Full tables: `capacity-1000/S-develop-baseline.md`,
`capacity-1000/S-final.md` (and the k6 output next to them).

The 60 errors left in the final run: 58 are the harness fake bucket (it stands
in for R2, not for the VPS), 2 are vocabulary reviews.

**Spike** (`capacity-1000/S-spike.md`): every learner prepares a submission,
then all 1000 submit within 30 s (a third each reading, listening, TOEIC).
Reading/listening submit p95 12.3 s, TOEIC submit p95 4.1 s, 2 submissions
failed; most errors were in the preparation, when 333 TOEIC exams start in the
same second. A submission costs 75-100 ms of CPU (rewards, quests, badges,
skill level), so 33 per second need about 3 cores. Not met on Cheap 4.

## 3. What changed, and why (in the order found)

Each step was found by measuring: the API's CPU profile (`profile-api.mjs`),
CPU per request of each endpoint read from the container's cgroup
(`bench-endpoints.mjs`, `capacity-1000/bench-endpoints.md`), per-thread CPU,
and the SQL each request runs (Postgres statement log).

1. **JWT verification** (18% of API CPU). Given a string secret, jsonwebtoken 9
   tries `createPublicKey()` on every token. The secret is now a `KeyObject`
   built once (`auth.constants.ts: getJwtVerificationKey`).
2. **`pdf-parse` replaced `JSON.parse`.** Its bundled core-js polyfills "JSON.parse
   with source" on Node 20, so every JSON parse in the process ran in JS. The
   production image moves to `node:22-alpine` (has it natively; the AWS SDK also
   asks for Node 22) and `pdf-parse` is imported only when a PDF is read.
3. **Listening audio straight from storage.** The API downloaded every clip from
   R2 into memory and sent it on; a dialogue question re-sent the whole 1.2 MB
   track. New `GET /quizzes/:quizId/questions/:questionId/audio-url` returns a
   public URL, or a signed URL (1 h) for private media, after the same checks;
   the frontend players set it as the `<audio>` source. The browser caches a
   dialogue's single track once. The old streaming route is kept.
4. **Learner exam list cached 60 s** (83 ms of CPU per call: it validated every
   question of every exam). Staff always read it fresh.
5. **Date key formatter reused** (`getTodayDateKey` built an `Intl.DateTimeFormat`
   on every call, several times per submission).
6. **Published listening track state cached 60 s** (re-hashing the quiz script
   on every question played). Publishing or relinking clears it at once.
7. **Account lookup on every request cached 60 s** (`auth-user-cache.ts`). A
   password change, an admin role change or deleting a user clears it at once
   (`forgetAuthUser`); another API process or a direct database edit applies
   within 60 s. Revoked tokens and ended device sessions are still checked in
   Redis on every request.
8. **Static quiz data cached 60 s** (`TtlMemo`): access-policy fields, listening
   quiz type/tier, reward eligibility, the quiz facts the skill level reads, and
   the quiz with its questions for learners (admins always read fresh). An edit
   reaches learners — and grading — within 60 s.
9. **Prisma pool 20** (`docker-compose.production.yml`). Prisma's default on
   2 CPUs is 5 connections; interactive transactions (TOEIC answer saves,
   submissions, exam start) ran out at ~1000 learners and failed with P2028
   ("Unable to start a transaction in the given time") in waves.
10. **`NODE_OPTIONS=--max-semi-space-size=32`** (production compose). Fewer
    young-generation collections for each request's short-lived objects; p95 at
    1000 went from ~1.7 s to ~0.6 s.

Configuration changes for production: `docker-compose.production.yml` (pool,
`NODE_OPTIONS`), `Dockerfile` (Node 22). `.dockerignore` added (the build context
had no exclusions).

## 4. Where the CPU still goes

Half of the API's CPU is Prisma's query engine (Rust threads in the same
process, measured per thread) and much of the rest is building and reading
Prisma requests. Per request the floor is ~6 ms; a submission ~75-100 ms.

Next steps if more headroom is needed (not done):

- **Submission side effects to a queue.** Rewards, quests, badges and skill
  level run in the request's process; moving them to the BullMQ worker that
  already exists would make the 30-s spike a queue rather than a slowdown.
- **Prisma 6.2 to a version with the query compiler** (no Rust engine) — a new
  dependency (`@prisma/adapter-pg`) and an upgrade; needs the owner's approval.
- **TOEIC Listening master.** On a VPS the API proxies it from R2 (here a local
  file was used, which is cheaper). Proxying is deliberate: the storage URL
  never reaches the learner and the grant is checked on every request. A signed
  URL would remove that load but is a product decision.
- **A 4 vCPU VPS** roughly doubles the CPU; not measured here (profile M).

## 5. How the method changed (and what that means for the numbers)

- **The first runs split the CPUs into fixed shares** (API 1.1, Postgres 0.6,
  Redis 0.15, Caddy 0.15). Postgres used ~0.25 of its 0.6 and Redis/Caddy almost
  nothing, while the API was capped; a VPS shares its CPUs. Runs from
  `S-fix3-shared` on pin all containers to the same 2 CPUs instead.
- **The first pace was one action every 3-8 s.** At that pace `develop` held
  ~120 learners under the fixed shares. The owner then chose 15-40 s per
  question. The before/after comparison in §2 uses the final method and pace
  for both builds.
- **TLS is not in the measurement** (Caddy on plain HTTP); production Caddy also
  encrypts, which costs some more CPU there.
- **Object storage** is the harness fake bucket; R2's latency for the browser is
  not measured (it no longer touches the VPS).
- The earlier figure of ~500 learners was not found in the repo
  (`load-tests/phase812` has the scripts but no results); the "before" number
  here (~560 at the final pace) is the measured one.

## 6. Checks

```
BACKEND_JEST_HARNESS=PASS   2690 passed, 1 skipped (TEST_* on harness kltn_test_db)
BACKEND_LINT=PASS           npm run lint:check
BACKEND_TYPECHECK=PASS      npm run typecheck
FRONTEND_TEST_CI=PASS       957 passed
LISTENING_BROWSER=PASS      scripts/qa/finalization-listening-audio-url.ts 11/11
                            (comprehension and dictation play from storage; no
                            audio bytes through the API)
```

Reproduce: `load-tests/capacity/README.md`.
