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
  'course-8-lesson-57-present.svg',
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
  const key = `catalog/courses/course-8/lessons/lesson-57/media/v3-${checksum.slice(0, 16)}.svg`;
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
        ContentType: 'image/svg+xml',
        CacheControl: 'public,max-age=31536000,immutable',
        Metadata: { sha256: checksum, source: 'BreadTrans-original' },
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
      provenance: `BreadTrans original SVG; INTERNET_SEARCH_COMPLETED; rejected incomplete/less relevant open candidates; sha256:${checksum}`,
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
          sourceType: 'INTERNAL_ORIGINAL',
          sourceResearchCompleted: true,
          rejectedCandidates: [
            'https://commons.wikimedia.org/wiki/File:English_Grammar_Time_Simple_Present.png',
          ],
          checksum,
          r2Key: key,
          r2Url: url,
          license: 'Original BreadTrans artwork',
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
