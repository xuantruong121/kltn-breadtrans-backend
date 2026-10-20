# Phase 8.12 learner load harness

This harness is intentionally outside the normal test/CI scripts. Run it only
against an isolated backend and synthetic QA data. The `login` mode measures the
real login path; `preauth` uses isolated-only JWTs to measure authenticated hot
paths without turning one load-generator IP into the production rate-limit
bottleneck.

Required environment values are supplied by the isolated launcher:

- `LOAD_BASE_URL`
- `EXAM_ID`
- `LOAD_PASSWORD` for `login` mode
- `LOAD_JWT_SECRET` for `preauth` mode
- `VUS`, `ITERATIONS`, or `RAMP_SECONDS`/`STEADY_SECONDS`

The script tags every request with a stable logical endpoint name and emits:

- one `latency_<endpoint>` Trend per endpoint (use `--summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)"`);
- one `requests_<endpoint>` Counter per endpoint;
- `endpoint_status_total` with `endpoint` and `status` tags, including `network_error`;
- `endpoint_network_errors` for explicit connection-level failures.

For Node runtime evidence, start the isolated BE with
`PHASE812_RUNTIME_METRICS=true`. It emits short-interval JSON samples containing
PID, CPU, RSS, heap and event-loop p50/p95/max. The flag is opt-in and is not
enabled for the normal owner runtime.

Do not point this script at production, the owner database, or the owner BE
listener on port 3001.
