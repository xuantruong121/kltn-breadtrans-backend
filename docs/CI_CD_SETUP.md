# Backend CI

The backend is CI-only. It has no deployment job or production deployment target.

## Triggers and branch policy

- `develop`: integration branch; CI runs on every push.
- `main`: stable branch; CI runs on every push.
- Pull requests target `main` and run the same CI.
- `workflow_dispatch` is available for an explicit manual run.
- Do not create long-lived `staging`, `release`, or other branches.

## Pipeline

The workflow installs with `npm ci`, generates and validates Prisma, applies migrations only to the ephemeral PostgreSQL service, runs lint without auto-fix, typecheck, build, the full Jest suite, and E2E tests. PostgreSQL 15 and Redis 7 are disposable GitHub Actions services.

The Entry Diagnostic tests use repository-owned fixtures under `test/fixtures/diagnostic/`. CI never runs the database-mutating materializer.

## Secrets

No production secrets are required by this CI. Test-only values are injected by the workflow. Provider integrations are mocked by the test suite.

## Release flow

Push and validate `develop`, verify the frontend Preview in Vercel, then open `develop -> main`. Merge only after required CI checks are green. The backend receives no automatic deployment.

## GitHub ruleset steps (manual)

The local environment has no authenticated GitHub CLI, so these account-side settings are pending. In the repository open Settings -> Rules -> Rulesets -> New branch ruleset, target `main`, disable deletion and force-push, require a pull request, require the `Backend CI / quality` status check, and require the branch to be up to date. Repeat the equivalent protection for `develop` without requiring a pull request. Do not require an unavailable reviewer.

## Troubleshooting

- Missing Diagnostic artifacts: run the fixture validation/update process against an isolated test database; do not recreate them in CI with a mutating script.
- Prisma engine issues: run `npx prisma generate` after dependency installation.
- A Vercel Preview cannot reach a backend running on an owner's localhost. Configure a remotely reachable backend before end-to-end Preview testing.
