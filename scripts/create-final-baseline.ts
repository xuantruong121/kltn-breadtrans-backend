/**
 * Final protected baseline for the recovered live database (spec §39-§52).
 *
 * Source is always the LIVE database (kltn-postgres / kltn_db). The rehearsal
 * database proves reconstructability; it is never the backup source.
 *
 * Chain, fail-closed at every step:
 *   pg_dump -Fc + pg_dumpall --globals-only   (live)
 *   sha256 + metadata + sha256 companion file
 *   pg_restore -l                             -> local archive valid
 *   restore into an isolated PostgreSQL 15    -> local restore assertions
 *   upload all four artifacts to private R2
 *   HeadObject each, dump size must match
 *   download the dump to a NEW path, sha256 must match the local original
 *   restore the DOWNLOADED bytes into a second isolated PostgreSQL 15
 *   update the backup catalog
 *
 * Canonical naming, no agent names:
 *   breadtrans_<YYYYMMDD-HHmmss>.dump
 *   globals_<YYYYMMDD-HHmmss>.sql
 *   metadata_<YYYYMMDD-HHmmss>.json
 *   sha256_<YYYYMMDD-HHmmss>.txt
 *
 * Usage: npx ts-node scripts/create-final-baseline.ts
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const LIVE_CONTAINER = 'kltn-postgres';
const LIVE_DB = 'kltn_db';
const LIVE_USER = 'postgres';

const BASELINE_ROOT = 'D:\\Study\\KLTN\\.local-backups\\breadtrans';
const CATALOG = join(BASELINE_ROOT, 'catalog', 'backup-catalog.json');

const stamp = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();

const monthDir = stamp.slice(0, 4) + '-' + stamp.slice(4, 6);
const localDir = join(BASELINE_ROOT, 'protected', 'baseline', monthDir);

const DUMP = `breadtrans_${stamp}.dump`;
const GLOBALS = `globals_${stamp}.sql`;
const META = `metadata_${stamp}.json`;
const SHAFILE = `sha256_${stamp}.txt`;

const docker = (args: string[], opts: { binary?: boolean } = {}) =>
  execFileSync('docker', args, {
    maxBuffer: 1024 * 1024 * 512,
    encoding: opts.binary ? 'buffer' : 'utf8',
  }) as never;

function sh(label: string, args: string[]) {
  try {
    return String(docker(args)).trim();
  } catch (error) {
    throw new Error(
      `${label} failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** Application assertions run against a restored copy (§45). */
const ASSERTION_SQL = `
\\pset border 0
SELECT 'migrations'            AS check, count(*)::text AS value FROM "_prisma_migrations"
UNION ALL SELECT 'plans',               count(*)::text FROM "Plan"
UNION ALL SELECT 'plan_versions_current', count(*)::text FROM "PlanVersion" WHERE "isCurrent" = true AND status = 'PUBLISHED'
UNION ALL SELECT 'premium_quizzes',     count(*)::text FROM "Quiz" WHERE "isPremiumContent" = true
UNION ALL SELECT 'premium_speaking',    count(*)::text FROM "SpeakingExercise" WHERE "isPremiumContent" = true
UNION ALL SELECT 'courses_published',   count(*)::text FROM "Course" WHERE status = 'PUBLISHED'
UNION ALL SELECT 'course_lessons',      count(*)::text FROM "CourseLesson"
UNION ALL SELECT 'course_sections',     count(*)::text FROM "CourseLessonSection"
UNION ALL SELECT 'course_exercises',    count(*)::text FROM "CourseLessonExercise"
UNION ALL SELECT 'vocab_topics',        count(*)::text FROM "VocabTopic"
UNION ALL SELECT 'vocab_words',         count(*)::text FROM "VocabWord"
UNION ALL SELECT 'quizzes',             count(*)::text FROM "Quiz"
UNION ALL SELECT 'dictation_questions', count(*)::text FROM "Question" WHERE type = 'DICTATION'
UNION ALL SELECT 'quiz_audio_assets',   count(*)::text FROM "QuizAudioAsset" WHERE "isActive" = true
UNION ALL SELECT 'speaking_exercises',  count(*)::text FROM "SpeakingExercise"
UNION ALL SELECT 'grammar_topics',      count(*)::text FROM "GrammarTopic"
UNION ALL SELECT 'grammar_questions',   count(*)::text FROM "GrammarQuestion"
UNION ALL SELECT 'toeic_questions',     count(*)::text FROM "ToeicQuestion"
UNION ALL SELECT 'toeic_groups_audio',  count(*)::text FROM "ToeicQuestionGroup" WHERE part <= 4 AND "audioUrl" IS NOT NULL
UNION ALL SELECT 'toeic_assessments',   count(*)::text FROM "ToeicAssessment"
UNION ALL SELECT 'toeic_components',    count(*)::text FROM "ToeicAssessmentComponent"
UNION ALL SELECT 'toeic_writing_items', count(*)::text FROM "ToeicWritingSetItem"
ORDER BY 1;
`;

/** Minimums the restored copy must satisfy, derived from the verified live state. */
const EXPECTED_MIN: Record<string, number> = {
  migrations: 66,
  plans: 3,
  plan_versions_current: 3,
  premium_quizzes: 12,
  premium_speaking: 18,
  courses_published: 3,
  course_lessons: 24,
  course_sections: 175,
  course_exercises: 48,
  vocab_topics: 9,
  vocab_words: 353,
  quizzes: 44,
  dictation_questions: 60,
  quiz_audio_assets: 107,
  speaking_exercises: 52,
  grammar_topics: 12,
  grammar_questions: 60,
  toeic_questions: 200,
  toeic_groups_audio: 54,
  toeic_assessments: 2,
  toeic_components: 5,
  toeic_writing_items: 16,
};

function parseAssertions(output: string) {
  const values: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([a-z_]+)\s+(\d+)\s*$/.exec(line.trim());
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

function runRestoreDrill(
  container: string,
  port: number,
  dumpPath: string,
  label: string,
) {
  console.log(`\n--- ${label}: isolated PostgreSQL 15 (${container}) ---`);
  try {
    docker(['rm', '-f', container]);
  } catch {
    /* not running */
  }
  sh('docker run', [
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=drill',
    '-p',
    `${port}:5432`,
    'postgres:15',
  ]);
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try {
      docker(['exec', container, 'pg_isready', '-U', 'postgres']);
      ready = true;
      break;
    } catch {
      execFileSync(
        process.platform === 'win32' ? 'powershell' : 'sh',
        process.platform === 'win32'
          ? ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']
          : ['-c', 'sleep 2'],
      );
    }
  }
  if (!ready) throw new Error(`${label}: drill container never became ready`);

  sh('createdb', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-c',
    'CREATE DATABASE restored;',
  ]);
  sh('docker cp dump', ['cp', dumpPath, `${container}:/tmp/restore.dump`]);
  sh('pg_restore', [
    'exec',
    container,
    'pg_restore',
    '-U',
    'postgres',
    '-d',
    'restored',
    '--no-owner',
    '--no-privileges',
    '/tmp/restore.dump',
  ]);

  const sqlPath = join(localDir, `_assertions_${stamp}.sql`);
  writeFileSync(sqlPath, ASSERTION_SQL);
  sh('docker cp sql', ['cp', sqlPath, `${container}:/tmp/assert.sql`]);
  const output = sh('psql assertions', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'restored',
    '-f',
    '/tmp/assert.sql',
  ]);

  const values = parseAssertions(output);
  const failures: string[] = [];
  for (const [key, min] of Object.entries(EXPECTED_MIN)) {
    const actual = values[key];
    if (actual === undefined) failures.push(`${key}: no value returned`);
    else if (actual < min) failures.push(`${key}: ${actual} < expected ${min}`);
  }
  for (const [key, value] of Object.entries(values))
    console.log(`    ${key.padEnd(24)} ${value}`);

  try {
    docker(['rm', '-f', container]);
  } catch {
    /* ignore */
  }

  if (failures.length) {
    for (const failure of failures) console.log(`    ! ${failure}`);
    throw new Error(`${label}: ${failures.length} assertion(s) failed`);
  }
  console.log(
    `    ${label}: all ${Object.keys(EXPECTED_MIN).length} assertions passed`,
  );
  return values;
}

async function main() {
  // ---------------------------------------------------------------- guards
  const bucket = process.env.R2_BACKUP_BUCKET_NAME;
  const endpoint = process.env.R2_BACKUP_ENDPOINT;
  const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
    throw new Error('private backup bucket is not configured');
  if (bucket === process.env.R2_BUCKET_NAME)
    throw new Error('REFUSING: backup bucket equals the public media bucket');
  if (new URL(endpoint).pathname.replace(/\//g, '').length > 0)
    throw new Error(
      'REFUSING: R2_BACKUP_ENDPOINT must be the account root, not include the bucket',
    );

  mkdirSync(localDir, { recursive: true });
  mkdirSync(join(BASELINE_ROOT, 'catalog'), { recursive: true });

  console.log(`final baseline ${stamp}`);
  console.log(`source: ${LIVE_CONTAINER} / ${LIVE_DB} (LIVE)`);
  console.log(`local : ${localDir}`);

  // ------------------------------------------------------------- pg_dump
  const pgVersion = sh('server_version', [
    'exec',
    LIVE_CONTAINER,
    'psql',
    '-U',
    LIVE_USER,
    '-d',
    LIVE_DB,
    '-t',
    '-A',
    '-c',
    'SHOW server_version;',
  ]);
  sh('pg_dump', [
    'exec',
    LIVE_CONTAINER,
    'pg_dump',
    '-U',
    LIVE_USER,
    '-d',
    LIVE_DB,
    '-Fc',
    '-f',
    `/tmp/${DUMP}`,
  ]);
  sh('docker cp dump out', [
    'cp',
    `${LIVE_CONTAINER}:/tmp/${DUMP}`,
    join(localDir, DUMP),
  ]);
  sh('pg_dumpall globals', [
    'exec',
    LIVE_CONTAINER,
    'bash',
    '-lc',
    `pg_dumpall -U ${LIVE_USER} --globals-only > /tmp/${GLOBALS}`,
  ]);
  sh('docker cp globals out', [
    'cp',
    `${LIVE_CONTAINER}:/tmp/${GLOBALS}`,
    join(localDir, GLOBALS),
  ]);

  const dumpPath = join(localDir, DUMP);
  const dumpBytes = readFileSync(dumpPath);
  if (dumpBytes.length === 0) throw new Error('dump is empty');
  const dumpSha = createHash('sha256').update(dumpBytes).digest('hex');
  const globalsPath = join(localDir, GLOBALS);
  const globalsBytes = readFileSync(globalsPath);
  const globalsSha = createHash('sha256').update(globalsBytes).digest('hex');
  console.log(`\ndump   : ${dumpBytes.length} bytes sha256=${dumpSha}`);
  console.log(`globals: ${globalsBytes.length} bytes sha256=${globalsSha}`);

  // --------------------------------------------------------- pg_restore -l
  const toc = sh('pg_restore -l', [
    'exec',
    LIVE_CONTAINER,
    'pg_restore',
    '-l',
    `/tmp/${DUMP}`,
  ]);
  const tocEntries = toc
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith(';')).length;
  console.log(`pg_restore -l OK, TOC entries: ${tocEntries}`);
  if (tocEntries < 100) throw new Error('TOC suspiciously small');

  const gitCommit = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      return 'unknown';
    }
  })();
  const migrationCount = Number(
    sh('migration count', [
      'exec',
      LIVE_CONTAINER,
      'psql',
      '-U',
      LIVE_USER,
      '-d',
      LIVE_DB,
      '-t',
      '-A',
      '-c',
      'SELECT count(*) FROM "_prisma_migrations";',
    ]),
  );

  // ---------------------------------------------- local restore drill (§44)
  const localValues = runRestoreDrill(
    'kltn-final-local-drill',
    5446,
    dumpPath,
    'LOCAL RESTORE DRILL',
  );

  // -------------------------------------------------------- companion files
  const metadata = {
    backupId: `baseline_${stamp}`,
    class: 'PROTECTED_BASELINE',
    createdAt: new Date().toISOString(),
    database: LIVE_DB,
    sourceContainer: LIVE_CONTAINER,
    fullLogicalBackup: true,
    mediaBytesIncluded: false,
    postgresVersion: pgVersion,
    gitCommit,
    migrationCount,
    format: 'custom (pg_dump -Fc)',
    dumpFile: DUMP,
    globalsFile: GLOBALS,
    metadataFile: META,
    sha256File: SHAFILE,
    dumpBytes: dumpBytes.length,
    dumpSha256: dumpSha,
    globalsBytes: globalsBytes.length,
    globalsSha256: globalsSha,
    tocEntries,
    archiveVerified: true,
    localRestore: 'PASS',
    localRestoreAssertions: localValues,
    protected: true,
  };
  writeFileSync(join(localDir, META), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(
    join(localDir, SHAFILE),
    `${dumpSha}  ${DUMP}\n${globalsSha}  ${GLOBALS}\n`,
  );

  // ------------------------------------------------------------ R2 upload
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  const datePrefix = `${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}`;
  const prefix = `database-backups/protected/baseline/${datePrefix}`;
  const uploads = [
    { file: DUMP, type: 'application/octet-stream' },
    { file: GLOBALS, type: 'application/sql' },
    { file: META, type: 'application/json' },
    { file: SHAFILE, type: 'text/plain' },
  ];
  const remote: Record<string, { key: string; bytes: number }> = {};
  console.log(`\n--- R2 UPLOAD to ${bucket}/${prefix} ---`);
  for (const upload of uploads) {
    const body = readFileSync(join(localDir, upload.file));
    const key = `${prefix}/${upload.file}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: upload.type,
        Metadata: {
          class: 'PROTECTED_BASELINE',
          database: LIVE_DB,
          'media-bytes-included': 'false',
        },
      }),
    );
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (head.ContentLength !== body.length)
      throw new Error(`${upload.file}: remote size mismatch`);
    remote[upload.file] = { key, bytes: head.ContentLength ?? 0 };
    console.log(
      `    uploaded ${upload.file.padEnd(34)} ${head.ContentLength} bytes  ${head.ContentType}`,
    );
  }

  // privacy probe: the dump must not be reachable over the public media URL
  const publicBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
  let probeStatus = 0;
  if (publicBase) {
    const probe = await fetch(`${publicBase}/${remote[DUMP].key}`, {
      method: 'GET',
    });
    probeStatus = probe.status;
    if (probe.status === 200)
      throw new Error('REFUSING: the baseline dump is publicly readable');
  }
  console.log(`    public probe status: ${probeStatus} (must not be 200)`);

  // ------------------------------------------- download + remote drill (§50)
  const downloadPath = join(localDir, `_remote_download_${stamp}.dump`);
  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: remote[DUMP].key }),
  );
  const downloaded = Buffer.from(await got.Body!.transformToByteArray());
  writeFileSync(downloadPath, downloaded);
  const downloadedSha = createHash('sha256').update(downloaded).digest('hex');
  console.log(
    `\ndownloaded ${downloaded.length} bytes sha256=${downloadedSha}`,
  );
  if (downloadedSha !== dumpSha)
    throw new Error('remote-downloaded SHA256 does not match the local dump');
  console.log('FINAL_R2_SHA256_MATCH=true');

  const remoteValues = runRestoreDrill(
    'kltn-final-remote-drill',
    5447,
    downloadPath,
    'REMOTE-DOWNLOADED RESTORE DRILL',
  );

  // --------------------------------------------------------------- catalog
  const catalog = existsSync(CATALOG)
    ? (JSON.parse(readFileSync(CATALOG, 'utf8')) as {
        schemaVersion?: number;
        backups?: unknown[];
      })
    : { schemaVersion: 1, backups: [] };
  catalog.backups = catalog.backups ?? [];
  catalog.backups.push({
    ...metadata,
    localPath: dumpPath,
    r2Bucket: bucket,
    r2Prefix: prefix,
    r2Keys: Object.fromEntries(
      Object.entries(remote).map(([file, info]) => [file, info.key]),
    ),
    r2UploadVerified: true,
    r2CompanionArtifactsComplete: true,
    r2RemoteSha256: downloadedSha,
    r2RemoteSizeMatches: true,
    r2PublicProbeStatus: probeStatus,
    r2RemoteRestore: 'PASS',
    r2RemoteRestoreAssertions: remoteValues,
    isFinalBaseline: true,
  });
  (catalog as { updatedAt?: string }).updatedAt = new Date().toISOString();
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`\ncatalog updated: ${CATALOG}`);

  console.log('\n================ FINAL BASELINE SUMMARY ================');
  console.log(`dump            : ${DUMP}`);
  console.log(`localDir        : ${localDir}`);
  console.log(`bytes           : ${dumpBytes.length}`);
  console.log(`sha256          : ${dumpSha}`);
  console.log(`tocEntries      : ${tocEntries}`);
  console.log(`postgres        : ${pgVersion}`);
  console.log(`migrations      : ${migrationCount}`);
  console.log(`gitCommit       : ${gitCommit}`);
  console.log(`r2Prefix        : ${bucket}/${prefix}`);
  console.log('FINAL_MEDIA_ACCESS_BASELINE_BACKUP_CREATED=true');
  console.log('FINAL_LOCAL_ARCHIVE_VALID=true');
  console.log('FINAL_LOCAL_RESTORE_PASS=true');
  console.log('FINAL_R2_UPLOAD_PASS=true');
  console.log('FINAL_R2_COMPANION_ARTIFACTS_COMPLETE=true');
  console.log('FINAL_R2_SHA256_MATCH=true');
  console.log('FINAL_R2_RESTORE_PASS=true');
}

void main().catch((error: unknown) => {
  console.error(
    '\nFINAL BASELINE FAILED:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
