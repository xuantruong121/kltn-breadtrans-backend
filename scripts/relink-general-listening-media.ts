/**
 * Relinks the pre-materialized general Listening assets stored in R2.
 * It never calls TTS, uploads, deletes, or touches TOEIC Exam media.
 */
import 'dotenv/config';
import { PrismaClient, QuizType } from '@prisma/client';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
  throw new Error('R2 configuration is required.');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  const questions = await prisma.question.findMany({
    where: { quiz: { type: QuizType.LISTENING_PRACTICE } },
    select: { id: true, quizId: true, content: true },
    orderBy: [{ quizId: 'asc' }, { order: 'asc' }],
  });
  const verified: Array<{ questionId: number; key: string; size: number; contentType: string | null }> = [];
  const missing: Array<{ questionId: number; key: string }> = [];

  for (const question of questions) {
    const content = question.content as Record<string, unknown>;
    if (typeof content.audioText !== 'string' || !content.audioText.trim()) continue;
    const key = Array.isArray(content.transcriptSegments)
      ? `catalog/listening/practice/audio/quiz-${question.quizId}/question-${question.id}/dialogue-v3.mp3`
      : `catalog/listening/practice/audio/quiz-${question.quizId}/question-${question.id}/v1.mp3`;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const size = head.ContentLength ?? 0;
      if (size <= 0) throw new Error('zero-byte object');
      verified.push({ questionId: question.id, key, size, contentType: head.ContentType ?? null });
    } catch {
      missing.push({ questionId: question.id, key });
    }
  }

  if (missing.length) {
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'CHECK', verified: verified.length, missing }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (apply) {
    await prisma.$transaction(async (tx) => {
      for (const media of verified) {
        await tx.quizAudioAsset.updateMany({
          where: { questionId: media.questionId }, data: { isActive: false },
        });
        await tx.quizAudioAsset.upsert({
          where: { questionId_version: { questionId: media.questionId, version: 1 } },
          update: { key: media.key, url: `${publicUrl}/${media.key}`, mimeType: 'audio/mpeg', isActive: true },
          create: { questionId: media.questionId, version: 1, key: media.key, url: `${publicUrl}/${media.key}`, mimeType: 'audio/mpeg', isActive: true },
        });
      }
    });
  }

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'CHECK', verified: verified.length, missing: [],
    representative: verified.find((item) => item.questionId === 27) ?? null,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
