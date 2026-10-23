# Backup and media architecture

Companion to `docs/database-safety.md` (which covers Prisma shadow isolation and
the 2026-10-23 incident). This document covers **what is backed up where**, the
canonical naming/layout, and the restore runbook.

## A PostgreSQL dump does NOT contain media bytes

This is the single most important fact in this document.

```
PostgreSQL .dump   ->  schema + rows (including the media *URLs*)
Cloudflare R2      ->  the actual image/audio bytes
```

A complete BreadTrans disaster recovery therefore needs **three** things:

1. a PostgreSQL logical backup (`.dump` + `globals.sql` + `meta.json`),
2. the R2 media objects,
3. source code plus secrets/config (`.env`, never committed).

Restoring only the database gives you rows whose media URLs point at objects
that must still exist in R2.

## Two distinct R2 roles — never mix them

| Role | Bucket | Public? | Contents |
| --- | --- | --- | --- |
| Application media | `R2_BUCKET_NAME` (`breadtrans-files`) | Yes, via `R2_PUBLIC_URL` | course covers, lesson media, listening/speaking audio, TOEIC media, vocab pronunciation |
| Premium media | `R2_PRIVATE_BUCKET_NAME` (`breadtrans-premium-media`) | No | gated premium listening/speaking assets |
| **Database backups** | `R2_BACKUP_BUCKET_NAME` (`breadtrans-backup`) | **No — never** | PostgreSQL dumps, globals, metadata |

Database dumps must never be written to a media bucket, never served through
`r2.dev`, never exposed by a public custom domain, and never produced by
`getPublicAssetUrl()`. Only authenticated S3 operations touch the backup bucket.
`scripts/db-backup-offsite.ts` refuses to run if the backup bucket equals the
public media bucket, and it actively probes the public base URL to prove the
uploaded dump is unreachable.

> Note: `R2_PRIVATE_*` had been overloaded to point at the backup bucket, which
> silently redirected premium media lookups. The backup bucket now has its own
> `R2_BACKUP_*` variables and the premium bucket was restored.

### `R2_BACKUP_ENDPOINT` must be the account root — never include the bucket

The S3 client appends `Bucket` to the endpoint, so an endpoint carrying a path
(`https://<account>.r2.cloudflarestorage.com/breadtrans-backup`) resolves every
request to `/breadtrans-backup/breadtrans-backup/<key>`. R2 then reads the
bucket correctly but treats `breadtrans-backup/<key>` as the key, which:

- stores every object under a doubled `breadtrans-backup/` prefix, so the stored
  key no longer matches the `r2RemoteKey` recorded in the catalog;
- degrades `CreateBucket` into a `PutObject`, leaving a 186-byte object named
  `breadtrans-backup/` whose body is the `CreateBucketConfiguration` XML;
- makes `ListObjectsV2` return a phantom empty result, so the bucket looks empty
  through the SDK and shows one unnamed `application/xml` row in the dashboard.

Writes and reads through the same misconfigured client stay self-consistent, so
an upload+download+restore verification still passes while the layout is wrong.
`scripts/db-backup-offsite.ts` therefore rejects a non-root endpoint up front.

## Canonical backup naming

```
breadtrans_db_<class>_<checkpoint>_<YYYYMMDD-HHmmss>.dump
breadtrans_db_globals_<checkpoint>_<YYYYMMDD-HHmmss>.sql
breadtrans_db_<class>_<checkpoint>_<YYYYMMDD-HHmmss>.meta.json
```

Classes (do not invent a new class per agent or task — use `class` + a
descriptive `checkpoint` label instead):

| Class | Meaning | Retention |
| --- | --- | --- |
| `auto` / `AUTOMATIC` | scheduled worker backup | rotating, ~14 days |
| `protected` + `PROTECTED_BASELINE` | a verified good baseline | never auto-deleted |
| `protected` + `PROTECTED_PRE_RECOVERY` | taken immediately before a risky recovery step | never auto-deleted |
| `protected` + `PROTECTED_HANDOFF` | taken when work passes between agents/sessions | never auto-deleted |

Examples:

```
breadtrans_db_auto_20261023-180000.dump
breadtrans_db_protected_learner-baseline_20261023-180000.dump
breadtrans_db_protected_media-access-baseline_20261023-180000.dump
breadtrans_db_protected_handoff-codex-claude_20261023-114217.dump
```

Historical pre-convention filenames (`kltn_db_*`) are **not** renamed or
deleted; the new convention applies going forward.

## Local layout

```
D:\Study\KLTN\.local-backups\breadtrans\
├── automatic\YYYY-MM\
├── protected\
│   ├── baseline\
│   ├── pre-recovery\
│   └── handoff\
├── globals\
├── metadata\
└── catalog\backup-catalog.json
```

The older flat directory `.local-backups\breadtrans-auto\` still holds earlier
recovery checkpoints and the running backup worker's output; it is left intact
for compatibility.

## Private R2 layout

```
database-backups/
├── automatic/YYYY/MM/DD/
├── protected/baseline/<checkpoint>/
├── protected/pre-recovery/<checkpoint>/
├── protected/handoff/<checkpoint>/
├── globals/
├── metadata/
└── catalog/
```

## Backup catalog

`catalog/backup-catalog.json` makes each backup's purpose readable without
parsing filenames. Per entry: `id`, `class`, `checkpoint`, `createdAt`,
`database`, `fullLogicalBackup`, `mediaBytesIncluded` (always `false`),
`dumpFile`, `globalsFile`, `metadataFile`, `localPath`, `bytes`, `sha256`,
`postgresVersion`, `migrationCount`, `gitCommit`, `archiveVerified`,
`protected`, `restoreDrill`, `r2Bucket`, `r2RemoteKey`, `r2RemoteSha256`,
`r2UploadVerified`, `r2PublicProbeStatus`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run db:backup` | verified local backup (`-Label X` for a protected checkpoint) |
| `npm run db:restore:verify` | restore the newest local dump into a throwaway container |
| `npx ts-node scripts/db-backup-offsite.ts --file <dump> --checkpoint <label> --class <CLASS>` | full off-site pipeline incl. remote restore drill |
| `npm run db:r2:inventory` | read-only media inventory |

## Off-site pipeline (fails closed)

```
local dump non-zero
 -> pg_restore -l PASS            => LOCAL_VALID
 -> SHA256 recorded
 -> upload to private backup bucket
 -> HeadObject exists, size matches
 -> download the remote object back
 -> downloaded SHA256 == local SHA256
 -> public-URL probe proves it is NOT reachable
 -> restore the DOWNLOADED bytes into a throwaway PostgreSQL 15
 -> application assertions (plans, courses, IPA, TOEIC, migrations)
                                   => REMOTE_VALID
```

If any R2 step fails, the local dump is left intact, no success marker is
written, and no retention deletion runs. Protected backups are never pruned.

## Restore runbook

Never restore over the live database first.

1. Pick a backup from `backup-catalog.json` (local path or `r2RemoteKey`).
2. Verify SHA256 against the catalog entry.
3. Restore into an **isolated** PostgreSQL 15 container
   (`scripts/db-restore-drill.ps1`, or the off-site script's drill).
4. Run schema/data assertions on the restored copy.
5. Verify the restored rows' media URLs still resolve in R2 — a database
   restore does not restore media bytes.
6. Only then promote the recovered database.

## Canonical media key structure (for new/reconstructed media)

Existing valid objects are **not** mass-renamed. New or reconstructed media
should follow the prefixes already used by the project:

```
catalog/courses/course-<id>/cover/<version>-<hash>.<ext>
catalog/courses/course-<id>/lessons/lesson-<id>/media/<version>-<hash>.<ext>
catalog/courses/course-<id>/lessons/lesson-<id>/listening/<version>-<hash>.mp3
catalog/toeic/shared/images/<name>.png        TOEIC Part 1 / Writing picture assets
catalog/listening/practice/images/<name>      listening practice imagery
catalog/speaking/...                          speaking stimuli and reference media
toeic/exams/<examSetId>/groups/<groupId>[-phase0].mp3    TOEIC L&R listening audio
ai/toeic-exams/exam-<examSetId>/groups/<groupId>/...     AI-generated exam media
vocab/pronunciation/...                       vocabulary pronunciation audio
premium/listening/, premium/speaking/         gated premium media (private bucket)
database-backups/...                          PostgreSQL backups (backup bucket)
```

Keys embed the owning entity id, which is what makes post-incident forensic
remapping possible. Keep that property for any new prefix.
