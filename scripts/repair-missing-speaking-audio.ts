import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const index = process.argv.indexOf('--submission-id');
  const id = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return {
    id,
    apply: process.argv.includes('--apply'),
    assumeMissing: process.argv.includes('--confirm-missing'),
  };
}

async function main() {
  const { id, apply, assumeMissing } = parseArgs();
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      'Usage: npx ts-node scripts/repair-missing-speaking-audio.ts --submission-id <id> [--apply --confirm-missing]',
    );
  }

  const submission = await prisma.speakingSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      exerciseId: true,
      status: true,
      audioKey: true,
      attemptCount: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      processedAt: true,
      uploadIntent: {
        select: { id: true, status: true, objectKey: true, submissionId: true },
      },
    },
  });

  if (!submission) throw new Error(`Speaking submission #${id} not found`);
  console.log(JSON.stringify({ ...submission, lastErrorMessage: undefined }, null, 2));

  if (!apply) {
    console.log('DRY_RUN: no database mutation performed; storage HEAD must be verified separately.');
    return;
  }
  if (!assumeMissing) {
    throw new Error('Refusing mutation without --confirm-missing after an authoritative storage check.');
  }

  const result = await prisma.speakingSubmission.updateMany({
    where: { id, status: 'FAILED' },
    data: {
      lastErrorCode: 'AUDIO_OBJECT_NOT_FOUND',
      lastErrorMessage: 'Audio object is not available in storage',
    },
  });
  console.log(JSON.stringify({ updatedRows: result.count, submissionId: id }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
