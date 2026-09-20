import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ListObjectsV2Command, S3Client, _Object } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

type MediaReference = {
  model: string;
  id: number;
  field: string;
  key: string;
  currentUrl: string | null;
  ownerId?: number;
  proposedKey: string;
};

type ManifestObject = {
  key: string;
  size: number;
  lastModified: string | null;
  status: 'REFERENCED' | 'LEGACY_RETAINED' | 'UNREFERENCED';
  references: MediaReference[];
  proposedKey: string;
};

const prisma = new PrismaClient();

function r2Key(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    return /^(speaking_audio|toeic|uploads|catalog|private)\//.test(value)
      ? value
      : null;
  }

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

function proposedKeyFor(key: string, reference?: MediaReference): string {
  const file = basename(key);
  if (key.startsWith('catalog/')) return key;
  if (reference?.model === 'SpeakingSubmission') {
    return `private/speaking/submissions/${reference.ownerId ?? 'unknown'}/${reference.id}/${file}`;
  }
  if (reference?.model === 'MarketProduct') {
    return `catalog/market/products/${reference.id}/image.svg`;
  }
  if (reference?.model === 'ToeicQuestionGroup') {
    return `catalog/toeic/shared/${reference.field === 'imageUrl' ? 'images' : 'audio'}/${file}`;
  }
  if (key.startsWith('toeic/')) return `unclassified/toeic/${file}`;
  if (key.startsWith('speaking_audio/')) return `unclassified/speaking/${file}`;
  return `unclassified/${key}`;
}

function legacyCanonicalKey(key: string, keys: Set<string>): string | null {
  const file = basename(key);
  if (key.startsWith('toeic/visuals/')) {
    const canonical = `catalog/toeic/shared/images/${file}`;
    return keys.has(canonical) ? canonical : null;
  }
  if (
    key.startsWith('speaking_audio/') ||
    key.startsWith('unclassified/speaking/')
  ) {
    const canonical = [...keys].find(
      (candidate) =>
        candidate.startsWith('catalog/speaking/submissions/') &&
        candidate.endsWith(`/${file}`),
    );
    return canonical ?? null;
  }
  if (key.startsWith('unclassified/toeic/')) {
    const canonical = `catalog/toeic/shared/images/${file}`;
    return keys.has(canonical) ? canonical : null;
  }
  return null;
}

async function listObjects(
  client: S3Client,
  bucket: string,
): Promise<_Object[]> {
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

async function main(): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME ?? 'breadtrans-files';
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are incomplete; dry-run stopped safely.');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const [
    objects,
    courses,
    lessons,
    materials,
    submissions,
    products,
    topics,
    groups,
  ] = await Promise.all([
    listObjects(client, bucket),
    prisma.course.findMany({ select: { id: true, thumbnail: true } }),
    prisma.lesson.findMany({ select: { id: true, videoUrl: true } }),
    prisma.material.findMany({ select: { id: true, fileUrl: true } }),
    prisma.speakingSubmission.findMany({
      select: { id: true, userId: true, audioUrl: true, audioKey: true },
    }),
    prisma.marketProduct.findMany({ select: { id: true, imageUrl: true } }),
    prisma.vocabTopic.findMany({ select: { id: true, iconUrl: true } }),
    prisma.toeicQuestionGroup.findMany({
      select: { id: true, imageUrl: true, audioUrl: true },
    }),
  ]);

  const references = new Map<string, MediaReference[]>();
  const addReference = (
    model: string,
    id: number,
    field: string,
    value: string | null | undefined,
    ownerId?: number,
  ) => {
    const key = r2Key(value);
    if (!key) return;
    const ref: MediaReference = {
      model,
      id,
      field,
      key,
      currentUrl: value ?? null,
      ownerId,
      proposedKey: proposedKeyFor(key, {
        model,
        id,
        field,
        key,
        currentUrl: value ?? null,
        ownerId,
        proposedKey: '',
      }),
    };
    references.set(key, [...(references.get(key) ?? []), ref]);
  };

  for (const row of courses)
    addReference('Course', row.id, 'thumbnail', row.thumbnail);
  for (const row of lessons)
    addReference('Lesson', row.id, 'videoUrl', row.videoUrl);
  for (const row of materials)
    addReference('Material', row.id, 'fileUrl', row.fileUrl);
  for (const row of submissions) {
    addReference(
      'SpeakingSubmission',
      row.id,
      'audioKey',
      row.audioKey,
      row.userId,
    );
    addReference(
      'SpeakingSubmission',
      row.id,
      'audioUrl',
      row.audioUrl,
      row.userId,
    );
  }
  for (const row of products)
    addReference('MarketProduct', row.id, 'imageUrl', row.imageUrl);
  for (const row of topics)
    addReference('VocabTopic', row.id, 'iconUrl', row.iconUrl);
  for (const row of groups) {
    addReference('ToeicQuestionGroup', row.id, 'imageUrl', row.imageUrl);
    addReference('ToeicQuestionGroup', row.id, 'audioUrl', row.audioUrl);
  }

  const manifest: ManifestObject[] = objects
    .filter((object): object is _Object & { Key: string } =>
      Boolean(object.Key),
    )
    .map((object) => {
      const refs = references.get(object.Key) ?? [];
      const legacyKey = legacyCanonicalKey(
        object.Key,
        new Set(objects.flatMap((item) => (item.Key ? [item.Key] : []))),
      );
      return {
        key: object.Key,
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
        status:
          refs.length > 0
            ? 'REFERENCED'
            : legacyKey
              ? 'LEGACY_RETAINED'
              : 'UNREFERENCED',
        references: refs,
        proposedKey: legacyKey ?? proposedKeyFor(object.Key, refs[0]),
      };
    });

  const missingReferences = [...references.entries()]
    .filter(([key]) => !manifest.some((object) => object.key === key))
    .flatMap(([, refs]) => refs);

  const generatedAt = new Date().toISOString();
  const report = {
    dryRun: true,
    generatedAt,
    bucket,
    note: 'No R2 copy, delete, rename, or database update was executed.',
    totals: {
      objects: manifest.length,
      bytes: manifest.reduce((sum, object) => sum + object.size, 0),
      referenced: manifest.filter((object) => object.status === 'REFERENCED')
        .length,
      legacyRetained: manifest.filter(
        (object) => object.status === 'LEGACY_RETAINED',
      ).length,
      unreferenced: manifest.filter(
        (object) => object.status === 'UNREFERENCED',
      ).length,
      missingDatabaseReferences: missingReferences.length,
    },
    objects: manifest,
    missingDatabaseReferences: missingReferences,
  };

  const outputDir = join(process.cwd(), '..', '..', 'docs');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'r2_catalog_dry_run_manifest.json');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, totals: report.totals }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
