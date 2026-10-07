import 'dotenv/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  EntitlementUnit,
  PlanFeatureKey,
  PlanVersionStatus,
  PrismaClient,
  QuizPublicationStatus,
  QuizType,
} from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DRY_RUN = process.argv.includes('--dry-run') || !APPLY;

const readingPremiumIds = [14, 15, 16];
const readingFreeIds = [2, 6, 13];
const listeningPremiumIds = [5, 10, 11, 12, 25];
const listeningFreeIds = [1, 9, 23, 24, 26, 27, 28];
const speakingPremiumIds = [
  6,
  7,
  8,
  9,
  10,
  ...Array.from({ length: 13 }, (_, i) => i + 18),
];
const speakingFreeIds = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17];
const writingPremiumIds = [4, 7, 18, 19];
const writingFreeIds = [3, 17];

const fiveEntitlements = [
  PlanFeatureKey.PREMIUM_VOCAB,
  PlanFeatureKey.PREMIUM_READING,
  PlanFeatureKey.PREMIUM_LISTENING,
  PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
  PlanFeatureKey.PREMIUM_WRITING_CONTENT,
];

type MediaMove = {
  kind: 'asset' | 'clip' | 'artifact';
  id: number;
  quizId: number;
  oldKey: string;
  newKey: string;
  mimeType: string;
};

type ManifestRow = {
  id: number;
  title: string;
  type: QuizType;
  publicationStatus: QuizPublicationStatus;
  isPremiumContent: boolean;
  courseId: number | null;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function keyFromValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;
  const url = new URL(value);
  return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || null;
}

function basename(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

function client(
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const accountId = required('R2_ACCOUNT_ID');
const publicBucket = required('R2_BUCKET_NAME');
const publicClient = client(
  process.env.R2_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`,
  required('R2_ACCESS_KEY_ID'),
  required('R2_SECRET_ACCESS_KEY'),
);
const privateBucket = required('R2_PRIVATE_BUCKET_NAME');
const privateClient = client(
  process.env.R2_PRIVATE_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`,
  process.env.R2_PRIVATE_ACCESS_KEY_ID?.trim() || required('R2_ACCESS_KEY_ID'),
  process.env.R2_PRIVATE_SECRET_ACCESS_KEY?.trim() ||
    required('R2_SECRET_ACCESS_KEY'),
);

async function head(s3: S3Client, bucket: string, key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (
      status === 404 ||
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey'
    )
      return null;
    throw error;
  }
}

async function bytes(body: unknown): Promise<Buffer> {
  const transformToByteArray = (
    body as { transformToByteArray?: () => Promise<Uint8Array> }
  ).transformToByteArray;
  if (typeof transformToByteArray === 'function')
    return Buffer.from(await transformToByteArray.call(body));
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<unknown>)
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
    );
  return Buffer.concat(chunks);
}

async function readPublic(key: string): Promise<Buffer> {
  const response = await publicClient.send(
    new GetObjectCommand({ Bucket: publicBucket, Key: key }),
  );
  if (!response.Body) throw new Error(`Empty public object: ${key}`);
  return bytes(response.Body);
}

async function privateReadable(key: string): Promise<boolean> {
  const signed = await getSignedUrl(
    privateClient,
    new GetObjectCommand({ Bucket: privateBucket, Key: key }),
    { expiresIn: 60 },
  );
  const response = await fetch(signed);
  return response.ok && Boolean(await response.arrayBuffer());
}

async function listPublicKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const page = await publicClient.send(
      new ListObjectsV2Command({
        Bucket: publicBucket,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? []) if (item.Key) keys.add(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function assertManifestIds(
  rows: ManifestRow[],
  ids: number[],
  type: QuizType,
): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new Error(`Approved row ${id} is missing`);
    if (row.type !== type)
      throw new Error(`Row ${id} has unexpected type ${row.type}`);
    if (row.publicationStatus !== QuizPublicationStatus.PUBLISHED) {
      throw new Error(`Row ${id} is not published`);
    }
  }
}

async function loadManifest(): Promise<{
  rows: ManifestRow[];
  moves: MediaMove[];
  sourceKeys: Set<string>;
}> {
  const allQuizIds = [
    ...readingPremiumIds,
    ...readingFreeIds,
    ...listeningPremiumIds,
    ...listeningFreeIds,
    ...writingPremiumIds,
    ...writingFreeIds,
  ];
  const rows = await prisma.quiz.findMany({
    where: { id: { in: allQuizIds } },
    select: {
      id: true,
      title: true,
      type: true,
      publicationStatus: true,
      isPremiumContent: true,
      courseId: true,
    },
  });
  assertManifestIds(
    rows,
    [...readingPremiumIds, ...readingFreeIds],
    QuizType.BILINGUAL_READING,
  );
  assertManifestIds(
    rows,
    [...listeningPremiumIds, ...listeningFreeIds],
    QuizType.LISTENING_PRACTICE,
  );
  assertManifestIds(rows, [4, 7, 18, 19, 17], QuizType.WRITING_EMAIL);
  assertManifestIds(rows, [3], QuizType.WRITING_PICTURE);
  const speaking = await prisma.speakingExercise.findMany({
    where: { id: { in: [...speakingPremiumIds, ...speakingFreeIds] } },
    select: { id: true, title: true, isPremiumContent: true, audioUrl: true },
  });
  if (speaking.length !== speakingPremiumIds.length + speakingFreeIds.length) {
    throw new Error('Approved Speaking manifest is incomplete');
  }
  if (speaking.some((row) => row.audioUrl)) {
    throw new Error(
      'Speaking reference audio unexpectedly exists; privacy review required',
    );
  }

  const listening = await prisma.quiz.findMany({
    where: { id: { in: listeningPremiumIds } },
    select: {
      id: true,
      questions: {
        select: {
          id: true,
          audioAssets: {
            select: { id: true, key: true, url: true, mimeType: true },
          },
          diagnosticClips: { select: { id: true, key: true, url: true } },
        },
      },
      listeningAudioArtifacts: {
        select: {
          id: true,
          version: true,
          r2Key: true,
          r2Url: true,
          outputFormat: true,
        },
      },
    },
  });
  const moves: MediaMove[] = [];
  for (const quiz of listening) {
    for (const question of quiz.questions) {
      for (const asset of question.audioAssets) {
        const oldKey = keyFromValue(asset.key) ?? keyFromValue(asset.url);
        if (!oldKey)
          throw new Error(`Listening asset ${asset.id} has no storage key`);
        moves.push({
          kind: 'asset',
          id: asset.id,
          quizId: quiz.id,
          oldKey,
          newKey: `premium/listening/quiz-${quiz.id}/question-${question.id}/${basename(oldKey)}`,
          mimeType: asset.mimeType || 'audio/mpeg',
        });
      }
      for (const clip of question.diagnosticClips) {
        const oldKey = keyFromValue(clip.key) ?? keyFromValue(clip.url);
        if (!oldKey)
          throw new Error(`Listening clip ${clip.id} has no storage key`);
        moves.push({
          kind: 'clip',
          id: clip.id,
          quizId: quiz.id,
          oldKey,
          newKey: `premium/listening/quiz-${quiz.id}/question-${question.id}/clip-${clip.id}-${basename(oldKey)}`,
          mimeType: 'audio/mpeg',
        });
      }
    }
    for (const artifact of quiz.listeningAudioArtifacts) {
      if (!artifact.r2Key) continue;
      moves.push({
        kind: 'artifact',
        id: artifact.id,
        quizId: quiz.id,
        oldKey: artifact.r2Key,
        newKey: `premium/listening/quiz-${quiz.id}/artifact-v${artifact.version}/${basename(artifact.r2Key)}`,
        mimeType: artifact.outputFormat || 'audio/mpeg',
      });
    }
  }
  return { rows, moves, sourceKeys: new Set(moves.map((move) => move.oldKey)) };
}

async function checkPlusState() {
  const plus = await prisma.plan.findUnique({
    where: { code: 'PLUS' },
    include: {
      versions: {
        include: { entitlements: true },
        orderBy: { version: 'asc' },
      },
    },
  });
  if (!plus || plus.status !== 'ACTIVE')
    throw new Error('PLUS catalog is missing or inactive');
  const current = plus.versions.filter(
    (version) =>
      version.isCurrent && version.status === PlanVersionStatus.PUBLISHED,
  );
  if (current.length !== 1)
    throw new Error('PLUS must have exactly one current published version');
  const v35 = plus.versions.find((version) => version.id === 35);
  if (
    !v35 ||
    v35.version !== 2 ||
    v35.priceVnd !== 69000 ||
    v35.durationDays !== 30 ||
    v35.currency !== 'VND'
  ) {
    throw new Error('PlanVersion 35 commercial terms changed');
  }
  const v35Keys = v35.entitlements
    .filter((item) => item.enabled)
    .map((item) => item.featureKey);
  if (v35Keys.length !== 1 || v35Keys[0] !== PlanFeatureKey.PREMIUM_VOCAB) {
    throw new Error('PlanVersion 35 entitlement contract changed');
  }
  const expanded = plus.versions.find((version) => {
    const keys = version.entitlements
      .filter((item) => item.enabled)
      .map((item) => item.featureKey)
      .sort();
    return (
      version.priceVnd === 69000 &&
      version.durationDays === 30 &&
      version.currency === 'VND' &&
      keys.join(',') === [...fiveEntitlements].sort().join(',')
    );
  });
  return { plus, current: current[0], v35, expanded };
}

async function preflight(): Promise<{
  moves: MediaMove[];
  rows: ManifestRow[];
  sourceKeys: Set<string>;
  expandedPlan: boolean;
}> {
  const manifest = await loadManifest();
  for (const row of manifest.rows) {
    const shouldBePremium =
      readingPremiumIds.includes(row.id) ||
      listeningPremiumIds.includes(row.id) ||
      writingPremiumIds.includes(row.id);
    const shouldBeFree =
      readingFreeIds.includes(row.id) ||
      listeningFreeIds.includes(row.id) ||
      writingFreeIds.includes(row.id);
    if (shouldBeFree && row.isPremiumContent)
      throw new Error(`Approved FREE quiz ${row.id} is unexpectedly premium`);
    if (!shouldBePremium && !shouldBeFree)
      throw new Error(`Quiz ${row.id} is outside approved manifest`);
  }
  const plan = await checkPlusState();
  const privateReady = [] as Array<{ move: MediaMove; ready: boolean }>;
  for (const move of manifest.moves) {
    const privateHead = await head(privateClient, privateBucket, move.newKey);
    const ready = privateHead !== null;
    if (ready && !(await privateReadable(move.newKey))) {
      throw new Error(
        `Private media is not readable with authorization: ${move.newKey}`,
      );
    }
    const source =
      (await head(publicClient, publicBucket, move.oldKey)) !== null;
    if (!ready && !source)
      throw new Error(`Missing both source and private media: ${move.oldKey}`);
    privateReady.push({ move, ready });
  }
  console.log(
    JSON.stringify(
      {
        mode: DRY_RUN ? 'dry-run' : 'apply',
        rows: manifest.rows.map((row) => ({
          id: row.id,
          title: row.title,
          type: row.type,
          premium: row.isPremiumContent,
          courseId: row.courseId,
        })),
        media: {
          total: manifest.moves.length,
          alreadyPrivate: privateReady.filter((item) => item.ready).length,
          needsCopy: privateReady.filter((item) => !item.ready).length,
        },
        plan: {
          currentId: plan.current.id,
          currentVersion: plan.current.version,
          v35Intact: true,
          expandedAlreadyExists: Boolean(plan.expanded),
        },
        planned: {
          readingPremiumIds,
          listeningPremiumIds,
          speakingPremiumIds,
          writingPremiumIds,
        },
      },
      null,
      2,
    ),
  );
  return { ...manifest, expandedPlan: Boolean(plan.expanded) };
}

async function migrateMedia(moves: MediaMove[]): Promise<void> {
  for (const move of moves) {
    if (await head(privateClient, privateBucket, move.newKey)) continue;
    const source = await readPublic(move.oldKey);
    await privateClient.send(
      new PutObjectCommand({
        Bucket: privateBucket,
        Key: move.newKey,
        Body: source,
        ContentType: move.mimeType,
      }),
    );
    const target = await head(privateClient, privateBucket, move.newKey);
    if (
      !target ||
      target.ContentLength !== source.length ||
      !(await privateReadable(move.newKey))
    ) {
      throw new Error(`Private media verification failed: ${move.newKey}`);
    }
  }
}

async function retirePublicMedia(moves: MediaMove[]): Promise<number> {
  const keys = new Set(moves.map((move) => move.oldKey));
  const all = await listPublicKeys();
  for (const key of all) {
    if (
      key.startsWith('catalog/listening/practice/audio/quiz-5/') ||
      key.startsWith('catalog/listening/practice/audio/quiz-10/') ||
      key.startsWith('catalog/listening/practice/audio/quiz-11/') ||
      key.startsWith('catalog/listening/practice/audio/quiz-12/') ||
      key.startsWith('catalog/listening/practice/audio/quiz-25/') ||
      key.startsWith('catalog/listening/practice/quiz-25/')
    )
      keys.add(key);
  }
  let retired = 0;
  for (const key of keys) {
    if (!(await head(publicClient, publicBucket, key))) continue;
    await publicClient.send(
      new DeleteObjectCommand({ Bucket: publicBucket, Key: key }),
    );
    if (await head(publicClient, publicBucket, key))
      throw new Error(`Public media still readable: ${key}`);
    retired++;
  }
  return retired;
}

async function updateMediaReferences(moves: MediaMove[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const move of moves) {
      if (move.kind === 'asset')
        await tx.quizAudioAsset.update({
          where: { id: move.id },
          data: { key: move.newKey, url: '' },
        });
      if (move.kind === 'clip')
        await tx.listeningDiagnosticClip.update({
          where: { id: move.id },
          data: { key: move.newKey, url: '' },
        });
      if (move.kind === 'artifact')
        await tx.listeningAudioArtifact.update({
          where: { id: move.id },
          data: { r2Key: move.newKey, r2Url: '' },
        });
    }
  });
}

async function applyFlagsAndPlan(): Promise<{
  planVersionId: number;
  planVersion: number;
  created: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    await tx.quiz.updateMany({
      where: { id: { in: readingPremiumIds } },
      data: { isPremiumContent: true },
    });
    await tx.quiz.updateMany({
      where: { id: { in: readingFreeIds } },
      data: { isPremiumContent: false },
    });
    await tx.quiz.updateMany({
      where: { id: { in: listeningPremiumIds } },
      data: { isPremiumContent: true },
    });
    await tx.quiz.updateMany({
      where: { id: { in: listeningFreeIds } },
      data: { isPremiumContent: false },
    });
    await tx.quiz.updateMany({
      where: { id: { in: writingPremiumIds } },
      data: { isPremiumContent: true },
    });
    await tx.quiz.updateMany({
      where: { id: { in: writingFreeIds } },
      data: { isPremiumContent: false },
    });
    await tx.speakingExercise.updateMany({
      where: { id: { in: speakingPremiumIds } },
      data: { isPremiumContent: true },
    });
    await tx.speakingExercise.updateMany({
      where: { id: { in: speakingFreeIds } },
      data: { isPremiumContent: false },
    });

    const plus = await tx.plan.findUnique({
      where: { code: 'PLUS' },
      include: { versions: { include: { entitlements: true } } },
    });
    if (!plus) throw new Error('PLUS catalog is missing');
    const existing = plus.versions.find((version) => {
      const keys = version.entitlements
        .filter((item) => item.enabled)
        .map((item) => item.featureKey)
        .sort();
      return (
        version.priceVnd === 69000 &&
        version.durationDays === 30 &&
        version.currency === 'VND' &&
        keys.join(',') === [...fiveEntitlements].sort().join(',')
      );
    });
    if (existing?.status === PlanVersionStatus.PUBLISHED && existing.isCurrent)
      return {
        planVersionId: existing.id,
        planVersion: existing.version,
        created: false,
      };
    const draft =
      existing ??
      (await tx.planVersion.create({
        data: {
          planId: plus.id,
          version:
            Math.max(0, ...plus.versions.map((version) => version.version)) + 1,
          displayName: 'BreadTrans Plus',
          description: 'Truy cập toàn bộ nội dung Premium trong 30 ngày.',
          durationDays: 30,
          priceVnd: 69000,
          currency: 'VND',
          status: PlanVersionStatus.DRAFT,
          isCurrent: false,
          entitlements: {
            create: fiveEntitlements.map((featureKey) => ({
              featureKey,
              enabled: true,
              unit: EntitlementUnit.CONTENT_ACCESS,
            })),
          },
        },
      }));
    const loaded = await tx.planVersion.findUnique({
      where: { id: draft.id },
      include: { entitlements: true },
    });
    if (
      !loaded ||
      loaded.entitlements.length !== fiveEntitlements.length ||
      loaded.entitlements.some(
        (item) => item.unit !== EntitlementUnit.CONTENT_ACCESS || !item.enabled,
      )
    )
      throw new Error('New PLUS entitlement set is invalid');
    await tx.planVersion.updateMany({
      where: { planId: plus.id, isCurrent: true, id: { not: loaded.id } },
      data: { isCurrent: false, status: PlanVersionStatus.RETIRED },
    });
    const published = await tx.planVersion.update({
      where: { id: loaded.id },
      data: {
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        effectiveFrom: new Date(),
        publishedAt: new Date(),
      },
    });
    return {
      planVersionId: published.id,
      planVersion: published.version,
      created: !existing,
    };
  });
}

async function verifyPostState(planVersionId: number): Promise<void> {
  const read = await prisma.quiz.findMany({
    where: { id: { in: [...readingPremiumIds, ...readingFreeIds] } },
    select: { id: true, isPremiumContent: true },
  });
  const listen = await prisma.quiz.findMany({
    where: { id: { in: [...listeningPremiumIds, ...listeningFreeIds] } },
    select: { id: true, isPremiumContent: true },
  });
  const write = await prisma.quiz.findMany({
    where: { id: { in: [...writingPremiumIds, ...writingFreeIds] } },
    select: { id: true, isPremiumContent: true },
  });
  const speak = await prisma.speakingExercise.findMany({
    where: { id: { in: [...speakingPremiumIds, ...speakingFreeIds] } },
    select: { id: true, isPremiumContent: true },
  });
  const assertFlags = (
    rows: Array<{ id: number; isPremiumContent: boolean }>,
    premium: number[],
  ) => {
    const expected = new Map(
      [...rows].map((row) => [row.id, premium.includes(row.id)]),
    );
    if ([...expected].some(([id, value]) => value !== premium.includes(id)))
      throw new Error('Premium flag post-state mismatch');
  };
  assertFlags(read, readingPremiumIds);
  assertFlags(listen, listeningPremiumIds);
  assertFlags(write, writingPremiumIds);
  assertFlags(speak, speakingPremiumIds);
  const version = await prisma.planVersion.findUnique({
    where: { id: planVersionId },
    include: { plan: true, entitlements: true },
  });
  if (
    !version ||
    version.plan.code !== 'PLUS' ||
    version.status !== PlanVersionStatus.PUBLISHED ||
    !version.isCurrent ||
    version.priceVnd !== 69000 ||
    version.durationDays !== 30 ||
    version.entitlements.length !== fiveEntitlements.length
  )
    throw new Error('Published PLUS post-state mismatch');
}

async function main(): Promise<void> {
  if (!DRY_RUN && !APPLY) throw new Error('Use --dry-run or --apply');
  const plan = await preflight();
  if (DRY_RUN) return;
  await migrateMedia(plan.moves);
  await updateMediaReferences(plan.moves);
  const retired = await retirePublicMedia(plan.moves);
  const published = await applyFlagsAndPlan();
  await verifyPostState(published.planVersionId);
  console.log(
    JSON.stringify(
      {
        applied: true,
        privateObjects: plan.moves.length,
        publicObjectsRetired: retired,
        ...published,
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
