import 'dotenv/config';

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

type Course1Asset = {
  lessonId: number;
  fileName: string;
  contentType: 'image/jpeg' | 'image/svg+xml';
  sourcePage: string;
  sourceUrl: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  altText: string;
  reason: string;
};

const backendRoot = resolve(__dirname, '..');
const sourceRoot = join(backendRoot, 'content-assets', 'internet-course-media');
const artifactRoot = resolve(
  backendRoot,
  '..',
  '..',
  'artifacts',
  'internet-first-course-media',
);
const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');
const bucket = process.env.R2_BUCKET_NAME?.trim();
const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

if (!publicUrl || !bucket || !accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    'R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL are required.',
  );
}

const assets: Course1Asset[] = [
  {
    lessonId: 1,
    fileName: 'course-1-lesson-1-classroom-context.jpg',
    contentType: 'image/jpeg',
    sourcePage:
      'https://commons.wikimedia.org/wiki/File:Instructor_speaking_to_students_in_classroom.jpg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/3/38/Instructor_speaking_to_students_in_classroom.jpg',
    creator: 'Ryan Hagerty / U.S. Fish and Wildlife Service',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Ryan Hagerty, U.S. Fish and Wildlife Service (public domain)',
    altText:
      'Người học đang trao đổi trong lớp học, gợi bối cảnh chào hỏi và giới thiệu bản thân.',
    reason:
      'A real classroom conversation makes the first greeting lesson concrete before the learner meets the language patterns.',
  },
  {
    lessonId: 2,
    fileName: 'course-1-lesson-2-family-tree.svg',
    contentType: 'image/svg+xml',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Family_Tree.svg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/0/0c/Family_Tree.svg',
    creator: 'Wilfredor',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Wilfredor, “Family Tree” (CC0 1.0)',
    altText:
      'Sơ đồ cây gia đình giúp liên hệ mother, father, sister và brother.',
    reason:
      'A relationship diagram makes family vocabulary and “Who is he/she?” questions concrete without decorative stock imagery.',
  },
  {
    lessonId: 3,
    fileName: 'course-1-lesson-3-morning-routine.jpg',
    contentType: 'image/jpeg',
    sourcePage:
      'https://commons.wikimedia.org/wiki/File:Coffee_cup_in_the_morning_%F0%9F%8C%84.jpg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/f/f6/Coffee_cup_in_the_morning_%F0%9F%8C%84.jpg',
    creator: 'Jothisettu',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Jothisettu, “Coffee cup in the morning” (CC0 1.0)',
    altText:
      'Tách cà phê trong buổi sáng, gợi hoạt động hằng ngày và thói quen lặp lại.',
    reason:
      'The morning coffee scene supports daily-routine vocabulary and connects Present Simple to a familiar repeated action.',
  },
  {
    lessonId: 4,
    fileName: 'course-1-lesson-4-clock.svg',
    contentType: 'image/svg+xml',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Clock_simple.svg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/2/26/Clock_simple.svg',
    creator: 'Mothmolevna',
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: 'Mothmolevna, “Clock simple” (public domain)',
    altText:
      'Biểu tượng đồng hồ gợi việc nói giờ, lịch học và hoạt động hiện tại.',
    reason:
      'A clock directly cues the lesson’s time and schedule language while the text explains routine versus temporary action.',
  },
  {
    lessonId: 5,
    fileName: 'course-1-lesson-5-house-floor-plan.svg',
    contentType: 'image/svg+xml',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:HouseFlrPlan.svg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/b/b8/HouseFlrPlan.svg',
    creator: 'Malyszkz (vector), based on MrDrew508',
    license: 'GPL-2.0-or-later',
    licenseUrl: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
    attribution: 'Malyszkz, “HouseFlrPlan” (GPL-2.0-or-later)',
    altText:
      'Mặt bằng nhà giúp định vị các phòng và luyện giới từ chỉ nơi chốn.',
    reason:
      'A floor plan gives an actual spatial reference for there is/are, in/on/under and next to.',
  },
  {
    lessonId: 6,
    fileName: 'course-1-lesson-6-shopping-context.jpg',
    contentType: 'image/jpeg',
    sourcePage:
      'https://commons.wikimedia.org/wiki/File:Woman_grocery_shopping.jpg',
    sourceUrl:
      'https://upload.wikimedia.org/wikipedia/commons/b/bc/Woman_grocery_shopping.jpg',
    creator: 'National Cancer Institute / Unknown photographer',
    license: 'Public domain (U.S. National Institutes of Health)',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution:
      'National Cancer Institute, Woman Grocery Shopping (public domain)',
    altText: 'Người mua hàng đang chọn thực phẩm trong cửa hàng.',
    reason:
      'A shopping photograph gives food, quantities, and polite requests a concrete setting instead of an isolated vocabulary list.',
  },
  {
    lessonId: 7,
    fileName: 'course-1-lesson-7-meeting-context.jpg',
    contentType: 'image/jpeg',
    sourcePage:
      'https://unsplash.com/photos/person-gesturing-during-meeting-with-laptop-5QgIuuBxKwM',
    sourceUrl:
      'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80',
    creator: 'Headway / Unsplash',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
    attribution: 'Headway, meeting photograph via Unsplash',
    altText:
      'Một cuộc họp nhỏ gợi bối cảnh hỏi lại, xác nhận lịch và yêu cầu hỗ trợ.',
    reason:
      'A meeting scene supports clarification and confirmation phrases without duplicating the introductory classroom image.',
  },
];

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  const uploaded: Array<Record<string, unknown>> = [];
  for (const asset of assets) {
    const localPath = join(sourceRoot, asset.fileName);
    await mkdir(sourceRoot, { recursive: true });
    let body: Buffer;
    try {
      await access(localPath);
      body = await readFile(localPath);
    } catch {
      const response = await fetch(asset.sourceUrl, {
        headers: { 'User-Agent': 'BreadTrans-course1-media/1.0' },
      });
      if (!response.ok)
        throw new Error(`${asset.sourcePage} returned ${response.status}`);
      body = Buffer.from(await response.arrayBuffer());
      await writeFile(localPath, body);
    }
    if (body.length < 128)
      throw new Error(
        `Downloaded asset is unexpectedly small: ${asset.fileName}`,
      );
    const checksum = createHash('sha256').update(body).digest('hex');
    const extension = asset.contentType === 'image/svg+xml' ? 'svg' : 'jpg';
    const key = `catalog/courses/course-1/lessons/lesson-${asset.lessonId}/media/v2-${checksum.slice(0, 16)}.${extension}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: asset.contentType,
        CacheControl: 'public,max-age=31536000,immutable',
        Metadata: {
          sha256: checksum,
          source: asset.sourcePage
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 900),
        },
      }),
    );
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (
      head.ContentLength !== body.length ||
      head.ContentType !== asset.contentType
    )
      throw new Error(`R2 verification failed: ${key}`);
    const url = `${publicUrl}/${key}`;
    const provenance = `${asset.sourcePage} | ${asset.attribution} | R2:${key} | sha256:${checksum}`;
    const existing = await prisma.courseLessonMedia.findFirst({
      where: { lessonId: asset.lessonId, type: 'IMAGE' },
      orderBy: { id: 'asc' },
    });
    if (existing) {
      await prisma.courseLessonMedia.update({
        where: { id: existing.id },
        data: {
          url,
          altText: asset.altText,
          provenance,
          renderStatus: 'READY',
        },
      });
    } else {
      await prisma.courseLessonMedia.create({
        data: {
          lessonId: asset.lessonId,
          type: 'IMAGE',
          url,
          altText: asset.altText,
          provenance,
          renderStatus: 'READY',
        },
      });
    }
    uploaded.push({
      ...asset,
      localPath,
      checksumSha256: checksum,
      r2ObjectKey: key,
      dbUrl: url,
      r2Verified: true,
    });
  }
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    join(artifactRoot, 'course-1-learning-media-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        courseId: 1,
        sourcePolicy:
          'Internet-first, license verified, stored in Cloudflare R2; no frontend hotlinking.',
        assets: uploaded,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        status: 'COURSE_1_MEDIA_MATERIALIZED',
        assets: uploaded.map(
          ({ lessonId, r2ObjectKey, checksumSha256, r2Verified }) => ({
            lessonId,
            r2ObjectKey,
            checksumSha256,
            r2Verified,
          }),
        ),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    s3.destroy();
  });
