# Database safety, backup and restore

This document exists because of a real incident. Read the **Never do this**
section before running any Prisma migration command.

## The incident (2026-10-23)

While generating a migration, the real development connection string was passed
to Prisma as a shadow database:

```
prisma migrate diff ... --shadow-database-url "$DATABASE_URL"   # ← destroyed the dev database
```

Prisma treats a shadow database as **disposable**: it drops it, replays the
migration history to compute a diff, and leaves it schema-only. Because the
flag pointed at `kltn_db`, every row of development data was lost (schema
survived; data did not).

### Never do this

```
NEVER set --shadow-database-url to DATABASE_URL.
NEVER point a shadow/disposable database at kltn_db.
```

The shadow database is a scratch database Prisma is allowed to destroy. It must
always be a *different* database — in this project, a different container, a
different volume and a different port.

## Topology

| Service            | Container              | Database       | Host port | Volume                                          | Purpose                                  |
| ------------------ | ---------------------- | -------------- | --------- | ----------------------------------------------- | ---------------------------------------- |
| `postgres`         | `kltn-postgres`        | `kltn_db`      | 5432      | `kltn-breadtrans-backend_postgres_data`         | **Real development data**                |
| `postgres-shadow`  | `kltn-postgres-shadow` | `kltn_shadow`  | 5433      | `kltn-breadtrans-backend_postgres_shadow_data`  | Disposable Prisma migration shadow       |
| `postgres-backup`  | `kltn-postgres-backup` | –              | –         | host `POSTGRES_BACKUP_DIR`                      | Scheduled `pg_dump -Fc` backups          |

Environment (`.env`, never committed):

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/kltn_db?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:password@localhost:5433/kltn_shadow?schema=public"
POSTGRES_BACKUP_DIR=D:/Study/KLTN/.local-backups/breadtrans-auto
```

`prisma/schema.prisma` reads the shadow database from `SHADOW_DATABASE_URL`
(Prisma 6 `datasource.shadowDatabaseUrl`), so `prisma migrate dev` never needs
a `--shadow-database-url` flag at all.

## Normal startup

```bash
docker compose up -d postgres postgres-shadow postgres-backup postgres-drill redis
```

The backup service waits for `postgres` to report healthy, then dumps once a
day at 00:01 Vietnam time (`BACKUP_AT`, `BACKUP_UTC_OFFSET_MINUTES`; owner
2026-11-16, was every 6 hours; 00:00 until 2026-11-27, when every scheduled
job moved off midnight) and prunes dumps older than 14 days
(`BACKUP_RETENTION_DAYS`). The backend copies new dumps to the R2 backup
bucket at 00:02 every day, at backend start, and at minute 20 of any hour in
which a local dump is not yet uploaded (that check reads only local files).

### Cadence and its one real limitation

The automatic backup worker runs only while Docker and the host are running.
It is not a cloud or always-on scheduler, and it cannot create backups while
the machine is powered off.

Scheduling is driven by the newest **verified** automatic dump found in the
backup directory, not by container uptime, so:

- while the host is up, one verified backup a day at 00:01 Vietnam time;
- after host downtime, if there is no verified automatic backup since the most
  recent 00:01, one runs immediately once Postgres is ready (a machine switched
  on at 08:00 gets that day's backup at about 08:00);
- a container restart on a day that already has its backup adds none; the
  worker sleeps until the next 00:01.

### Restore drill

A backup counts only if it restores. The backup container also runs
`docker/postgres-backup/restore-drill.sh --loop`: every Sunday at 04:00
Vietnam time (or on the next start after a missed Sunday) it restores the
newest automatic dump into the throwaway `postgres-drill` service (tmpfs, no
published port), compares tables, the newest migration and the row counts of
key tables with the live database, writes `restore-drill-<stamp>.json` next to
the dumps (`OK`, `WARN` or `FAIL`) and drops the restored database. It refuses
to run if the drill server's `system_identifier` equals the source's.

- Once a month, by hand, drill the off-site copy too:
  `npm run db:restore:drill:r2` downloads the newest automatic dump from R2,
  checks its sha256 against the backup catalog and runs the same drill.
- To drill now: `docker exec kltn-postgres-backup sh /usr/local/bin/restore-drill.sh --now`.

A cycle that fails (Postgres unreachable, `pg_dump` error, archive that
`pg_restore -l` cannot read) never advances the schedule and never prunes; it
retries after `BACKUP_FAILURE_RETRY_SECONDS` (default 300s) instead of waiting
a full interval. On startup the worker also retries readiness every
`POSTGRES_READY_RETRY_SECONDS` up to `POSTGRES_READY_MAX_ATTEMPTS` times,
because Docker does not re-evaluate `depends_on` when it restarts a container
under its restart policy.

### Which dumps retention can touch

Only this worker's own automatic filenames, `<db>_YYYYMMDD_HHMMSS.dump`, are
ever pruned, and never the newest one. Any dump carrying a label — `PROTECTED`,
`PRE_*`, `POST_*`, handoff or baseline snapshots — does not match that pattern
and is structurally exempt, so it is kept regardless of age.

## Safety guard

Every migration-development npm script runs the guard first:

```bash
npm run db:safety-check
```

It refuses to continue when:

- `SHADOW_DATABASE_URL` is missing;
- `DATABASE_URL` and `SHADOW_DATABASE_URL` are the same value;
- both resolve to the same host + port + database (even with different credentials);
- the shadow URL names the development database `kltn_db`;
- `DATABASE_URL` is not a local development host, or is not database `kltn_db`;
- the shadow URL shares the development port and is not the expected shadow port;
- a command line contains `--shadow-database-url` pointing at the dev database;
- a command line expands `$DATABASE_URL` / `%DATABASE_URL%` into such a flag.

It prints host, port and database name only — never credentials.

## Safe commands

| Command                        | What it does                                                            |
| ------------------------------ | ----------------------------------------------------------------------- |
| `npm run db:safety-check`      | Validate DB/shadow isolation                                            |
| `npm run db:migrate:dev:safe`  | Guard, then `prisma migrate dev` (uses the shadow container)             |
| `npm run db:migrate:diff:safe` | Guard, then `migrate diff` against `SHADOW_DATABASE_URL`                 |
| `npm run db:migrate:reset:safe`| Guard, then `prisma migrate reset` (**destructive**, dev database only)  |
| `npm run db:migrate:deploy`    | Apply migration history without a shadow database                       |
| `npm run db:seed`              | Run the canonical seed                                                   |
| `npm run db:backup`            | One verified manual backup                                               |
| `npm run db:restore:verify`    | Restore the newest backup into a throwaway container and query it        |

## Manual backup

```bash
npm run db:backup
# or, with a protected label that retention will never delete:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-backup.ps1 -Label PRE_RESEED_PROTECTED
```

The script dumps inside the container, verifies with `pg_restore -l`, copies the
archive out with `docker cp` (binary-safe — PowerShell never pipes the archive),
records SHA256 plus metadata, and fails without deleting anything on error.

## Verify a backup (restore drill)

```bash
npm run db:restore:verify
```

This starts a disposable `postgres:15-alpine` container **with no published
port**, restores the archive, asserts the schema, `_prisma_migrations` and every
core table exist, prints row counts, then destroys the container and volume.
A missing table fails the drill loudly rather than reporting zero rows.

Compare a restored copy against the live database:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-restore-drill.ps1 -ExpectCounts "User=2;ToeicExamSet=2"
```

## After a real restore: grading queues

A restored database and the Redis queues no longer describe the same moment.
**Do not flush Redis to fix this.** It also holds sessions and rate limits, and
the application recovers on its own:

| Row after the restore | What happens | When |
|---|---|---|
| Diagnostic Writing `QUEUED`, no live job | New run, graded again | Start, then every 5 min, for rows over 5 min old |
| Diagnostic Speaking `QUEUED`, no live job | Queued again for the same recording | Same |
| Diagnostic Writing or Speaking `GRADING`, no live job | `GRADING_FAILED` with `GRADING_LOST`, the learner can retry | Same |
| Speaking Practice `PENDING` or expired `PROCESSING` | Queued again by the reconciliation scheduler (BullMQ mode) | Every 30 s |
| A job left from before the restore | Cannot claim a row: the run number or `audioKey` no longer matches | When it runs |

After the restore, restart the API and the speaking worker, wait five minutes,
then check that nothing old is stuck:

```sql
select status, count(*) from "DiagnosticWritingResponse"
where status in ('QUEUED', 'GRADING') group by 1;
select status, count(*) from "DiagnosticSpeakingResponse"
where status in ('QUEUED', 'GRADING') group by 1;
```

Rehearsed 2026-11-01 on the harness: rows set to `QUEUED` and `GRADING` with no
job, four stale jobs left in Redis. No row stayed unfinished, and the stale jobs
changed nothing.

## Rehearse a reseed before doing it for real

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-seed-rehearsal.ps1
```

Applies the whole migration history and the canonical seed to a disposable
database on port 5434, then reports fixture counts. If this fails, **do not
reseed the development database.**

## What the canonical seed does and does not restore

`prisma/seed.ts` creates the learning content fixtures: users (admin +
student), courses, lessons, quizzes, vocabulary, grammar, market products,
Speaking/Writing fixtures and the TOEIC content sets `ToeicExamSet id=1`
(full 200-question mock) and `id=2` (practice-by-part).

It does **not** create the generic product layer. `Exam`, `ToeicAssessment`
and `ToeicAssessmentComponent` rows are only ever created by the admin runtime
services (`generic-exam.service.ts`, `toeic-assessment.service.ts`). After a
reseed you must therefore recreate, through the admin UI/API:

- the `Exam` wrapper rows (e.g. the published L&R exam, S&W, 4-skills);
- the `ToeicAssessment` rows and their components;
- any AI-generated exam drafts.

The seed also leaves `ToeicExamSet.publicationStatus` at its `DRAFT` default,
so the TOEIC sets must be published through the admin flow to become
learner-visible.

## Backup failure behaviour

- A failed `pg_dump`, an unreadable archive or a zero-byte file is discarded.
- Previous good backups are never deleted or overwritten by a failure.
- Retention pruning only runs after a new backup verified successfully.
- Pruning only matches `kltn_db_*.dump`, never the newest backup, and never a
  filename containing `PROTECTED`.
