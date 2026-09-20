import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PlannedMove = {
  oldKey: string;
  newKey: string;
  references: Array<{
    model: string;
    id: number;
    field: string;
    userId?: number;
  }>;
};

const prisma = new PrismaClient();
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME ?? 'breadtrans-files';
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

if (!accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
  throw new Error('R2 credentials and R2_PUBLIC_URL are required.');
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function publicObjectUrl(key: string): string {
  return `${publicUrl}/${key}`;
}

function basename(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

function r2Key(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.includes('/') ? value : null;
  try {
    const url = new URL(value);
    if (
      !url.hostname.endsWith('.r2.dev') &&
      !url.hostname.endsWith('.r2.cloudflarestorage.com')
    ) {
      return null;
    }
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

async function listKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key) keys.add(object.Key);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

async function copyAndVerify(oldKey: string, newKey: string): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: newKey,
      CopySource: `${bucket}/${encodeURIComponent(oldKey).replace(/%2F/g, '/')}`,
      MetadataDirective: 'COPY',
    }),
  );
  const source = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: oldKey }),
  );
  const target = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: newKey }),
  );
  if (source.ContentLength !== target.ContentLength) {
    throw new Error(
      `Verification failed for ${oldKey} -> ${newKey}: size mismatch`,
    );
  }
}

async function uploadAndVerify(
  filePath: string,
  key: string,
  contentType: string,
): Promise<void> {
  const body = await readFile(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  const target = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (target.ContentLength !== body.length) {
    throw new Error(`Verification failed for upload ${key}: size mismatch`);
  }
}

async function main(): Promise<void> {
  const existingKeys = await listKeys();
  const moves = new Map<string, PlannedMove>();

  const groups = await prisma.toeicQuestionGroup.findMany({
    select: { id: true, imageUrl: true, audioUrl: true },
  });
  for (const group of groups) {
    if (group.imageUrl?.includes('/toeic/visuals/')) {
      const oldKey = new URL(group.imageUrl).pathname.slice(1);
      const newKey = `catalog/toeic/shared/images/${basename(oldKey)}`;
      const move = moves.get(oldKey) ?? { oldKey, newKey, references: [] };
      move.references.push({
        model: 'ToeicQuestionGroup',
        id: group.id,
        field: 'imageUrl',
      });
      moves.set(oldKey, move);
    }
    if (group.audioUrl?.includes('/toeic/visuals/')) {
      const oldKey = new URL(group.audioUrl).pathname.slice(1);
      const newKey = `catalog/toeic/shared/audio/${basename(oldKey)}`;
      const move = moves.get(oldKey) ?? { oldKey, newKey, references: [] };
      move.references.push({
        model: 'ToeicQuestionGroup',
        id: group.id,
        field: 'audioUrl',
      });
      moves.set(oldKey, move);
    }
  }

  const submissions = await prisma.speakingSubmission.findMany({
    select: { id: true, userId: true, audioUrl: true, audioKey: true },
  });
  for (const submission of submissions) {
    const oldKey =
      submission.audioKey ?? r2Key(submission.audioUrl) ?? undefined;
    if (!oldKey || !existingKeys.has(oldKey)) continue;
    const newKey = `catalog/speaking/submissions/${submission.userId}/${submission.id}/${basename(oldKey)}`;
    const move = moves.get(oldKey) ?? { oldKey, newKey, references: [] };
    move.references.push({
      model: 'SpeakingSubmission',
      id: submission.id,
      field: 'audioKey',
      userId: submission.userId,
    });
    moves.set(oldKey, move);
  }

  for (const oldKey of existingKeys) {
    if (moves.has(oldKey)) continue;
    if (oldKey.startsWith('speaking_audio/')) {
      const canonicalKey = `catalog/speaking/submissions/`;
      if (
        [...existingKeys].some(
          (key) =>
            key.startsWith(canonicalKey) &&
            key.endsWith(`/${basename(oldKey)}`),
        )
      )
        continue;
      moves.set(oldKey, {
        oldKey,
        newKey: `unclassified/speaking/${basename(oldKey)}`,
        references: [],
      });
    } else if (oldKey.startsWith('toeic/')) {
      if (existingKeys.has(`catalog/toeic/shared/images/${basename(oldKey)}`))
        continue;
      moves.set(oldKey, {
        oldKey,
        newKey: `unclassified/toeic/${basename(oldKey)}`,
        references: [],
      });
    }
  }

  for (const move of moves.values()) {
    if (!existingKeys.has(move.oldKey))
      throw new Error(`Missing source object: ${move.oldKey}`);
    if (!existingKeys.has(move.newKey)) {
      await copyAndVerify(move.oldKey, move.newKey);
    }
  }

  const frontendRoot = path.resolve(
    __dirname,
    '..',
    '..',
    'kltn-breadtrans-frontend-junior',
  );
  const marketProducts = await prisma.marketProduct.findMany({
    select: { id: true, slug: true, imageUrl: true },
  });
  const marketUploads: Array<{ id: number; slug: string; key: string }> = [];
  for (const product of marketProducts) {
    const localPath = path.join(
      frontendRoot,
      'public',
      'images',
      'market',
      `${product.slug}.svg`,
    );
    const key = `catalog/market/products/${product.slug}/image.svg`;
    await uploadAndVerify(localPath, key, 'image/svg+xml');
    marketUploads.push({ id: product.id, slug: product.slug, key });
  }

  await prisma.$transaction(async (tx) => {
    for (const move of moves.values()) {
      const url = publicObjectUrl(move.newKey);
      for (const reference of move.references) {
        if (reference.model === 'ToeicQuestionGroup') {
          await tx.toeicQuestionGroup.update({
            where: { id: reference.id },
            data:
              reference.field === 'imageUrl'
                ? { imageUrl: url }
                : { audioUrl: url },
          });
        }
        if (reference.model === 'SpeakingSubmission') {
          await tx.speakingSubmission.update({
            where: { id: reference.id },
            data: { audioKey: move.newKey, audioUrl: url },
          });
        }
      }
    }
    for (const upload of marketUploads) {
      await tx.marketProduct.update({
        where: { id: upload.id },
        data: { imageUrl: publicObjectUrl(upload.key) },
      });
    }
  });

  const report = {
    applied: true,
    bucket,
    migratedObjects: moves.size,
    marketAssetsUploaded: marketUploads.length,
    oldKeysRetained: true,
    deletedObjects: 0,
    moves: [...moves.values()],
    marketUploads,
    note: 'Old R2 keys were retained. Cleanup requires a separate explicit command.',
  };
  await writeFile(
    path.resolve(
      process.cwd(),
      '..',
      '..',
      'docs',
      'r2_catalog_migration_report.json',
    ),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(
    JSON.stringify(
      {
        migratedObjects: moves.size,
        marketAssetsUploaded: marketUploads.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
