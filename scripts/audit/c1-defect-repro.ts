/**
 * Reproduce the learner page flow that exposed the pre-C1 grading defect.
 * Run from a checkout of HEAD 0adb882 it shows the defect; run from this tree
 * it shows the fix. Either way it targets the disposable C1 clone only.
 *
 * Mirrors the real learner page exactly: fetch the form, press Start, do NOT
 * refetch (the page does not), click options by displayed index, submit with
 * the attempt id.
 */
import { PrismaClient } from '@prisma/client';

import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';

const PROTECTED = ['7674533776495505443', '7699757546958700579'];

async function main() {
  const url = process.env.C1_TARGET_URL ?? '';
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const [id] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
  );
  if (
    PROTECTED.includes(id.sysid) ||
    ['kltn_db', 'kltn_shadow'].includes(id.db)
  )
    throw new Error('REFUSED: protected database');
  console.log(`CODE UNDER TEST against ${id.db} sysid=${id.sysid}`);

  const service = new DiagnosticService(prisma, {
    awardBanh: () => Promise.resolve({ granted: 50 }),
  } as any);
  const fresh = await prisma.user.findFirst({
    where: { diagnosticAttempts: { none: {} } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!fresh) throw new Error('no learner without attempts');
  const legacy = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: 1 },
    orderBy: { order: 'asc' },
  });

  const served: any = await service.getCurrentAssessment(fresh.id);
  const start: any = await service.startAttempt(fresh.id, 1);
  // The page keeps the form it fetched before Start.
  const answers: Record<string, number> = {};
  legacy.forEach((q, i) => {
    const text = (q.options as string[])[
      i < 13 ? q.correctIndex : (q.correctIndex + 1) % 4
    ];
    answers[String(q.id)] = served.questions
      .find((x: any) => x.id === q.id)
      .options.indexOf(text);
  });
  await service.submitAssessment(
    fresh.id,
    1,
    answers,
    start.submissionToken,
    start.attemptId,
  );
  const row = await prisma.diagnosticAttempt.findUnique({
    where: { id: start.attemptId },
  });
  console.log(`learner=${fresh.id} attempt=${start.attemptId}`);
  console.log(
    `INTENDED_CORRECT=13 STORED_CORRECT=${row?.correctCount} TOTAL=${row?.totalCount}`,
  );
  console.log(`DEFECT_REPRODUCED=${row?.correctCount !== 13}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(
    'REPRO ERROR:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-2)
      .join(' '),
  );
  process.exit(2);
});
