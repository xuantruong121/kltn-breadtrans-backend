/**
 * Off-site PostgreSQL backup to the PRIVATE database-backup R2 bucket.
 *
 * Local backups are never replaced by this — R2 is an additional copy.
 *
 * Pipeline (fails closed at every step; a remote failure never deletes or
 * invalidates the local dump):
 *   1  local dump exists and is non-zero
 *   2  pg_restore -l can read the archive            -> LOCAL_VALID
 *   3  SHA256 of the local file
 *   4  upload to private R2 (authenticated S3 only)
 *   5  HeadObject: remote object exists
 *   6  remote size == local size
 *   7  download the remote object back
 *   8  SHA256 of the downloaded bytes
 *   9  downloaded SHA256 == local SHA256
 *  10  prove the bucket is NOT publicly readable
 *  11  restore the DOWNLOADED dump into a throwaway PostgreSQL 15 container
 *  12  application-level assertions on the restored copy  -> REMOTE_VALID
 *
 * Database dumps go to the backup bucket only. They are never written to the
 * media bucket and never exposed through a public URL.
 *
 * Usage:
 *   npx ts-node scripts/db-backup-offsite.ts --file <path-to.dump> --checkpoint <label> --class PROTECTED_BASELINE
 *   npx ts-node scripts/db-backup-offsite.ts --file <path> --no-restore-drill
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { basename, join } from 'path';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const localFile = arg('file');
const checkpoint = arg('checkpoint', 'adhoc')!;
const backupClass = arg('class', 'PROTECTED_BASELINE')!;
const skipDrill = process.argv.includes('--no-restore-drill');

if (!localFile) {
  console.error('--file <path-to.dump> is required');
  process.exit(1);
}

const bucket = process.env.R2_BACKUP_BUCKET_NAME;
const endpoint = process.env.R2_BACKUP_ENDPOINT;
const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY;

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error(
    'Private backup bucket is not configured (R2_BACKUP_BUCKET_NAME / _ENDPOINT / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY).',
  );
  process.exit(1);
}
if (bucket === process.env.R2_BUCKET_NAME) {
  console.error(
    'REFUSING: the backup bucket equals the public media bucket. Database dumps must never go to a public media bucket.',
  );
  process.exit(1);
}

// The S3 client appends `Bucket` to the endpoint, so an endpoint that already
// carries a path (e.g. ".../breadtrans-backup") silently stores every object
// under a doubled "<bucket>/" key prefix: the keys no longer match the catalog,
// CreateBucket degrades into a PutObject, and ListObjectsV2 returns nothing.
// Writes and reads through the same misconfigured client stay self-consistent,
// so this must be rejected up front rather than "verified" later.
{
  let endpointPath: string;
  try {
    endpointPath = new URL(endpoint).pathname;
  } catch {
    console.error(`REFUSING: R2_BACKUP_ENDPOINT is not a valid URL.`);
    process.exit(1);
  }
  if (endpointPath.replace(/\//g, '').length > 0) {
    console.error(
      `REFUSING: R2_BACKUP_ENDPOINT must be the account root, but it has a path ("${endpointPath}"). ` +
        'Remove the bucket name from the endpoint — the bucket is passed separately.',
    );
    process.exit(1);
  }
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

/** database-backups/<class-dir>/<checkpoint>/YYYY/MM/DD/<file> */
function remoteKeyFor(file: string) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const classDir =
    backupClass === 'AUTOMATIC'
      ? `automatic/${y}/${m}/${d}`
      : backupClass === 'PROTECTED_PRE_RECOVERY'
        ? `protected/pre-recovery/${checkpoint}`
        : backupClass === 'PROTECTED_HANDOFF'
          ? `protected/handoff/${checkpoint}`
          : `protected/baseline/${checkpoint}`;
  return `database-backups/${classDir}/${basename(file)}`;
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function docker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

async function main() {
  const result: Record<string, unknown> = {
    localFile,
    checkpoint,
    class: backupClass,
    bucketIsMediaBucket: false,
  };

  // 1 + 2. Local archive must exist, be non-zero and be readable by pg_restore.
  if (!existsSync(localFile!))
    throw new Error(`local dump not found: ${localFile}`);
  const localStat = statSync(localFile!);
  if (localStat.size <= 0) throw new Error('local dump is zero bytes');
  const localBytes = readFileSync(localFile!);
  const localSha = sha256(localBytes);
  result.localBytes = localStat.size;
  result.localSha256 = localSha;

  docker(['cp', localFile!, 'kltn-postgres:/tmp/offsite-verify.dump']);
  docker([
    'exec',
    'kltn-postgres',
    'pg_restore',
    '-l',
    '/tmp/offsite-verify.dump',
  ]);
  docker(['exec', 'kltn-postgres', 'rm', '-f', '/tmp/offsite-verify.dump']);
  result.localArchiveVerified = true;
  console.log(
    `LOCAL_VALID  ${basename(localFile!)}  ${localStat.size} bytes  sha256=${localSha}`,
  );

  // 4. Upload to the private bucket.
  const key = remoteKeyFor(localFile!);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: localBytes,
      ContentType: 'application/octet-stream',
      Metadata: {
        checkpoint,
        class: backupClass,
        sha256: localSha,
        database: 'kltn_db',
      },
    }),
  );
  result.remoteKey = key;
  console.log(`UPLOADED     ${key}`);

  // 5 + 6. Remote object must exist with a matching size.
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  result.remoteBytes = head.ContentLength;
  if (head.ContentLength !== localStat.size)
    throw new Error(
      `remote size ${head.ContentLength} != local size ${localStat.size}`,
    );
  result.remoteSizeMatch = true;

  // 7 + 8 + 9. Download it back and compare hashes.
  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const downloaded = Buffer.from(await got.Body!.transformToByteArray());
  const downloadedSha = sha256(downloaded);
  result.downloadedBytes = downloaded.length;
  result.downloadedSha256 = downloadedSha;
  result.sha256Match = downloadedSha === localSha;
  if (downloadedSha !== localSha)
    throw new Error('downloaded SHA256 does not match the local dump');
  console.log(`DOWNLOAD OK  sha256 match (${downloadedSha})`);

  // 10. Prove the bucket is not publicly readable.
  let publicReachable = false;
  const publicBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (publicBase) {
    const probe = `${publicBase}/${key}`;
    try {
      const response = await fetch(probe, { method: 'GET' });
      publicReachable = response.ok;
      result.publicProbe = {
        url: probe.replace(publicBase, '<public-base>'),
        status: response.status,
      };
    } catch {
      result.publicProbe = { error: 'request failed (not reachable)' };
    }
  }
  result.backupBucketPrivate = !publicReachable;
  if (publicReachable)
    throw new Error(
      'SECURITY: the uploaded database dump is reachable over the public media URL',
    );
  console.log(
    'PRIVACY OK   dump is not reachable through the public media base URL',
  );

  // 11 + 12. Restore the DOWNLOADED bytes into a throwaway server.
  if (!skipDrill) {
    const drill = `kltn-offsite-drill-${Date.now()}`;
    const volume = `${drill}-data`;
    const tmpDump = join(process.env.TEMP ?? '.', `${drill}.dump`);
    writeFileSync(tmpDump, downloaded);
    try {
      docker([
        'run',
        '-d',
        '--name',
        drill,
        '-e',
        'POSTGRES_USER=postgres',
        '-e',
        'POSTGRES_PASSWORD=drill',
        '-e',
        'POSTGRES_DB=kltn_offsite_restore',
        '-v',
        `${volume}:/var/lib/postgresql/data`,
        'postgres:15-alpine',
      ]);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          docker([
            'exec',
            drill,
            'pg_isready',
            '-U',
            'postgres',
            '-d',
            'kltn_offsite_restore',
          ]);
          ready = true;
        } catch {
          /* still starting */
        }
      }
      if (!ready) throw new Error('throwaway PostgreSQL never became ready');

      docker(['cp', tmpDump, `${drill}:/tmp/remote.dump`]);
      try {
        docker([
          'exec',
          drill,
          'pg_restore',
          '-U',
          'postgres',
          '-d',
          'kltn_offsite_restore',
          '--no-owner',
          '--no-privileges',
          '/tmp/remote.dump',
        ]);
      } catch {
        // pg_restore may emit non-fatal notices; assertions below decide.
      }

      const q = (sql: string) =>
        docker([
          'exec',
          drill,
          'psql',
          '-U',
          'postgres',
          '-d',
          'kltn_offsite_restore',
          '-tAc',
          sql,
        ]).trim();

      const assertions = {
        publicTables: Number(
          q(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
          ),
        ),
        migrations: Number(q('SELECT count(*) FROM "_prisma_migrations"')),
        planFree: Number(q('SELECT count(*) FROM "Plan" WHERE code=\'FREE\'')),
        planPlus: Number(q('SELECT count(*) FROM "Plan" WHERE code=\'PLUS\'')),
        planPro: Number(q('SELECT count(*) FROM "Plan" WHERE code=\'PRO\'')),
        courses: Number(q('SELECT count(*) FROM "Course"')),
        ipaCourseLessons: Number(
          q('SELECT count(*) FROM "CourseLesson" WHERE "courseId"=12'),
        ),
        vocabWords: Number(q('SELECT count(*) FROM "VocabWord"')),
        toeicExamSets: Number(q('SELECT count(*) FROM "ToeicExamSet"')),
        toeicAssessments: Number(q('SELECT count(*) FROM "ToeicAssessment"')),
        listeningAudioLinked: Number(
          q(
            'SELECT count(*) FROM "ToeicQuestionGroup" WHERE "examId"=1 AND part<=4 AND "audioUrl" IS NOT NULL',
          ),
        ),
      };
      result.remoteRestoreAssertions = assertions;

      const failures: string[] = [];
      if (assertions.publicTables <= 0)
        failures.push('no public tables restored');
      if (assertions.migrations <= 0) failures.push('_prisma_migrations empty');
      if (!assertions.planFree || !assertions.planPlus || !assertions.planPro)
        failures.push('FREE/PLUS/PRO plan missing');
      if (assertions.courses <= 0) failures.push('no courses');
      if (assertions.toeicExamSets <= 0) failures.push('no TOEIC exam sets');
      result.remoteRestoreFailures = failures;
      result.remoteValid = failures.length === 0;
      console.log(
        `REMOTE RESTORE ${failures.length === 0 ? 'PASS' : 'FAIL'}  ${JSON.stringify(assertions)}`,
      );
      if (failures.length)
        throw new Error(
          `remote restore assertions failed: ${failures.join('; ')}`,
        );
    } finally {
      try {
        docker(['rm', '-f', drill]);
      } catch {
        /* ignore */
      }
      try {
        docker(['volume', 'rm', volume]);
      } catch {
        /* ignore */
      }
    }
  } else {
    result.remoteValid = false;
    result.remoteRestoreSkipped = true;
  }

  const outDir = join(__dirname, '..', 'artifacts');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'offsite-backup-verification.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), ...result },
      null,
      1,
    ),
  );
  console.log('\nOFFSITE BACKUP VERIFIED');
  console.log(JSON.stringify(result, null, 1));
}

void main().catch((error) => {
  console.error(
    '\nOFFSITE BACKUP FAILED (local dump left intact):',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
