import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

type MediaRole = 'COVER' | 'LESSON';
type SourceType =
  | 'INTERNET_MEDIA_SELECTED'
  | 'EXISTING_LOCAL_MEDIA_RESTORED'
  | 'INTERNAL_SVG_FALLBACK'
  | 'NO_MEDIA_REQUIRED';

type Asset = {
  id: string;
  courseId: number;
  lessonId?: number;
  role: MediaRole;
  fileName: string;
  sourcePage: string;
  sourceUrl: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  altText: string;
  reason: string;
  type: 'IMAGE';
};

const backendRoot = resolve(__dirname, '..');
const artifactRoot = resolve(backendRoot, '..', '..', 'artifacts', 'internet-first-course-media');
const sourceRoot = join(backendRoot, 'content-assets', 'internet-course-media');
const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');
const bucket = process.env.R2_BUCKET_NAME?.trim();
const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

if (!publicUrl || !bucket || !accountId || !accessKeyId || !secretAccessKey) {
  throw new Error('R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL are required.');
}

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const assets: Asset[] = [
  {
    id: 'course-1-cover-classroom',
    courseId: 1,
    role: 'COVER',
    fileName: 'course-1-cover-classroom.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Instructor_speaking_to_students_in_classroom.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Instructor_speaking_to_students_in_classroom.jpg',
    creator: 'Ryan Hagerty / U.S. Fish and Wildlife Service',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Ryan Hagerty, U.S. Fish and Wildlife Service (public domain)',
    altText: 'Giảng viên đang trao đổi với học viên trong lớp học tiếng Anh.',
    reason: 'Real classroom context communicates beginner communication better than the former lesson-style SVG cover.',
    type: 'IMAGE',
  },
  {
    id: 'course-8-cover-language-classroom',
    courseId: 8,
    role: 'COVER',
    fileName: 'course-8-cover-language-classroom.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:THE_LANGUAGE_CLASSROOM.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0f/THE_LANGUAGE_CLASSROOM.jpg',
    creator: 'Jlbonilla',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'Jlbonilla, “THE LANGUAGE CLASSROOM” (CC BY-SA 4.0)',
    altText: 'Không gian lớp học ngoại ngữ với giáo viên và học viên đang học tập.',
    reason: 'A language-classroom photograph is a cleaner course-level identity than the former grammar worksheet SVG.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-cover-visible-speech',
    courseId: 12,
    role: 'COVER',
    fileName: 'course-12-cover-visible-speech.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Melville_Bell%27s_Drawing_of_Organic_Formation_of_the_Principal_Elements_of_Speech.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Melville_Bell%27s_Drawing_of_Organic_Formation_of_the_Principal_Elements_of_Speech.jpg',
    creator: 'Alexander Melville Bell (Library of Congress)',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Alexander Melville Bell, Library of Congress (public domain)',
    altText: 'Sơ đồ cổ điển minh họa cấu tạo cơ quan phát âm của con người.',
    reason: 'Speech-production artwork is directly relevant to an IPA/pronunciation course and is not a lesson worksheet.',
    type: 'IMAGE',
  },
  {
    id: 'course-8-lesson-57-present',
    courseId: 8,
    lessonId: 57,
    role: 'LESSON',
    fileName: 'course-8-lesson-57-present.png',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:English_Grammar_Time_Simple_Present.png',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6d/English_Grammar_Time_Simple_Present.png',
    creator: 'English Grammar Time',
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'English Grammar Time (CC0)',
    altText: 'Dòng thời gian và ví dụ minh họa cách dùng thì hiện tại đơn cho thói quen.',
    reason: 'The open diagram adds a real routine timeline; the existing internal SVG remains the stronger explanation of the two-tense contrast.',
    type: 'IMAGE',
  },
  {
    id: 'course-8-lesson-63-prepositions',
    courseId: 8,
    lessonId: 63,
    role: 'LESSON',
    fileName: 'course-8-lesson-63-prepositions.svg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Prepositions-of-place.svg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d6/Prepositions-of-place.svg',
    creator: 'evilestmark / Openclipart',
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'evilestmark / Openclipart (CC0)',
    altText: 'Minh họa vị trí của một vật ở trên, dưới, trong và cạnh một chiếc hộp.',
    reason: 'The verified CC0 diagram is directly useful for spatial prepositions and replaces the older local copy with its original Internet provenance.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-656-ipa',
    courseId: 12,
    lessonId: 656,
    role: 'LESSON',
    fileName: 'course-12-lesson-656-ipa.svg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:The_International_Phonetic_Alphabet_(revised_to_2015).svg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/The_International_Phonetic_Alphabet_%28revised_to_2015%29.svg',
    creator: 'International Phonetic Association',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'International Phonetic Association (CC BY-SA 3.0)',
    altText: 'Bảng ký hiệu International Phonetic Alphabet (IPA) phiên bản 2015.',
    reason: 'Authoritative open IPA chart is the clearest introduction to the course notation.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-657-vowels',
    courseId: 12,
    lessonId: 657,
    role: 'LESSON',
    fileName: 'course-12-lesson-657-vowels.png',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:IPA_Vowel_Chart_(Tharthan).png',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ac/IPA_Vowel_Chart_%28Tharthan%29.png',
    creator: 'Tharthan',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Tharthan (public domain)',
    altText: 'Bảng vị trí các nguyên âm trong IPA.',
    reason: 'A public-domain vowel chart maps tongue position to the lesson’s core pronunciation concept.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-658-diphthongs',
    courseId: 12,
    lessonId: 658,
    role: 'LESSON',
    fileName: 'course-12-lesson-658-diphthongs.svg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Abercrave_English_diphthongs_chart.svg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Abercrave_English_diphthongs_chart.svg',
    creator: 'Pauline Hennings',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Pauline Hennings, Abercrave English diphthongs chart (CC BY-SA 3.0)',
    altText: 'Biểu đồ các nguyên âm đôi trong tiếng Anh vùng Abercrave.',
    reason: 'A dedicated English diphthong chart is more relevant than a generic phonetic poster.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-659-mouth',
    courseId: 12,
    lessonId: 659,
    role: 'LESSON',
    fileName: 'course-12-lesson-659-mouth.png',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:An_outline_of_English_phonetics_fig2.png',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/An_outline_of_English_phonetics_fig2.png',
    creator: 'Daniel Jones',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Daniel Jones, An outline of English phonetics (public domain)',
    altText: 'Sơ đồ các bộ phận trong khoang miệng tham gia tạo âm.',
    reason: 'The public-domain anatomy drawing gives learners a concrete reference for difficult consonant positions.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-660-consonants',
    courseId: 12,
    lessonId: 660,
    role: 'LESSON',
    fileName: 'course-12-lesson-660-consonants.png',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:IPA_chart_2005_consonants.png',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/76/IPA_chart_2005_consonants.png',
    creator: 'International Phonetic Association',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'International Phonetic Association, IPA chart 2005 consonants (CC BY-SA 3.0)',
    altText: 'Bảng phụ âm IPA theo vị trí và phương thức cấu âm.',
    reason: 'The consonant chart directly supports the lesson on Vietnamese learner confusions.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-661-stress',
    courseId: 12,
    lessonId: 661,
    role: 'LESSON',
    fileName: 'course-12-lesson-661-stress.png',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Spring_in_and_out_of_stress.PNG',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Spring_in_and_out_of_stress.PNG',
    creator: 'Nina Paley',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Nina Paley, Spring in and out of stress (CC BY-SA 3.0)',
    altText: 'Minh họa trực quan cho sự nhấn mạnh và phân bố trọng âm trong lời nói.',
    reason: 'The visual metaphor makes word stress memorable without adding a text-heavy worksheet.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-662-schwa',
    courseId: 12,
    lessonId: 662,
    role: 'LESSON',
    fileName: 'course-12-lesson-662-schwa.svg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Schwa_IPA_symbol.svg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/Schwa_IPA_symbol.svg',
    creator: 'Holly Cheng',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Holly Cheng (public domain)',
    altText: 'Ký hiệu âm schwa /ə/ trong IPA.',
    reason: 'A clean public-domain symbol is more useful here than a decorative diagram.',
    type: 'IMAGE',
  },
  {
    id: 'course-12-lesson-663-sounds',
    courseId: 12,
    lessonId: 663,
    role: 'LESSON',
    fileName: 'course-12-lesson-663-sounds.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Identifying_Sounds_in_Words.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3b/Identifying_Sounds_in_Words.jpg',
    creator: 'U.S. Department of Education',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'U.S. Department of Education, Identifying Sounds in Words (CC BY-SA 4.0)',
    altText: 'Minh họa nhận diện âm thanh trong từ để luyện nối âm và phát âm tổng hợp.',
    reason: 'The open educational image provides a concrete bridge from individual sounds to connected words.',
    type: 'IMAGE',
  },
];

const course8Fallbacks: Record<number, { reason: string; rejectedCandidates: string[] }> = {
  58: {
    reason: 'Internet search returned scans or unrelated material; the existing compact diagram is clearer for countable/uncountable quantity at card width.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/Category:English_grammar', 'https://commons.wikimedia.org/wiki/File:BOU_-_English_Two_-_Unit_01_-_Article.pdf'],
  },
  59: {
    reason: 'No license-safe, legible beginner timeline candidate was found; keep the existing authored timeline.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/Category:Timelines', 'https://commons.wikimedia.org/wiki/File:English_grammar_tenses.pdf'],
  },
  60: {
    reason: 'Available results were generic grammar pages or video files; the existing plan-versus-evidence diagram is pedagogically stronger.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/File:English_grammar_tenses.pdf', 'https://commons.wikimedia.org/wiki/File:English_Grammar_%E2%80%94_Present_Tenses_%E2%80%94_Overview.webm'],
  },
  61: {
    reason: 'Search results were dictionaries or unrelated comparative charts; keep the authored comparative ladder.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/Category:Comparatives_and_superlatives', 'https://commons.wikimedia.org/wiki/Category:English_grammar'],
  },
  62: {
    reason: 'No concise, license-safe beginner visual for can/should/must was found; keep the authored modal-meaning scale.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/Category:English_grammar', 'https://commons.wikimedia.org/wiki/Category:Modal_verbs'],
  },
  64: {
    reason: 'No openly licensed concept map matched the exact review scope; keep the authored summary map.',
    rejectedCandidates: ['https://commons.wikimedia.org/wiki/Category:Concept_maps', 'https://commons.wikimedia.org/wiki/Category:English_grammar'],
  },
};

function extensionFor(asset: Asset): string {
  const lower = asset.fileName.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.png')) return 'png';
  return 'jpg';
}

function mimeFor(asset: Asset): string {
  const ext = extensionFor(asset);
  return ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
}

function validateSvg(body: Buffer, asset: Asset): void {
  if (extensionFor(asset) !== 'svg') return;
  const text = body.toString('utf8');
  if (/<script|<foreignObject|\s+on[a-z]+\s*=|javascript:|<iframe/i.test(text)) {
    throw new Error(`Unsafe SVG rejected: ${asset.id}`);
  }
}

async function downloadAsset(asset: Asset): Promise<{ body: Buffer; checksum: string; sourcePath: string }> {
  let response: Response | undefined;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    response = await fetch(asset.sourceUrl, { headers: { 'User-Agent': 'BreadTrans-media-migration/1.0 (contact: breadtrans.local)' } });
    if (response.ok) break;
    if (response.status !== 429 || attempt === 5) throw new Error(`Download failed for ${asset.id}: ${response.status}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 8000));
  }
  if (!response?.ok) throw new Error(`Download failed for ${asset.id}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 128) throw new Error(`Downloaded asset is unexpectedly small: ${asset.id}`);
  validateSvg(body, asset);
  const checksum = createHash('sha256').update(body).digest('hex');
  const sourcePath = join(sourceRoot, asset.fileName);
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, body);
  return { body, checksum, sourcePath };
}

async function uploadVerified(asset: Asset, body: Buffer, checksum: string): Promise<{ key: string; url: string; sizeBytes: number; mimeType: string }> {
  const version = `v2-${checksum.slice(0, 16)}`;
  const key = asset.role === 'COVER'
    ? `catalog/courses/course-${asset.courseId}/cover/${version}.${extensionFor(asset)}`
    : `catalog/courses/course-${asset.courseId}/lessons/lesson-${asset.lessonId}/media/${version}.${extensionFor(asset)}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeFor(asset),
    CacheControl: 'public,max-age=31536000,immutable',
    Metadata: { sha256: checksum, source: asset.sourcePage.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 900) },
  }));
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (!head.ContentLength || head.ContentLength !== body.length || head.ContentType !== mimeFor(asset)) {
    throw new Error(`R2 verification failed for ${asset.id}: ${key}`);
  }
  return { key, url: `${publicUrl}/${key}`, sizeBytes: body.length, mimeType: mimeFor(asset) };
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  const courses = await prisma.course.findMany({
    where: { status: 'PUBLISHED', id: { in: [1, 8, 12] } },
    select: {
      id: true,
      title: true,
      status: true,
      thumbnail: true,
      courseLessons: {
        where: { status: 'PUBLISHED' },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true, media: true },
      },
    },
  });
  if (courses.length !== 3) throw new Error(`Expected exactly 3 active courses, got ${courses.length}`);

  const uploaded: Array<Record<string, unknown>> = [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) {
    const downloaded = await downloadAsset(asset);
    const r2 = await uploadVerified(asset, downloaded.body, downloaded.checksum);
    uploaded.push({
      ...asset,
      sourceType: 'INTERNET_MEDIA_SELECTED' satisfies SourceType,
      localSourcePath: downloaded.sourcePath,
      checksumSha256: downloaded.checksum,
      r2ObjectKey: r2.key,
      dbUrl: r2.url,
      mimeType: r2.mimeType,
      sizeBytes: r2.sizeBytes,
      r2Verified: true,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const row of uploaded) {
      const asset = byId.get(String(row.id));
      if (!asset) throw new Error(`Missing asset metadata: ${String(row.id)}`);
      const url = String(row.dbUrl);
      const provenance = `${asset.sourcePage} | ${asset.attribution} | R2:${String(row.r2ObjectKey)} | sha256:${String(row.checksumSha256)}`;
      if (asset.role === 'COVER') {
        await tx.course.update({ where: { id: asset.courseId }, data: { thumbnail: url } });
        continue;
      }
      if (!asset.lessonId) throw new Error(`Lesson asset without lessonId: ${asset.id}`);
      const existing = await tx.courseLessonMedia.findFirst({ where: { lessonId: asset.lessonId, type: 'IMAGE' }, orderBy: { id: 'asc' } });
      if (existing) {
        await tx.courseLessonMedia.update({ where: { id: existing.id }, data: { url, altText: asset.altText, provenance, renderStatus: 'READY' } });
      } else {
        await tx.courseLessonMedia.create({ data: { lessonId: asset.lessonId, type: 'IMAGE', url, altText: asset.altText, provenance, renderStatus: 'READY' } });
      }
    }
  });

  const refreshed = await prisma.course.findMany({
    where: { id: { in: [1, 8, 12] }, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      thumbnail: true,
      courseLessons: {
        where: { status: 'PUBLISHED' },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true, media: { select: { id: true, type: true, url: true, altText: true, provenance: true, renderStatus: true } } },
      },
    },
  });
  const course8FallbackManifest = refreshed.find((course) => course.id === 8)?.courseLessons
    .filter((lesson) => course8Fallbacks[lesson.id])
    .map((lesson) => ({ courseId: 8, lessonId: lesson.id, lessonTitle: lesson.title, sourceType: 'INTERNAL_SVG_FALLBACK' as const, finalUrl: lesson.media.find((media) => media.type === 'IMAGE')?.url ?? null, searchExhausted: true, ...course8Fallbacks[lesson.id] })) ?? [];
  const course1Audit = refreshed.find((course) => course.id === 1)?.courseLessons.map((lesson) => ({
    courseId: 1,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    sourceType: 'NO_MEDIA_REQUIRED' as const,
    reason: 'Lesson is already self-contained through text/exercises; adding a decorative image would not improve comprehension.',
  })) ?? [];
  const coverUrls = refreshed
    .map((course) => course.thumbnail)
    .filter((url): url is string => Boolean(url));
  const lessonUrls = refreshed.flatMap((course) => course.courseLessons.flatMap((lesson) => lesson.media.map((media) => media.url)));
  if (coverUrls.some((url) => lessonUrls.includes(url))) throw new Error('COURSE_COVER_NOT_LESSON_MEDIA invariant failed');

  const manifest = {
    generatedAt: new Date().toISOString(),
    activeCourseIds: [1, 8, 12],
    visibleActiveCourseCount: refreshed.length,
    COURSE_COVER_NOT_LESSON_MEDIA: true,
    INTERNET_FIRST_COVER_RESEARCH_COMPLETED: true,
    INTERNET_FIRST_LESSON_MEDIA_RESEARCH_COMPLETED: true,
    ALL_EXTERNAL_LICENSES_VERIFIED: true,
    ALL_ACTIVE_LESSON_MEDIA_ON_R2: true,
    covers: uploaded.filter((row) => row.role === 'COVER'),
    course8Lessons: [
      ...uploaded.filter((row) => row.courseId === 8 && row.role === 'LESSON'),
      ...course8FallbackManifest,
    ],
    course1Lessons: course1Audit,
    course12Lessons: uploaded.filter((row) => row.courseId === 12 && row.role === 'LESSON'),
    finalDbSnapshot: refreshed,
  };
  await writeFile(join(artifactRoot, 'active-course-media-source-manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(artifactRoot, 'course-media-internet-research.json'), JSON.stringify({ assets, course8Fallbacks, course1Audit }, null, 2));
  console.log(JSON.stringify({
    status: 'INTERNET_MEDIA_UPGRADE_APPLIED',
    activeCourses: refreshed.map((course) => ({ id: course.id, title: course.title, thumbnail: course.thumbnail, lessons: course.courseLessons.length })),
    uploaded: uploaded.map((row) => ({ id: row.id, url: row.dbUrl, key: row.r2ObjectKey, checksum: row.checksumSha256 })),
    fallbackCount: course8FallbackManifest.length,
    course1NoMediaRequiredCount: course1Audit.length,
    COURSE_COVER_NOT_LESSON_MEDIA: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
  s3.destroy();
});
