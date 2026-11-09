# Capacity: 1000 learners on a 2 vCPU / 4 GB VPS

Owner request 2026-11-09: raise the load the site holds from about 500 to 1000
learners. The target VPS is "Cheap 4": 2 vCPU, 4 GB RAM, 30 GB NVMe, 200 Mbps.
The frontend runs on Vercel, so the VPS runs only the backend.

This measures the production image on this machine: the API, Postgres, Redis
and Caddy pinned to the same 2 CPUs with the VPS's memory, k6 on the other CPUs.
It is not a measurement of a real VPS (`PRODUCTION_VPS=NOT_VERIFIED`).

## What "1000 learners" means here

1000 virtual learners online at once. Moving around takes 3-8 s, answering a
question 15-40 s (hearing the clip or reading the passage), a vocabulary card
4-10 s:

| Share | Session |
|---|---|
| 40% | Skill practice: reading, or listening with its audio clips |
| 25% | A TOEIC exam: start, Listening master audio (first MB), 10 answers, submit, result |
| 20% | Dashboard, pet, ranking |
| 15% | Vocabulary review |

Pass: fewer than 1% errors and p95 under 1 s, ramping 250 / 500 / 750 / 1000
(3 min each) then holding 1000 for 10 min. A separate spike: all 1000 submit
within 30 s.

Out of scope: Writing grading (Gemini) and real Speaking grading (Azure). They
are bound by the providers' quotas, not by the VPS.

## Run

The harness containers must be up (`scripts/qa/finalization-harness.sh containers`,
`clone <db>`, `fakes`). Then:

```bash
docker build --target production -t breadtrans-api:capacity .
DATABASE_URL=postgresql://harness:harness-disposable@127.0.0.1:5460/<db> FAKE_S3=http://127.0.0.1:9460 \
  MASTER_FILE=<backend>/artifacts/toeic-listening-master/exam-1/master.mp3 \
  npx ts-node --transpile-only load-tests/capacity/seed-capacity.ts
load-tests/capacity/run-capacity.sh up <db> S       # profile S, Prisma pool 20 (as production)
load-tests/capacity/run-capacity.sh run S-run       # about 25 min
node load-tests/capacity/summarize.mjs load-tests/capacity/out/S-run
load-tests/capacity/run-capacity.sh run S-spike spike
load-tests/capacity/run-capacity.sh down
```

The TOEIC Listening master is read from the fake private bucket, as production
reads it from R2 (the API signs a URL); `CAP_LOCAL_MASTER=1` on `up` mounts the
local build instead. Compare builds on fresh clones: every run adds submissions,
and a virtual learner's first submissions earn more rewards than later ones.

`up` refuses any database that is not a harness copy. Nothing here calls a
provider, Cloudflare R2, the owner's database or the owner's servers.

## Files

- `seed-capacity.ts`: 1000 learners, stand-in mp3 clips in the fake bucket at
  the real sizes (65 KB clips, 1.2 MB dialogue tracks), `out/capacity-data.json`.
- `learner-realistic.js`: the k6 scenario (`MODE=ramp` or `spike`).
- `compose.capacity.yml`, `Caddyfile.capacity`, `Caddyfile.capacity-two`: the
  production API and Caddy with CPU/RAM limits; the second file splits REST
  across two APIs and keeps `/socket.io` on one.
- `run-capacity.sh`: up / run / down; samples container CPU, memory and network
  and Postgres connections every 5 s.
- `summarize.mjs`: the markdown summary used in the report.
- `bench-endpoints.mjs`: CPU per request of each endpoint, from the API's cgroup.
- `profile-api.mjs`: a CPU profile through the inspector
  (`CAP_NODE_OPTIONS="--max-semi-space-size=32 --inspect=0.0.0.0:9229"`).

To measure an older build: `CAP_IMAGE=<image> CAP_NODE_OPTIONS=" "` on `up`,
`AUDIO_MODE=stream` on `run` (audio through the API, as the frontend did).

The results and the changes they led to are in
`artifacts/capacity-1000-report.md`.
