import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const userCount = Number(process.env.PHASE812_USER_COUNT ?? 1000);

const users = Array.from({ length: userCount }, (_, index) => ({
  email: `qa-phase812-load-${String(index + 1).padStart(4, '0')}@example.invalid`,
  role: 'STUDENT',
}));

try {
  await prisma.user.createMany({ data: users, skipDuplicates: true });
  const exam = await prisma.toeicExamSet.create({
    data: {
      title: 'Phase 8.12.2 Isolated Load Exam',
      description: 'Synthetic exam for isolated horizontal-scaling proof.',
      type: 'FULL_TEST',
      difficulty: 'medium',
      durationSeconds: 7200,
      publicationStatus: 'PUBLISHED',
    },
  });
  const group = await prisma.toeicQuestionGroup.create({
    data: {
      examId: exam.id,
      part: 5,
      groupOrder: 1,
    },
  });
  await prisma.toeicQuestion.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      groupId: group.id,
      questionNumber: index + 1,
      text: `Synthetic question ${index + 1}`,
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
    })),
  });
  console.log(JSON.stringify({ examId: exam.id, userCount }));
} finally {
  await prisma.$disconnect();
}
