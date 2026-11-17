/**
 * Monthly off-site restore drill (owner 2026-11-16): download the newest
 * automatic backup from the R2 backup bucket, then restore it with the same
 * drill the backup container runs weekly (docker/postgres-backup/
 * restore-drill.sh), on the throwaway postgres-drill server. Never touches
 * kltn_db. Run by hand: `npm run db:restore:drill:r2`.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DatabaseBackupR2SyncService } from '../src/jobs/database-backup-r2-sync.service';

const PREFIX = 'database-backups/automatic/';
const CONTAINER = process.env.BACKUP_CONTAINER || 'kltn-postgres-backup';

async function main() {
  const sync = new DatabaseBackupR2SyncService();
  const client = sync.getClient();
  const bucket = process.env.R2_BACKUP_BUCKET_NAME;
  if (!client || !bucket)
    throw new Error('R2 backup credentials are not configured in .env');

  // Newest automatic dump. An automatic dump is exactly <db>_YYYYMMDD_HHMMSS.dump
  // (backup.sh); labelled dumps such as kltn_db_SpeakingExercise_PRE_..._<ts>.dump
  // also sit under this prefix and, sorted by name, came last (letters sort after
  // digits): the 2026-11-17 drill restored a one-table dump and failed.
  // kltn_db is PGDATABASE of the backup container (docker-compose.yml).
  const AUTOMATIC = /^kltn_db_\d{8}_\d{6}\.dump$/;
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? [])
      if (o.Key && AUTOMATIC.test(o.Key.split('/').pop()!)) keys.push(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  if (keys.length === 0) throw new Error(`no automatic dump under ${PREFIX}`);
  const key = keys
    .sort((a, b) => (a.split('/').pop()! < b.split('/').pop()! ? -1 : 1))
    .pop()!;
  const name = key.split('/').pop()!;

  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = Buffer.from(await object.Body!.transformToByteArray());
  const sha = createHash('sha256').update(bytes).digest('hex');
  const catalog = sync.readCatalog(sync.getCatalogPath());
  const known = catalog.backups.find((b) => b.dumpFile === name);
  if (known?.sha256 && known.sha256 !== sha)
    throw new Error(`sha256 of ${name} differs from the catalog`);

  // The backup container sees POSTGRES_BACKUP_DIR as /backups.
  const hostDir = resolve(
    process.env.POSTGRES_BACKUP_DIR || join(process.cwd(), 'db-backups'),
  );
  const drillDir = join(hostDir, 'r2-drill');
  mkdirSync(drillDir, { recursive: true });
  writeFileSync(join(drillDir, name), bytes);
  console.log(
    `downloaded ${key} (${bytes.length} bytes, sha256 ${sha}${known?.sha256 ? ', matches catalog' : ''})`,
  );

  try {
    const out = execFileSync(
      'docker',
      [
        'exec',
        CONTAINER,
        'sh',
        '/usr/local/bin/restore-drill.sh',
        '--now',
        `/backups/r2-drill/${name}`,
      ],
      { encoding: 'utf8' },
    );
    process.stdout.write(out);
  } finally {
    rmSync(join(drillDir, name), { force: true });
  }
  const results = readFileSync(
    join(hostDir, '.last-restore-drill'),
    'utf8',
  ).trim();
  console.log(
    `drill finished; state ${results}. Result JSON is in ${hostDir} (restore-drill-*.json).`,
  );
}

main().catch((error) => {
  console.error(`R2 RESTORE DRILL FAILED: ${(error as Error).message}`);
  process.exit(1);
});
