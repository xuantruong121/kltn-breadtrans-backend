import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  _Object,
} from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();
const bucket = process.env.R2_BUCKET_NAME ?? 'breadtrans-files';
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error('R2 credentials are incomplete; cleanup stopped safely.');
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function keyFromValue(value: string | null | undefined): string | null {
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

function fileName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

async function listObjects(): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    objects.push(...(response.Contents ?? []));
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

async function referencedKeys(): Promise<Set<string>> {
  const [courses, lessons, materials, submissions, products, topics, groups] =
    await Promise.all([
      prisma.course.findMany({ select: { thumbnail: true } }),
      prisma.lesson.findMany({ select: { videoUrl: true } }),
      prisma.material.findMany({ select: { fileUrl: true } }),
      prisma.speakingSubmission.findMany({
        select: { audioKey: true, audioUrl: true },
      }),
      prisma.marketProduct.findMany({ select: { imageUrl: true } }),
      prisma.vocabTopic.findMany({ select: { iconUrl: true } }),
      prisma.toeicQuestionGroup.findMany({
        select: { imageUrl: true, audioUrl: true },
      }),
    ]);

  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = keyFromValue(value);
    if (key) keys.add(key);
  };

  for (const row of courses) add(row.thumbnail);
  for (const row of lessons) add(row.videoUrl);
  for (const row of materials) add(row.fileUrl);
  for (const row of submissions) {
    add(row.audioKey);
    add(row.audioUrl);
  }
  for (const row of products) add(row.imageUrl);
  for (const row of topics) add(row.iconUrl);
  for (const row of groups) {
    add(row.imageUrl);
    add(row.audioUrl);
  }
  return keys;
}

function replacementFor(key: string, allKeys: Set<string>): string | null {
  const name = fileName(key);
  if (key.startsWith('speaking_audio/')) {
    const canonical = [...allKeys].find(
      (candidate) =>
        candidate.startsWith('catalog/speaking/submissions/') &&
        candidate.endsWith(`/${name}`),
    );
    return canonical ?? `unclassified/speaking/${name}`;
  }
  if (key.startsWith('toeic/visuals/')) {
    const canonical = `catalog/toeic/shared/images/${name}`;
    return allKeys.has(canonical) ? canonical : `unclassified/toeic/${name}`;
  }
  if (key.startsWith('unclassified/speaking/')) {
    return (
      [...allKeys].find(
        (candidate) =>
          candidate.startsWith('catalog/speaking/submissions/') &&
          candidate.endsWith(`/${name}`),
      ) ?? null
    );
  }
  if (key.startsWith('unclassified/toeic/')) {
    const canonical = `catalog/toeic/shared/images/${name}`;
    return allKeys.has(canonical) ? canonical : null;
  }
  return null;
}

async function main(): Promise<void> {
  const objects = await listObjects();
  const allKeys = new Set(
    objects.flatMap((object) => (object.Key ? [object.Key] : [])),
  );
  const refs = await referencedKeys();
  const candidates = objects
    .filter((object): object is _Object & { Key: string } => {
      if (!object.Key) return false;
      return (
        object.Key.startsWith('speaking_audio/') ||
        object.Key.startsWith('toeic/visuals/') ||
        object.Key.startsWith('unclassified/speaking/') ||
        object.Key.startsWith('unclassified/toeic/')
      );
    })
    .map((object) => ({
      key: object.Key,
      replacement: replacementFor(object.Key, allKeys),
      referenced: refs.has(object.Key),
    }))
    .filter((candidate) => !candidate.referenced && candidate.replacement);

  const unsafe = candidates.filter(
    (candidate) => !allKeys.has(candidate.replacement as string),
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Cleanup safety check failed: ${unsafe.map((candidate) => candidate.key).join(', ')}`,
    );
  }

  const apply = process.env.R2_CATALOG_CLEANUP_APPLY === '1';
  const report = {
    applied: apply,
    bucket,
    deletedCandidates: candidates.length,
    deletedObjects: 0,
    retainedReferenced: [...refs].filter(
      (key) =>
        key.startsWith('speaking_audio/') ||
        key.startsWith('toeic/visuals/') ||
        key.startsWith('unclassified/'),
    ),
    candidates,
    note: apply
      ? 'Only unreferenced legacy keys with an existing replacement were deleted.'
      : 'Dry run only. Set R2_CATALOG_CLEANUP_APPLY=1 to delete these exact keys.',
  };

  if (apply && candidates.length > 0) {
    for (let index = 0; index < candidates.length; index += 1000) {
      const batch = candidates.slice(index, index + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((candidate) => ({ Key: candidate.key })),
          },
        }),
      );
    }
    report.deletedObjects = candidates.length;
  }

  const outputPath = path.resolve(
    process.cwd(),
    '..',
    '..',
    'docs',
    'r2_catalog_cleanup_report.json',
  );
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        applied: report.applied,
        candidates: report.deletedCandidates,
        deletedObjects: report.deletedObjects,
        outputPath,
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
