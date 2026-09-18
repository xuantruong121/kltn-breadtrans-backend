import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
if (!publicUrl) throw new Error('R2_PUBLIC_URL is required.');
const base = `${publicUrl}/catalog/listening/practice/images`;
const assets = new Map<number, string>([
  [1, 'grocery-checkout.png'],
  [5, 'office-meeting.png'],
  [9, 'cafe-counter.png'],
  [10, 'departure-board.png'],
  [11, 'office-meeting.png'],
  [12, 'folders-cabinet.png'],
]);

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [quizId, file] of assets) {
      const quiz = await tx.quiz.findUnique({
        where: { id: quizId },
        select: { questions: { select: { id: true, content: true } } },
      });
      if (!quiz) throw new Error(`Quiz ${quizId} not found`);

      for (const question of quiz.questions) {
        const content = question.content as Record<string, unknown>;
        await tx.question.update({
          where: { id: question.id },
          data: {
            content: {
              ...content,
              imageUrl: `${base}/${file}`,
              imagePurpose: 'TOPIC_CONTEXT',
            },
          },
        });
      }
    }
  });
  console.log('Updated listening practice image references.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
