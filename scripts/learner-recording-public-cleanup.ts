/**
 * Learner Speaking recordings that were written to the PUBLIC bucket before
 * recordings moved to the private bucket (premium/speaking/practice/...).
 *
 *   list               read-only: counts the .wav objects under the two
 *                      learner prefixes and which ones are still referenced.
 *   manifest <file>    read-only dry run: writes every candidate key with its
 *                      public HTTP status and referencing submission.
 *   migrate <manifest> copies each REFERENCED recording to the private bucket
 *                      (premium/speaking/practice/legacy/...), verifies bytes
 *                      and sha256, then repoints SpeakingSubmission.audioKey
 *                      (and clears the public audioUrl) in a guarded update.
 *                      Needs LEARNER_RECORDING_MIGRATE_AUTHORIZED=migrate.
 *   delete <manifest>  deletes exactly the manifest keys, only when the live
 *                      listing equals the manifest and none is referenced.
 *                      Needs LEARNER_RECORDING_DELETE_AUTHORIZED=delete.
 *   verify <manifest>  read-only: every manifest URL is gone from the public
 *                      bucket and every migrated row points at a private key
 *                      that exists.
 *
 * Keys are never printed in full: recordings are private learner data.
 * Usage: npx ts-node scripts/learner-recording-public-cleanup.ts <mode> [file]
 */
import 'dotenv/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIXES = ['speaking/pending/', 'catalog/speaking/submissions/'];
const PRIVATE_PREFIX = 'premium/speaking/practice/legacy/';
type Row = {
  key: string;
  referencedBySubmission: number | null;
  submissionUser: number | null;
};

const e = process.env;
const publicClient = new S3Client({
  region: 'auto',
  endpoint:
    e.R2_ENDPOINT || `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: e.R2_ACCESS_KEY_ID!,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
  },
});
const privateClient = new S3Client({
  region: 'auto',
  endpoint:
    e.R2_PRIVATE_ENDPOINT ||
    e.R2_ENDPOINT ||
    `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: e.R2_PRIVATE_ACCESS_KEY_ID || e.R2_ACCESS_KEY_ID!,
    secretAccessKey: e.R2_PRIVATE_SECRET_ACCESS_KEY || e.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: e.R2_PRIVATE_FORCE_PATH_STYLE === 'true',
});
const mask = (key: string) => `${key.slice(0, 22)}…${key.slice(-8)}`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const publicStatus = async (key: string) =>
  (
    await fetch(`${e.R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}`, {
      method: 'HEAD',
    }).catch(() => null)
  )?.status ?? null;

async function listCandidates() {
  const keys: string[] = [];
  for (const Prefix of PREFIXES) {
    let ContinuationToken: string | undefined;
    do {
      const page = await publicClient.send(
        new ListObjectsV2Command({
          Bucket: e.R2_BUCKET_NAME!,
          Prefix,
          ContinuationToken,
        }),
      );
      for (const o of page.Contents ?? [])
        if (o.Key?.endsWith('.wav')) keys.push(o.Key);
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
  }
  return keys.sort();
}

async function body(client: S3Client, Bucket: string, Key: string) {
  const res = await client.send(new GetObjectCommand({ Bucket, Key }));
  return {
    buffer: Buffer.from(await res.Body!.transformToByteArray()),
    contentType: res.ContentType,
  };
}

const readManifest = (file: string) =>
  (JSON.parse(readFileSync(file, 'utf8')) as Row[]).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

async function main() {
  const mode = process.argv[2];
  const file = process.argv[3];
  const prisma = new PrismaClient();
  try {
    const keys = await listCandidates();
    const referenced = await prisma.speakingSubmission.findMany({
      where: { audioKey: { in: keys } },
      select: { id: true, audioKey: true, userId: true },
    });

    if (mode === 'list' || !mode) {
      console.log(
        `public learner recordings: ${keys.length}; referenced by submissions: ${referenced.map((r) => r.id).join(', ') || 'none'}`,
      );
      return;
    }

    if (mode === 'manifest') {
      if (!file) throw new Error('manifest needs an output file path');
      const rows = [];
      for (const key of keys) {
        const ref = referenced.find((r) => r.audioKey === key);
        rows.push({
          key,
          prefix: PREFIXES.find((p) => key.startsWith(p)),
          publicStatus: await publicStatus(key),
          referencedBySubmission: ref?.id ?? null,
          submissionUser: ref?.userId ?? null,
          proposedAction: ref
            ? 'MIGRATE_PRIVATE_THEN_DELETE'
            : 'DELETE_EXACT_KEY',
        });
      }
      writeFileSync(file, JSON.stringify(rows, null, 2));
      console.log(
        `manifest: ${rows.length} keys; public 200: ${rows.filter((r) => r.publicStatus === 200).length}; referenced: ${rows.filter((r) => r.referencedBySubmission !== null).length}; orphaned: ${rows.filter((r) => r.referencedBySubmission === null).length}`,
      );
      return;
    }

    if (!file) throw new Error(`${mode} needs the manifest file`);
    const manifest = readManifest(file);
    const manifestKeys = manifest.map((r) => r.key);

    if (mode === 'migrate') {
      if (e.LEARNER_RECORDING_MIGRATE_AUTHORIZED !== 'migrate')
        throw new Error(
          'REFUSED: LEARNER_RECORDING_MIGRATE_AUTHORIZED=migrate not set',
        );
      const targets = manifest.filter((r) => r.referencedBySubmission !== null);
      const backupDir = resolve(
        '..',
        '..',
        '.local-backups',
        'recording-cleanup',
      );
      mkdirSync(backupDir, { recursive: true });
      for (const row of targets) {
        const sub = await prisma.speakingSubmission.findUnique({
          where: { id: row.referencedBySubmission! },
          select: {
            id: true,
            userId: true,
            audioKey: true,
            audioUrl: true,
            audioMimeType: true,
          },
        });
        if (
          !sub ||
          sub.audioKey !== row.key ||
          sub.userId !== row.submissionUser
        )
          throw new Error(
            `STOP: submission ${row.referencedBySubmission} no longer matches the manifest`,
          );
        if (
          !PREFIXES.some((p) => row.key.startsWith(p)) ||
          !row.key.endsWith('.wav')
        )
          throw new Error(
            `STOP: ${mask(row.key)} is outside the approved prefixes`,
          );
        writeFileSync(
          resolve(backupDir, `speaking-submission-${sub.id}.json`),
          JSON.stringify(
            { ...sub, backedUpAt: new Date().toISOString() },
            null,
            2,
          ),
        );
        const src = await body(publicClient, e.R2_BUCKET_NAME!, row.key);
        const target = `${PRIVATE_PREFIX}${sub.userId}/${sub.id}-${row.key.split('/').pop()}`;
        const exists = await privateClient
          .send(
            new HeadObjectCommand({
              Bucket: e.R2_PRIVATE_BUCKET_NAME!,
              Key: target,
            }),
          )
          .then(() => true)
          .catch(() => false);
        if (exists) {
          const already = await body(
            privateClient,
            e.R2_PRIVATE_BUCKET_NAME!,
            target,
          );
          if (sha(already.buffer) !== sha(src.buffer))
            throw new Error(
              `STOP: a different private object already exists for submission ${sub.id}`,
            );
        } else {
          await privateClient.send(
            new PutObjectCommand({
              Bucket: e.R2_PRIVATE_BUCKET_NAME!,
              Key: target,
              Body: src.buffer,
              ContentType: src.contentType || sub.audioMimeType || 'audio/wav',
            }),
          );
        }
        const copy = await body(
          privateClient,
          e.R2_PRIVATE_BUCKET_NAME!,
          target,
        );
        if (
          copy.buffer.length !== src.buffer.length ||
          sha(copy.buffer) !== sha(src.buffer)
        )
          throw new Error(
            `STOP: private copy of submission ${sub.id} does not match`,
          );
        const leak = await publicStatus(target);
        if (leak === 200)
          throw new Error(
            `STOP: private key of submission ${sub.id} is publicly readable`,
          );
        const updated = await prisma.speakingSubmission.updateMany({
          where: { id: sub.id, userId: sub.userId, audioKey: row.key },
          data: { audioKey: target, audioUrl: null },
        });
        if (updated.count !== 1)
          throw new Error(
            `STOP: guarded update of submission ${sub.id} changed ${updated.count} rows`,
          );
        console.log(
          `migrated submission ${sub.id}: ${src.buffer.length} bytes, sha256 ${sha(src.buffer).slice(0, 12)}…, public probe of private key ${leak}`,
        );
      }
      console.log(`migrated: ${targets.length}`);
      return;
    }

    if (mode === 'delete') {
      if (e.LEARNER_RECORDING_DELETE_AUTHORIZED !== 'delete')
        throw new Error(
          'REFUSED: LEARNER_RECORDING_DELETE_AUTHORIZED=delete not set',
        );
      if (JSON.stringify(keys) !== JSON.stringify(manifestKeys))
        throw new Error(
          `STOP: live listing (${keys.length}) differs from the manifest (${manifestKeys.length})`,
        );
      if (referenced.length)
        throw new Error(
          `STOP: still referenced by submissions ${referenced.map((r) => r.id).join(', ')}`,
        );
      let deleted = 0;
      for (const Key of manifestKeys) {
        await publicClient.send(
          new DeleteObjectCommand({ Bucket: e.R2_BUCKET_NAME!, Key }),
        );
        deleted += 1;
      }
      console.log(
        `deleted: ${deleted} of ${manifestKeys.length} manifest keys`,
      );
      return;
    }

    if (mode === 'verify') {
      let publicLeft = 0;
      for (const row of manifest)
        if ((await publicStatus(row.key)) === 200) publicLeft += 1;
      const stillListed = keys.filter((k) => manifestKeys.includes(k)).length;
      const migrated = await prisma.speakingSubmission.findMany({
        where: {
          id: {
            in: manifest
              .map((r) => r.referencedBySubmission)
              .filter((x): x is number => x !== null),
          },
        },
        select: { id: true, audioKey: true, audioUrl: true },
      });
      const privateOk = await Promise.all(
        migrated.map((m) =>
          m.audioKey?.startsWith(PRIVATE_PREFIX)
            ? privateClient
                .send(
                  new HeadObjectCommand({
                    Bucket: e.R2_PRIVATE_BUCKET_NAME!,
                    Key: m.audioKey,
                  }),
                )
                .then(() => !m.audioUrl)
                .catch(() => false)
            : Promise.resolve(false),
        ),
      );
      console.log(
        `verify: manifest ${manifest.length}; still public (HTTP 200): ${publicLeft}; still listed: ${stillListed}; migrated rows on a private key that exists: ${privateOk.filter(Boolean).length}/${migrated.length}`,
      );
      return;
    }
    throw new Error(`unknown mode ${mode}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('STOPPED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
