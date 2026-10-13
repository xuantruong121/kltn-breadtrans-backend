import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const root = resolve(__dirname, '..');
const assetPath = join(
  root,
  'content-assets',
  'internet-course-media',
  'course-8-lesson-57-present.png',
);
async function main() {
  const bytes = await readFile(assetPath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!publicUrl || !bucket || !accountId || !accessKeyId || !secretAccessKey)
    throw new Error('R2 configuration is incomplete');
  const key = `catalog/courses/course-8/lessons/lesson-57/media/v4-${checksum.slice(0, 16)}.png`;
  const url = `${publicUrl}/${key}`;
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const prisma = new PrismaClient();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: 'image/png',
        CacheControl: 'public,max-age=31536000,immutable',
        Metadata: {
          sha256: checksum,
          source: 'Wikimedia-Commons-CC-BY-SA-derivative',
          sourcePages:
            'commons.wikimedia.org/wiki/File:EGG_Present_simple.svg;commons.wikimedia.org/wiki/File:EGG_Present_continuous.svg',
        },
      }),
    );
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (Number(head.ContentLength) !== bytes.length)
      throw new Error('R2 object size verification failed');
    const lesson = await prisma.courseLesson.findFirst({
      where: { courseId: 8, slug: 'present-simple-and-continuous' },
      select: { id: true },
    });
    if (!lesson) throw new Error('Course 8 present-tense lesson not found');
    const media = await prisma.courseLessonMedia.findFirst({
      where: { lessonId: lesson.id, type: 'IMAGE' },
      orderBy: { id: 'asc' },
    });
    const data = {
      url,
      altText:
        'Sơ đồ so sánh hiện tại đơn cho thói quen với hiện tại tiếp diễn cho hành động đang xảy ra.',
      provenance: `Wikimedia Commons derivative: Robbiemuffin, EGG Present simple.svg + EGG Present continuous.svg; CC BY-SA 3.0 / GFDL; source pages: https://commons.wikimedia.org/wiki/File:EGG_Present_simple.svg and https://commons.wikimedia.org/wiki/File:EGG_Present_continuous.svg; sha256:${checksum}`,
      renderStatus: 'READY',
    };
    if (media)
      await prisma.courseLessonMedia.update({ where: { id: media.id }, data });
    else
      await prisma.courseLessonMedia.create({
        data: { lessonId: lesson.id, type: 'IMAGE', ...data },
      });
    const artifactDir = resolve(
      root,
      '..',
      '..',
      'artifacts',
      'internet-first-course-media',
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      join(artifactDir, 'course-8-lesson-57-present.json'),
      JSON.stringify(
        {
          lessonId: 57,
          sourceType: 'INTERNET_MEDIA_DERIVATIVE',
          sourceResearchCompleted: true,
          rejectedCandidates: [
            'https://www.perfect-english-grammar.com/support-files/tenses-infographics.pdf',
            'https://www.english-illustrated.com/english-grammar/present-simple-vs-present-continuous',
            'https://www.woodwardenglish.com/lesson/present-simple-vs-present-continuous/',
            'https://commons.wikimedia.org/wiki/File:English_Tenses_with_English_-_Turkish_Example_Sentences.jpg',
            'https://commons.wikimedia.org/wiki/File:Table_of_Tenses.png',
          ],
          checksum,
          r2Key: key,
          r2Url: url,
          sourcePages: [
            'https://commons.wikimedia.org/wiki/File:EGG_Present_simple.svg',
            'https://commons.wikimedia.org/wiki/File:EGG_Present_continuous.svg',
          ],
          creator:
            'Robbiemuffin (source graphics); BreadTrans (layout derivative)',
          license:
            'CC BY-SA 3.0 / GFDL for source graphics; derivative layout shared under CC BY-SA 3.0',
          watermark: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        lessonId: 57,
        checksum,
        r2Key: key,
        r2Url: url,
        bytes: bytes.length,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
