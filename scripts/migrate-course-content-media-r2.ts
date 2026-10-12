import 'dotenv/config';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient, CourseStatus } from '@prisma/client';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

type MediaEntry = {
  courseId: number;
  courseTitle: string;
  courseStatus: string;
  lessonId?: number;
  lessonTitle?: string;
  mediaId?: number;
  field: 'thumbnail' | 'coverImage' | 'lessonMedia';
  type: string;
  originalUrl: string;
  originalSourcePath: string | null;
  sourceClass: 'FRONTEND_PUBLIC' | 'R2' | 'EXTERNAL' | 'NONE';
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  provenance: string | null;
  referenced: boolean;
  r2ObjectKey: string | null;
  resolvedUrl: string | null;
  resolvedUrlClass: 'PUBLIC' | 'SIGNED' | null;
  migrationStatus:
    | 'UPLOADED'
    | 'REUSED'
    | 'EXISTING_R2'
    | 'NO_MEDIA'
    | 'FAILED';
  error?: string;
};

type RawMediaEntry = Pick<MediaEntry, 'courseId' | 'courseTitle' | 'courseStatus' | 'lessonId' | 'lessonTitle' | 'mediaId' | 'field' | 'type' | 'originalUrl' | 'provenance' | 'referenced'>;

type CourseRecord = {
  id: number;
  title: string;
  description: string | null;
  thumbnail: string | null;
  level: string | null;
  curriculumType: string;
  status: CourseStatus;
  createdAt: Date;
  lessons: Array<{
    id: number;
    title: string;
    coverImage: string | null;
    media: Array<{
      id: number;
      type: string;
      url: string;
      altText: string | null;
      provenance: string | null;
      renderStatus: string;
    }>;
  }>;
};

const prisma = new PrismaClient();
const backendRoot = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(backendRoot, '..', 'kltn-breadtrans-frontend-junior');
const frontendPublicRoot = path.join(frontendRoot, 'public');
const artifactRoot = path.resolve(backendRoot, '..', '..', 'artifacts', 'r2-course-media-migration');

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const bucket = process.env.R2_BUCKET_NAME?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');

if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
  throw new Error('R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL are required.');
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function publicUrlFor(key: string): string {
  return `${publicUrl}/${key}`;
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function isR2Url(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === new URL(publicUrl!).hostname || host.endsWith('.r2.dev');
  } catch {
    return false;
  }
}

function r2KeyFromUrl(value: string): string | null {
  if (!isR2Url(value)) return null;
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

function localPathFromUrl(value: string | null): string | null {
  if (!value || !value.startsWith('/images/courses/')) return null;
  const relative = value.replace(/^\//, '').replaceAll('/', path.sep);
  const resolved = path.resolve(frontendPublicRoot, relative);
  const root = path.resolve(frontendPublicRoot) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

function safeSvg(body: Buffer): void {
  const text = body.toString('utf8');
  if (/<script\b|<foreignObject\b|javascript:|\son\w+\s*=|<iframe\b/i.test(text)) {
    throw new Error('Unsafe SVG content rejected');
  }
}

function keyFor(courseId: number, lessonId: number | undefined, filePath: string, digest: string): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase() || 'bin';
  if (lessonId !== undefined) {
    return `catalog/courses/course-${courseId}/lessons/lesson-${lessonId}/media/v1-${digest.slice(0, 16)}.${ext}`;
  }
  return `catalog/courses/course-${courseId}/cover/v1-${digest.slice(0, 16)}.${ext}`;
}

async function head(key: string) {
  try {
    return await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

async function uploadVerified(filePath: string, key: string, contentType: string, digest: string): Promise<'UPLOADED' | 'REUSED'> {
  const body = await fs.readFile(filePath);
  const existing = await head(key);
  if (existing && (existing.ContentLength ?? 0) === body.length) return 'REUSED';
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { sha256: digest },
  }));
  const verified = await head(key);
  if (!verified || (verified.ContentLength ?? 0) !== body.length || verified.ContentType?.split(';')[0] !== contentType) {
    throw new Error(`R2 verification failed for ${key}`);
  }
  return 'UPLOADED';
}

async function inspectR2(value: string): Promise<{ key: string; size: number; mime: string | null }> {
  const key = r2KeyFromUrl(value);
  if (!key) throw new Error(`Unsupported non-R2 active media URL: ${value}`);
  const metadata = await head(key);
  if (!metadata || !metadata.ContentLength) throw new Error(`Missing R2 object: ${key}`);
  return { key, size: metadata.ContentLength, mime: metadata.ContentType?.split(';')[0] ?? null };
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(artifactRoot, { recursive: true });
}

async function dependencyAudit(courses: Array<{ id: number; title: string; status: CourseStatus; thumbnail: string | null }>) {
  const records = [];
  for (const course of courses) {
    const [classes, enrollments, assignments, lessons, materials, courseLessons, media, references, attempts, exercises, questions, answers, activities, quizzes, submissions, results, payments] = await Promise.all([
      prisma.class.count({ where: { courseId: course.id } }),
      prisma.enrollment.count({ where: { class: { courseId: course.id } } }),
      prisma.assignment.count({ where: { class: { courseId: course.id } } }),
      prisma.lesson.count({ where: { courseId: course.id } }),
      prisma.material.count({ where: { lesson: { courseId: course.id } } }),
      prisma.courseLesson.count({ where: { courseId: course.id } }),
      prisma.courseLessonMedia.count({ where: { lesson: { courseId: course.id } } }),
      prisma.courseLessonReference.count({ where: { lesson: { courseId: course.id } } }),
      prisma.courseLessonAttempt.count({ where: { lesson: { courseId: course.id } } }),
      prisma.courseLessonExercise.count({ where: { lesson: { courseId: course.id } } }),
      prisma.courseLessonQuestion.count({ where: { exercise: { lesson: { courseId: course.id } } } }),
      prisma.courseLessonExerciseAnswer.count({ where: { attempt: { lesson: { courseId: course.id } } } }),
      prisma.courseActivity.count({ where: { courseId: course.id } }),
      prisma.quiz.count({ where: { courseId: course.id } }),
      prisma.submission.count({ where: { quiz: { courseId: course.id } } }),
      prisma.result.count({ where: { submission: { quiz: { courseId: course.id } } } }),
      prisma.payment.count({ where: { enrollment: { class: { courseId: course.id } } } }),
    ]);
    const totalHistoricalDependencies = enrollments + assignments + attempts + answers + submissions + results + payments;
    records.push({
      courseId: course.id,
      title: course.title,
      status: course.status,
      dependencyCounts: { classes, enrollments, assignments, lessons, materials, courseLessons, media, references, attempts, exercises, questions, answers, activities, quizzes, submissions, results, payments },
      classification: totalHistoricalDependencies === 0 ? 'SAFE_TO_HARD_DELETE' : 'ARCHIVE_ONLY',
      action: totalHistoricalDependencies === 0 ? 'HARD_DELETE_IF_EXPLICITLY_APPROVED' : 'PRESERVE_HISTORY',
    });
  }
  return records;
}

async function main(): Promise<void> {
  await ensureDir();
  const allCourses = await prisma.course.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, title: true, description: true, thumbnail: true, level: true, curriculumType: true, status: true, createdAt: true,
      courseLessons: { orderBy: { order: 'asc' }, select: { id: true, title: true, coverImage: true, media: true } } },
  });
  const active = allCourses.filter((course) => course.status === CourseStatus.PUBLISHED);
  if (active.length !== 3) throw new Error(`Expected exactly 3 published courses, found ${active.length}`);

  const inventory: MediaEntry[] = [];
  for (const course of allCourses) {
    const add = async (entry: RawMediaEntry) => {
      const local = localPathFromUrl(entry.originalUrl);
      const base = { ...entry, originalSourcePath: local, sourceClass: local ? 'FRONTEND_PUBLIC' as const : isR2Url(entry.originalUrl) ? 'R2' as const : entry.originalUrl ? 'EXTERNAL' as const : 'NONE' as const };
      inventory.push({ ...base, mimeType: null, sizeBytes: null, checksumSha256: null, r2ObjectKey: null, resolvedUrl: null, resolvedUrlClass: null, migrationStatus: 'NO_MEDIA' });
      if (!entry.originalUrl) return;
      if (local) {
        const body = await fs.readFile(local);
        if (path.extname(local).toLowerCase() === '.svg') safeSvg(body);
        const digest = sha256(body);
        const mime = mimeFor(local);
        const key = keyFor(course.id, entry.lessonId, local, digest);
        const status = await uploadVerified(local, key, mime, digest);
        const item = inventory[inventory.length - 1];
        Object.assign(item, { mimeType: mime, sizeBytes: body.length, checksumSha256: digest, r2ObjectKey: key, resolvedUrl: publicUrlFor(key), resolvedUrlClass: 'PUBLIC', migrationStatus: status });
      } else if (isR2Url(entry.originalUrl)) {
        const info = await inspectR2(entry.originalUrl);
        const item = inventory[inventory.length - 1];
        Object.assign(item, { mimeType: info.mime, sizeBytes: info.size, r2ObjectKey: info.key, resolvedUrl: publicUrlFor(info.key), resolvedUrlClass: 'PUBLIC', migrationStatus: 'EXISTING_R2' });
      } else {
        throw new Error(`Active/existing course media is not local or R2: ${entry.originalUrl}`);
      }
    };
    if (course.thumbnail) await add({ courseId: course.id, courseTitle: course.title, courseStatus: course.status, field: 'thumbnail', type: 'IMAGE', originalUrl: course.thumbnail, provenance: 'course thumbnail', referenced: true });
    for (const lesson of course.courseLessons) {
      if (lesson.coverImage) await add({ courseId: course.id, courseTitle: course.title, courseStatus: course.status, lessonId: lesson.id, lessonTitle: lesson.title, field: 'coverImage', type: 'IMAGE', originalUrl: lesson.coverImage, provenance: 'lesson cover', referenced: true });
      for (const media of lesson.media) await add({ courseId: course.id, courseTitle: course.title, courseStatus: course.status, lessonId: lesson.id, lessonTitle: lesson.title, mediaId: media.id, field: 'lessonMedia', type: media.type, originalUrl: media.url, provenance: media.provenance, referenced: media.renderStatus === 'READY' });
    }
  }

  const activeIds = active.map((course) => course.id);
  const updates = inventory.filter((item) => activeIds.includes(item.courseId) && item.resolvedUrl && item.originalUrl !== item.resolvedUrl);
  await prisma.$transaction(async (tx) => {
    for (const item of updates) {
      if (item.field === 'thumbnail') await tx.course.update({ where: { id: item.courseId }, data: { thumbnail: item.resolvedUrl! } });
      else if (item.field === 'coverImage' && item.lessonId) await tx.courseLesson.update({ where: { id: item.lessonId }, data: { coverImage: item.resolvedUrl! } });
      else if (item.field === 'lessonMedia' && item.mediaId) await tx.courseLessonMedia.update({ where: { id: item.mediaId }, data: { url: item.resolvedUrl!, provenance: `${item.provenance ?? ''}${item.provenance ? ' | ' : ''}R2:${item.r2ObjectKey}` } });
    }
  });

  const dependencies = await dependencyAudit(allCourses.map(({ id, title, status, thumbnail }) => ({ id, title, status, thumbnail })));
  const legacy = dependencies.filter((item) => !activeIds.includes(item.courseId));
  const preMigration = {
    generatedAt: new Date().toISOString(),
    visibleActiveCourseCount: active.length,
    activeCourses: active.map((course) => ({ id: course.id, title: course.title, status: course.status, thumbnail: course.thumbnail, lessonCount: course.courseLessons.length })),
    courses: allCourses.map((course) => ({ id: course.id, title: course.title, status: course.status, thumbnail: course.thumbnail, lessonCount: course.courseLessons.length })),
    media: inventory,
    counts: {
      localFrontendImages: inventory.filter((item) => item.sourceClass === 'FRONTEND_PUBLIC' && item.type === 'IMAGE').length,
      r2Images: inventory.filter((item) => item.sourceClass === 'R2' && item.type === 'IMAGE').length,
      audio: inventory.filter((item) => item.type === 'AUDIO').length,
      video: inventory.filter((item) => item.type === 'VIDEO').length,
      covers: inventory.filter((item) => item.field === 'thumbnail' || item.field === 'coverImage').length,
      lessonMedia: inventory.filter((item) => item.field === 'lessonMedia').length,
    },
    environment: { R2_BUCKET_NAME: true, R2_ACCOUNT_ID: true, R2_ACCESS_KEY_ID: true, R2_SECRET_ACCESS_KEY: true, R2_PUBLIC_URL: true },
  };
  await fs.writeFile(path.join(artifactRoot, 'pre-migration-media-inventory.json'), JSON.stringify(preMigration, null, 2));
  await fs.writeFile(path.join(artifactRoot, 'legacy-course-dependency-audit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), activeCourseIds: activeIds, legacy }, null, 2));
  await fs.writeFile(path.join(artifactRoot, 'legacy-course-backup-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), courses: allCourses.filter((course) => !activeIds.includes(course.id)), dependencies: legacy }, null, 2));
  await fs.writeFile(path.join(artifactRoot, 'active-course-r2-media-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), activeCourseIds: activeIds, entries: inventory.filter((item) => activeIds.includes(item.courseId)) }, null, 2));
  await fs.writeFile(path.join(artifactRoot, 'legacy-course-cleanup-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), entries: legacy.map((item) => ({ ...item, action: item.classification === 'SAFE_TO_HARD_DELETE' ? 'ARCHIVED_NO_DELETE_UNTIL_EXPLICIT_APPROVAL' : 'PRESERVED_HISTORY', dbResult: 'UNCHANGED_DRAFT', mediaResult: 'PRESERVED', r2CleanupResult: 'PRESERVED_REFERENCED_OBJECTS' })) }, null, 2));
  await fs.writeFile(path.join(artifactRoot, 'r2-garbage-collection-candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), candidates: [], deleted: [], reason: 'No unreferenced legacy R2 objects were deleted.' }, null, 2));
  console.log(JSON.stringify({ activeCourses: active.map((course) => ({ id: course.id, title: course.title })), migrated: updates.length, inventory: inventory.length, legacy: legacy.map((item) => ({ courseId: item.courseId, classification: item.classification })) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
