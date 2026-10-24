import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
void (async () => {
  const exams = await p.exam.findMany({
    select: {
      id: true,
      title: true,
      familyCode: true,
      variantCode: true,
      publicationStatus: true,
      toeicExamSet: { select: { id: true, publicationStatus: true } },
      toeicAssessment: {
        select: { id: true, productFamily: true, publicationStatus: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  for (const e of exams) {
    console.log(
      `Exam#${e.id} ${e.publicationStatus.padEnd(9)} variant=${String(e.variantCode).padEnd(15)} examSet=${e.toeicExamSet?.id ?? '-'} assessment=${e.toeicAssessment?.id ?? '-'} (${e.toeicAssessment?.productFamily ?? '-'})  "${e.title}"`,
    );
  }
  console.log('\n-- orphan aggregates (no Exam parent) --');
  console.log(
    'ToeicExamSet without examId:',
    await p.toeicExamSet.count({ where: { examId: null } }),
  );
  console.log(
    'ToeicAssessment without examId:',
    await p.toeicAssessment.count({ where: { examId: null } }),
  );
})().finally(() => p.$disconnect());
