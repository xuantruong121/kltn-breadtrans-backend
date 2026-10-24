/**
 * READ-ONLY Cloudflare R2 inventory for post-incident reconstruction.
 *
 * Lists objects in the configured public bucket, groups them by BreadTrans
 * prefix, and writes a manifest to artifacts/. It performs ListObjectsV2 and
 * HeadObject only — it never uploads, deletes or copies anything.
 *
 * Usage:
 *   npx ts-node scripts/r2-inventory.ts                 # summary + manifest
 *   npx ts-node scripts/r2-inventory.ts --prefix toeic/  # limit to a prefix
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

type Obj = {
  key: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  contentType: string | null;
  metadata: Record<string, string>;
  publicReachability: 'REACHABLE' | 'NOT_REACHABLE' | 'NOT_CONFIGURED' | 'UNKNOWN';
};

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error('R2 configuration incomplete; cannot inventory.');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function listAll(prefix?: string): Promise<Obj[]> {
  const objects: Obj[] = [];
  let token: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified
          ? item.LastModified.toISOString()
          : null,
        etag: item.ETag ? item.ETag.replace(/"/g, '') : null,
        contentType: null,
        metadata: {},
        publicReachability: publicUrl ? 'UNKNOWN' : 'NOT_CONFIGURED',
      });
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await mapper(values[index]);
      }
    }),
  );
}

async function enrichObject(object: Obj): Promise<void> {
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: object.key }),
  );
  object.contentType = head.ContentType ?? null;
  object.metadata = head.Metadata ?? {};
  object.size = head.ContentLength ?? object.size;
  object.etag = head.ETag?.replace(/"/g, '') ?? object.etag;

  if (!publicUrl) return;
  try {
    const response = await fetch(`${publicUrl}/${object.key}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    object.publicReachability = response.ok ? 'REACHABLE' : 'NOT_REACHABLE';
  } catch {
    object.publicReachability = 'NOT_REACHABLE';
  }
}

/** Groups by the first two path segments so real layout is observed, not assumed. */
function groupKey(key: string) {
  const parts = key.split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/') + '/';
}

async function main() {
  const prefixArg = process.argv.indexOf('--prefix');
  const prefix = prefixArg >= 0 ? process.argv[prefixArg + 1] : undefined;

  console.log(
    `R2 inventory (READ-ONLY) bucket=<configured>${prefix ? ` prefix=${prefix}` : ''}`,
  );
  const objects = await listAll(prefix);
  console.log(`total objects: ${objects.length}`);
  console.log('enriching object headers and public reachability (read-only)...');
  await mapConcurrent(objects, 16, enrichObject);

  const groups = new Map<string, { count: number; bytes: number }>();
  for (const object of objects) {
    const group = groupKey(object.key);
    const entry = groups.get(group) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += object.size;
    groups.set(group, entry);
  }

  console.log('');
  console.log('objects by prefix:');
  for (const [group, entry] of [...groups.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  )) {
    console.log(
      `  ${group.padEnd(44)} ${String(entry.count).padStart(6)} objects  ${(
        entry.bytes /
        1024 /
        1024
      ).toFixed(1)} MB`,
    );
  }

  const zeroByte = objects.filter((o) => o.size === 0);
  if (zeroByte.length) console.log(`\nzero-byte objects: ${zeroByte.length}`);

  const outDir = join(__dirname, '..', 'artifacts');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'r2-full-inventory.json');
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: 'READ_ONLY_FULL',
        bucket: '<configured-public-media-bucket>',
        totalObjects: objects.length,
        groups: [...groups.entries()].map(([k, v]) => ({ prefix: k, ...v })),
        objects,
      },
      null,
      1,
    ),
  );
  console.log(`\nmanifest: ${outFile}`);
}

void main().catch((error) => {
  console.error(
    'R2 inventory failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
