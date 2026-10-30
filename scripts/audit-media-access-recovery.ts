/**
 * Read-only reconciliation input for the R2 content/media recovery pass.
 *
 * It deliberately does not infer business access from R2 paths and never
 * updates database rows or storage. The resulting manifest is the review
 * input for a subsequent, explicit recovery action.
 */
import 'dotenv/config';
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, QuizPublicationStatus } from '@prisma/client';

type InventoryObject = {
  key: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  contentType: string | null;
  metadata: Record<string, string>;
  publicReachability: string;
  bucket: 'PUBLIC' | 'PRIVATE';
};

type MediaRecord = {
  domain: string;
  model: string;
  canonicalId: string;
  canonicalKey: string;
  title: string;
  publicationStatus: string;
  learnerVisibility: 'LEARNER' | 'INTERNAL' | 'LEGACY_OR_DRAFT';
  requiredAccessTier: string;
  mediaField: string;
  mediaType: 'image' | 'audio' | 'file' | 'unknown';
  required: boolean;
  currentDbMediaReference: string | null;
  expectedR2Key: string | null;
  actualR2Key: string | null;
  objectExists: boolean | null;
  size: number | null;
  contentType: string | null;
  storageScope: 'PUBLIC' | 'PRIVATE' | null;
  mappingEvidence: string;
  mappingConfidence: 'PROVEN' | 'HIGH_CONFIDENCE' | 'AMBIGUOUS' | 'NO_MATCH';
  semanticMatch: 'NOT_EVALUATED' | 'SOURCE_PROVEN' | 'REVIEW_REQUIRED';
  technicalValidity: 'VALID' | 'MISSING' | 'EXTERNAL_OR_LOCAL' | 'NOT_APPLICABLE';
  recoveryAction: 'NONE' | 'RELINK_CANDIDATE' | 'MANUAL_REVIEW' | 'SOURCE_OR_GENERATE';
  finalStatus:
    | 'MAPPED_ACTIVE'
    | 'MAPPED_INTERNAL'
    | 'MAPPED_LEGACY'
    | 'RECOVERY_CANDIDATE'
    | 'UNREFERENCED_BUT_PRESERVE'
    | 'AMBIGUOUS'
    | 'UNRELATED_APPLICATION_UPLOAD';
};

const prisma = new PrismaClient();
const artifactDir = join(__dirname, '..', 'artifacts');
const inventoryPath = join(artifactDir, 'r2-full-inventory.json');
const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '') ?? '';
const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2Endpoint =
  process.env.R2_PRIVATE_ENDPOINT?.trim() ||
  process.env.R2_ENDPOINT?.trim() ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : undefined);
const r2AccessKeyId =
  process.env.R2_PRIVATE_ACCESS_KEY_ID?.trim() || process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey =
  process.env.R2_PRIVATE_SECRET_ACCESS_KEY?.trim() || process.env.R2_SECRET_ACCESS_KEY;
const privateBucket = process.env.R2_PRIVATE_BUCKET_NAME;

const privateClient =
  r2Endpoint && r2AccessKeyId && r2SecretAccessKey && privateBucket
    ? new S3Client({
        endpoint: r2Endpoint,
        region: 'auto',
        credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
      })
    : null;

function mediaType(value: string, field: string): MediaRecord['mediaType'] {
  const lower = `${value} ${field}`.toLowerCase();
  if (/\.(mp3|wav|m4a|ogg)(\?|$)|audio/.test(lower)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)|image|cover|thumbnail|avatar/.test(lower)) return 'image';
  if (/file|attachment|\.pdf(\?|$)/.test(lower)) return 'file';
  return 'unknown';
}

function extractR2Key(value: string | null | undefined): string | null {
  if (!value) return null;
  if (publicBase && value.startsWith(`${publicBase}/`)) {
    return decodeURIComponent(value.slice(publicBase.length + 1).split('?')[0]);
  }
  // Deterministic R2 keys are stored directly for private media and uploads.
  if (!/^(https?:|\/)/i.test(value) && value.includes('/')) return value;
  return null;
}

function urlsInJson(value: unknown, path = '$'): Array<{ path: string; url: string }> {
  if (typeof value === 'string') {
    return /^(https?:\/\/|\/|[\w.-]+\/)/.test(value) ? [{ path, url: value }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => urlsInJson(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    /(?:image|audio|media|asset|file|url|attachment|cover|thumbnail)/i.test(key)
      ? urlsInJson(item, `${path}.${key}`)
      : [],
  );
}

function statusFor(
  visibility: MediaRecord['learnerVisibility'],
  required: boolean,
  reference: string | null,
  object: InventoryObject | undefined,
): Pick<MediaRecord, 'mappingConfidence' | 'technicalValidity' | 'recoveryAction' | 'finalStatus'> {
  if (!reference) {
    return {
      mappingConfidence: required ? 'NO_MATCH' : 'PROVEN',
      technicalValidity: required ? 'MISSING' : 'NOT_APPLICABLE',
      recoveryAction: required ? 'SOURCE_OR_GENERATE' : 'NONE',
      finalStatus: required ? 'RECOVERY_CANDIDATE' : visibility === 'INTERNAL' ? 'MAPPED_INTERNAL' : visibility === 'LEARNER' ? 'MAPPED_ACTIVE' : 'MAPPED_LEGACY',
    };
  }
  if (!extractR2Key(reference)) {
    return {
      mappingConfidence: 'HIGH_CONFIDENCE',
      technicalValidity: 'EXTERNAL_OR_LOCAL',
      recoveryAction: 'MANUAL_REVIEW',
      finalStatus: visibility === 'INTERNAL' ? 'MAPPED_INTERNAL' : visibility === 'LEARNER' ? 'MAPPED_ACTIVE' : 'MAPPED_LEGACY',
    };
  }
  if (!object || object.size <= 0) {
    return {
      mappingConfidence: 'NO_MATCH',
      technicalValidity: 'MISSING',
      recoveryAction: 'SOURCE_OR_GENERATE',
      finalStatus: 'RECOVERY_CANDIDATE',
    };
  }
  return {
    mappingConfidence: 'PROVEN',
    technicalValidity: 'VALID',
    recoveryAction: 'NONE',
    finalStatus: visibility === 'INTERNAL' ? 'MAPPED_INTERNAL' : visibility === 'LEARNER' ? 'MAPPED_ACTIVE' : 'MAPPED_LEGACY',
  };
}

function addRecord(
  records: MediaRecord[],
  objects: Map<string, InventoryObject>,
  input: Omit<MediaRecord, 'expectedR2Key' | 'actualR2Key' | 'objectExists' | 'size' | 'contentType' | 'storageScope' | 'mappingConfidence' | 'technicalValidity' | 'recoveryAction' | 'finalStatus' | 'semanticMatch'>,
) {
  const expectedR2Key = extractR2Key(input.currentDbMediaReference);
  const object = expectedR2Key ? objects.get(expectedR2Key) : undefined;
  const derived = statusFor(input.learnerVisibility, input.required, input.currentDbMediaReference, object);
  records.push({
    ...input,
    expectedR2Key,
    actualR2Key: object?.key ?? null,
    objectExists: expectedR2Key ? Boolean(object && object.size > 0) : null,
    size: object?.size ?? null,
    contentType: object?.contentType ?? null,
    storageScope: object?.bucket ?? null,
    semanticMatch: input.mappingEvidence.includes('canonical') || input.mappingEvidence.includes('deterministic') ? 'SOURCE_PROVEN' : 'NOT_EVALUATED',
    ...derived,
  });
}

async function listPrivateObjects(): Promise<InventoryObject[]> {
  if (!privateClient || !privateBucket) return [];
  const listed: Array<{ key: string; size: number; lastModified: string | null; etag: string | null }> = [];
  let continuationToken: string | undefined;
  do {
    const page = await privateClient.send(
      new ListObjectsV2Command({ Bucket: privateBucket, ContinuationToken: continuationToken }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key)
        listed.push({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified?.toISOString() ?? null,
          etag: item.ETag ?? null,
        });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return Promise.all(
    listed.map(async (item) => {
      const head = await privateClient.send(
        new HeadObjectCommand({ Bucket: privateBucket, Key: item.key }),
      );
      return {
        ...item,
        contentType: head.ContentType ?? null,
        metadata: head.Metadata ?? {},
        publicReachability: 'PRIVATE_AUTHENTICATED',
        bucket: 'PRIVATE' as const,
      };
    }),
  );
}

async function main() {
  if (!existsSync(inventoryPath)) throw new Error('Run scripts/r2-inventory.ts before this audit.');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as { objects: Omit<InventoryObject, 'bucket'>[] };
  const publicInventory = inventory.objects.map((object) => ({ ...object, bucket: 'PUBLIC' as const }));
  const privateInventory = await listPrivateObjects();
  // Backward-compatible combined lookup for the many domain scanners below.
  // A private object wins when a key exists in both buckets after a safe copy.
  const objectByKey = new Map<string, InventoryObject>(
    [...publicInventory, ...privateInventory].map(
      (object): [string, InventoryObject] => [object.key, object],
    ),
  );
  const records: MediaRecord[] = [];

  const [courses, courseLessons, courseMedia, materials, quizzes, audioAssets, audioArtifacts, speakingExercises, speakingStimuli, marketProducts, vocabTopics, vocabWords, toeicGroups, diagnosticClips, diagnosticResponses, submissions, attachments] = await Promise.all([
    prisma.course.findMany({ select: { id: true, title: true, thumbnail: true, level: true, status: true } }),
    prisma.courseLesson.findMany({ select: { id: true, courseId: true, slug: true, title: true, coverImage: true, status: true } }),
    prisma.courseLessonMedia.findMany({ select: { id: true, lessonId: true, type: true, url: true, renderStatus: true } }),
    prisma.material.findMany({ select: { id: true, lessonId: true, title: true, fileUrl: true, fileType: true } }),
    prisma.quiz.findMany({ select: { id: true, title: true, type: true, isPremiumContent: true, publicationStatus: true, questions: { select: { id: true, content: true, order: true } } } }),
    prisma.quizAudioAsset.findMany({ select: { id: true, questionId: true, key: true, url: true, mimeType: true, isActive: true } }),
    prisma.listeningAudioArtifact.findMany({ select: { id: true, quizId: true, r2Key: true, r2Url: true, status: true } }),
    prisma.speakingExercise.findMany({ select: { id: true, title: true, imageUrl: true, audioUrl: true, taskType: true, practiceSetId: true, isPremiumContent: true, publicationStatus: true } }),
    prisma.speakingStimulus.findMany({ select: { id: true, title: true, imageUrl: true, kind: true } }),
    prisma.marketProduct.findMany({ select: { id: true, slug: true, name: true, imageUrl: true, isActive: true } }),
    prisma.vocabTopic.findMany({ select: { id: true, title: true, iconUrl: true, isPro: true, publicationStatus: true } }),
    prisma.dictionaryEntry.findMany({ select: { id: true, displayWord: true, audioUs: true, audioUk: true } }),
    prisma.toeicQuestionGroup.findMany({ select: { id: true, examId: true, part: true, groupOrder: true, audioUrl: true, imageUrl: true, mediaMetadata: true, exam: { select: { genericExam: { select: { publicationStatus: true } } } } } }),
    prisma.listeningDiagnosticClip.findMany({ select: { id: true, questionId: true, label: true, key: true, url: true } }),
    prisma.diagnosticSpeakingResponse.findMany({ select: { id: true, taskKey: true, audioKey: true, status: true } }),
    prisma.speakingSubmission.findMany({ select: { id: true, exerciseId: true, audioKey: true, audioUrl: true, status: true } }),
    prisma.suggestionAttachment.findMany({ select: { id: true, suggestionId: true, name: true, type: true, url: true } }),
  ]);

  for (const course of courses) addRecord(records, objectByKey, {
    domain: 'Course', model: 'Course', canonicalId: String(course.id), canonicalKey: `course-${course.id}`, title: course.title,
    publicationStatus: String(course.status), learnerVisibility: course.status === 'PUBLISHED' ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: 'PREMIUM_COURSE_ACCESS',
    mediaField: 'thumbnail', mediaType: 'image', required: false, currentDbMediaReference: course.thumbnail, mappingEvidence: 'Course.thumbnail current DB reference',
  });
  for (const lesson of courseLessons) addRecord(records, objectByKey, {
    domain: 'Course', model: 'CourseLesson', canonicalId: String(lesson.id), canonicalKey: `course-${lesson.courseId}/${lesson.slug}`, title: lesson.title,
    publicationStatus: String(lesson.status), learnerVisibility: lesson.status === 'PUBLISHED' ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: 'PREMIUM_COURSE_ACCESS',
    mediaField: 'coverImage', mediaType: 'image', required: false, currentDbMediaReference: lesson.coverImage, mappingEvidence: 'CourseLesson.coverImage current DB reference',
  });
  for (const item of courseMedia) addRecord(records, objectByKey, {
    domain: 'Course', model: 'CourseLessonMedia', canonicalId: String(item.id), canonicalKey: `lesson-${item.lessonId}/media-${item.id}`, title: item.type,
    publicationStatus: item.renderStatus, learnerVisibility: item.renderStatus === 'READY' ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: 'PREMIUM_COURSE_ACCESS',
    mediaField: 'url', mediaType: mediaType(item.url, item.type), required: true, currentDbMediaReference: item.url, mappingEvidence: 'CourseLessonMedia explicit DB relationship',
  });
  for (const item of materials) addRecord(records, objectByKey, {
    domain: 'Course', model: 'Material', canonicalId: String(item.id), canonicalKey: `lesson-${item.lessonId}/material-${item.id}`, title: item.title,
    publicationStatus: 'LEGACY', learnerVisibility: 'LEGACY_OR_DRAFT', requiredAccessTier: 'PREMIUM_COURSE_ACCESS',
    mediaField: 'fileUrl', mediaType: mediaType(item.fileUrl, item.fileType ?? 'file'), required: true, currentDbMediaReference: item.fileUrl, mappingEvidence: 'Material explicit DB relationship',
  });
  const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  for (const asset of audioAssets) {
    const quiz = quizzes.find((candidate) => candidate.questions.some((question) => question.id === asset.questionId));
    addRecord(records, objectByKey, {
      domain: 'Listening', model: 'QuizAudioAsset', canonicalId: String(asset.id), canonicalKey: `question-${asset.questionId}/v${asset.id}`, title: quiz?.title ?? `Question ${asset.questionId}`,
      publicationStatus: asset.isActive ? 'ACTIVE' : 'INACTIVE', learnerVisibility: asset.isActive && quiz?.publicationStatus === QuizPublicationStatus.PUBLISHED ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: quiz?.isPremiumContent ? 'PREMIUM_LISTENING' : 'FREE',
      mediaField: 'url', mediaType: 'audio', required: asset.isActive, currentDbMediaReference: asset.url || asset.key, mappingEvidence: 'QuizAudioAsset exact question relationship and R2 key',
    });
  }
  for (const artifact of audioArtifacts) addRecord(records, objectByKey, {
    domain: 'Listening', model: 'ListeningAudioArtifact', canonicalId: String(artifact.id), canonicalKey: `quiz-${artifact.quizId}/artifact-${artifact.id}`, title: `Quiz ${artifact.quizId}`,
    publicationStatus: String(artifact.status), learnerVisibility: artifact.status === 'PUBLISHED' ? 'LEARNER' : 'INTERNAL', requiredAccessTier: quizById.get(artifact.quizId)?.isPremiumContent ? 'PREMIUM_LISTENING' : 'FREE',
    mediaField: 'r2Url', mediaType: 'audio', required: artifact.status === 'PUBLISHED', currentDbMediaReference: artifact.r2Url || artifact.r2Key, mappingEvidence: 'Listening artifact immutable R2 provenance',
  });
  for (const exercise of speakingExercises) {
    const visibility: MediaRecord['learnerVisibility'] = exercise.practiceSetId ? 'INTERNAL' : exercise.publicationStatus === QuizPublicationStatus.PUBLISHED ? 'LEARNER' : 'LEGACY_OR_DRAFT';
    const imageRequired = exercise.taskType === 'DESCRIBE_PICTURE';
    addRecord(records, objectByKey, {
      domain: 'Speaking', model: 'SpeakingExercise', canonicalId: String(exercise.id), canonicalKey: `speaking-${exercise.id}`, title: exercise.title,
      publicationStatus: String(exercise.publicationStatus), learnerVisibility: visibility, requiredAccessTier: exercise.isPremiumContent ? 'PREMIUM_SPEAKING_CONTENT' : 'FREE',
      mediaField: 'imageUrl', mediaType: 'image', required: imageRequired, currentDbMediaReference: exercise.imageUrl, mappingEvidence: imageRequired ? 'DESCRIBE_PICTURE requires exact image' : 'Speaking image optional by task type',
    });
    addRecord(records, objectByKey, {
      domain: 'Speaking', model: 'SpeakingExercise', canonicalId: String(exercise.id), canonicalKey: `speaking-${exercise.id}`, title: exercise.title,
      publicationStatus: String(exercise.publicationStatus), learnerVisibility: visibility, requiredAccessTier: exercise.isPremiumContent ? 'PREMIUM_SPEAKING_CONTENT' : 'FREE',
      mediaField: 'audioUrl', mediaType: 'audio', required: false, currentDbMediaReference: exercise.audioUrl, mappingEvidence: 'Speaking reference audio is task-dependent optional media',
    });
  }
  for (const stimulus of speakingStimuli) addRecord(records, objectByKey, {
    domain: 'Speaking', model: 'SpeakingStimulus', canonicalId: String(stimulus.id), canonicalKey: `stimulus-${stimulus.id}`, title: stimulus.title ?? `Stimulus ${stimulus.id}`,
    publicationStatus: 'REFERENCED_BY_EXERCISE', learnerVisibility: 'INTERNAL', requiredAccessTier: 'CONTEXTUAL', mediaField: 'imageUrl', mediaType: 'image', required: stimulus.kind === 'IMAGE', currentDbMediaReference: stimulus.imageUrl, mappingEvidence: 'Speaking stimulus relationship',
  });
  for (const product of marketProducts) addRecord(records, objectByKey, {
    domain: 'Market', model: 'MarketProduct', canonicalId: String(product.id), canonicalKey: product.slug, title: product.name,
    publicationStatus: product.isActive ? 'ACTIVE' : 'INACTIVE', learnerVisibility: product.isActive ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: 'FREE', mediaField: 'imageUrl', mediaType: 'image', required: false, currentDbMediaReference: product.imageUrl, mappingEvidence: 'Market product catalog DB reference',
  });
  for (const topic of vocabTopics) addRecord(records, objectByKey, {
    domain: 'Flashcard', model: 'VocabTopic', canonicalId: String(topic.id), canonicalKey: `topic-${topic.id}`, title: topic.title,
    publicationStatus: String(topic.publicationStatus), learnerVisibility: topic.publicationStatus === QuizPublicationStatus.PUBLISHED ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: topic.isPro ? 'PREMIUM_VOCAB' : 'FREE', mediaField: 'iconUrl', mediaType: 'image', required: false, currentDbMediaReference: topic.iconUrl, mappingEvidence: 'Vocab topic icon optional',
  });
  for (const word of vocabWords) for (const [field, reference] of [['audioUs', word.audioUs], ['audioUk', word.audioUk]] as const) addRecord(records, objectByKey, {
    domain: 'Flashcard', model: 'DictionaryEntry', canonicalId: String(word.id), canonicalKey: `entry-${word.id}`, title: word.displayWord,
    publicationStatus: 'TOPIC_GOVERNED', learnerVisibility: 'LEARNER', requiredAccessTier: 'TOPIC_GOVERNED', mediaField: field, mediaType: 'audio', required: false, currentDbMediaReference: reference, mappingEvidence: 'Dictionary entry pronunciation audio current DB reference',
  });
  for (const group of toeicGroups) {
    const examPublication = group.exam.genericExam?.publicationStatus ?? 'DRAFT';
    const visibility: MediaRecord['learnerVisibility'] = examPublication === QuizPublicationStatus.PUBLISHED ? 'LEARNER' : 'LEGACY_OR_DRAFT';
    for (const [field, reference, required] of [['audioUrl', group.audioUrl, group.part <= 4], ['imageUrl', group.imageUrl, group.part === 1]] as const) addRecord(records, objectByKey, {
    domain: 'TOEIC', model: 'ToeicQuestionGroup', canonicalId: String(group.id), canonicalKey: `exam-${group.examId}/part-${group.part}/group-${group.groupOrder}`, title: `TOEIC Part ${group.part}`,
    publicationStatus: String(examPublication), learnerVisibility: visibility, requiredAccessTier: 'TOEIC_PRODUCT_ACCESS', mediaField: field, mediaType: field === 'audioUrl' ? 'audio' : 'image', required, currentDbMediaReference: reference, mappingEvidence: 'canonical TOEIC group media contract',
  });
  }
  for (const clip of diagnosticClips) addRecord(records, objectByKey, {
    domain: 'Diagnostic', model: 'ListeningDiagnosticClip', canonicalId: String(clip.id), canonicalKey: `question-${clip.questionId}/${clip.label}`, title: clip.label,
    publicationStatus: 'ACTIVE_ASSESSMENT_GOVERNED', learnerVisibility: 'LEARNER', requiredAccessTier: 'FREE', mediaField: 'url', mediaType: 'audio', required: true, currentDbMediaReference: clip.url || clip.key, mappingEvidence: 'Diagnostic clip exact question relationship',
  });
  for (const response of diagnosticResponses) addRecord(records, objectByKey, {
    domain: 'Diagnostic', model: 'DiagnosticSpeakingResponse', canonicalId: String(response.id), canonicalKey: response.taskKey, title: response.taskKey,
    publicationStatus: response.status, learnerVisibility: 'INTERNAL', requiredAccessTier: 'USER_PRIVATE', mediaField: 'audioKey', mediaType: 'audio', required: false, currentDbMediaReference: response.audioKey, mappingEvidence: 'Learner submission private audio',
  });
  for (const submission of submissions) addRecord(records, objectByKey, {
    domain: 'Speaking', model: 'SpeakingSubmission', canonicalId: String(submission.id), canonicalKey: `submission-${submission.id}`, title: `Exercise ${submission.exerciseId}`,
    publicationStatus: String(submission.status), learnerVisibility: 'INTERNAL', requiredAccessTier: 'USER_PRIVATE', mediaField: 'audioKey', mediaType: 'audio', required: false, currentDbMediaReference: submission.audioKey || submission.audioUrl, mappingEvidence: 'Learner submission private audio',
  });
  for (const attachment of attachments) addRecord(records, objectByKey, {
    domain: 'Support', model: 'SuggestionAttachment', canonicalId: String(attachment.id), canonicalKey: `suggestion-${attachment.suggestionId}`, title: attachment.name,
    publicationStatus: 'USER_UPLOAD', learnerVisibility: 'INTERNAL', requiredAccessTier: 'USER_PRIVATE', mediaField: 'url', mediaType: mediaType(attachment.url, attachment.type), required: true, currentDbMediaReference: attachment.url, mappingEvidence: 'User attachment relationship',
  });

  // JSON payloads are authoritative only after manual semantic review. They are
  // surfaced as separate manifest records rather than being silently attached.
  for (const quiz of quizzes) for (const question of quiz.questions) for (const found of urlsInJson(question.content, 'content')) addRecord(records, objectByKey, {
    domain: quiz.type, model: 'Question.content', canonicalId: String(question.id), canonicalKey: `quiz-${quiz.id}/question-${question.id}/${found.path}`, title: quiz.title,
    publicationStatus: String(quiz.publicationStatus), learnerVisibility: quiz.publicationStatus === QuizPublicationStatus.PUBLISHED ? 'LEARNER' : 'LEGACY_OR_DRAFT', requiredAccessTier: quiz.isPremiumContent ? 'PREMIUM_CONTENT' : 'FREE', mediaField: found.path, mediaType: mediaType(found.url, found.path), required: /image|audio|media|asset/i.test(found.path), currentDbMediaReference: found.url, mappingEvidence: 'Nested authored Question.content reference; semantic review required',
  });

  const allInventory = [...publicInventory, ...privateInventory];
  const mappedKeys = new Set(
    records
      .filter((record) => record.actualR2Key && record.storageScope)
      .map((record) => `${record.storageScope}:${record.actualR2Key}`),
  );
  const preservedObjects = allInventory.filter((object) => !mappedKeys.has(`${object.bucket}:${object.key}`)).map((object) => ({
    ...object,
    classification: object.key.startsWith('uploads/') || object.key.startsWith('speaking/pending/') ? 'UNRELATED_APPLICATION_UPLOAD' : 'UNREFERENCED_BUT_PRESERVE',
  }));
  const recordsByObject = new Map<string, MediaRecord[]>();
  for (const record of records) {
    if (!record.actualR2Key || !record.storageScope) continue;
    const key = `${record.storageScope}:${record.actualR2Key}`;
    recordsByObject.set(key, [...(recordsByObject.get(key) ?? []), record]);
  }
  const objectClassifications = allInventory.map((object) => {
    const mapped = recordsByObject.get(`${object.bucket}:${object.key}`) ?? [];
    const classification = mapped.some((record) => record.finalStatus === 'MAPPED_ACTIVE')
      ? 'MAPPED_ACTIVE'
      : mapped.some((record) => record.finalStatus === 'MAPPED_INTERNAL')
        ? 'MAPPED_INTERNAL'
        : mapped.some((record) => record.finalStatus === 'MAPPED_LEGACY')
          ? 'MAPPED_LEGACY'
          : object.key.startsWith('uploads/') || object.key.startsWith('speaking/pending/')
            ? 'UNRELATED_APPLICATION_UPLOAD'
            : 'UNREFERENCED_BUT_PRESERVE';
    return {
      ...object,
      classification,
      mappingConfidence: mapped.length ? 'PROVEN' : 'NO_MATCH',
      mappedRecords: mapped.map((record) => ({
        domain: record.domain,
        model: record.model,
        canonicalId: record.canonicalId,
        mediaField: record.mediaField,
        publicationStatus: record.publicationStatus,
      })),
      evidence: mapped.length
        ? 'Exact DB media reference resolved to this R2 key.'
        : 'No exact active DB media reference; object retained without mutation.',
    };
  });
  const objectClassificationSummary = objectClassifications.reduce<Record<string, number>>((acc, object) => {
    acc[object.classification] = (acc[object.classification] ?? 0) + 1;
    return acc;
  }, {});
  const summary = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.finalStatus] = (acc[record.finalStatus] ?? 0) + 1;
    return acc;
  }, {});
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    inventoryObjectCount: allInventory.length,
    publicInventoryObjectCount: publicInventory.length,
    privateInventoryObjectCount: privateInventory.length,
    records,
    preservedObjects,
    objectClassifications,
    objectClassificationSummary,
    summary,
    brokenActiveReferences: records.filter((record) => record.learnerVisibility === 'LEARNER' && record.required && record.technicalValidity === 'MISSING').length,
    ambiguousActiveMappings: records.filter((record) => record.learnerVisibility === 'LEARNER' && record.mappingConfidence === 'AMBIGUOUS').length,
  };
  writeFileSync(join(artifactDir, 'content-media-recovery-manifest.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    inventoryObjectCount: output.inventoryObjectCount,
    publicInventoryObjectCount: output.publicInventoryObjectCount,
    privateInventoryObjectCount: output.privateInventoryObjectCount,
    recordCount: records.length,
    summary,
    objectClassificationSummary,
    preservedObjectCount: preservedObjects.length,
    brokenActiveReferences: output.brokenActiveReferences,
    ambiguousActiveMappings: output.ambiguousActiveMappings,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
