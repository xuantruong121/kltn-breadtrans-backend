import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const result = await prisma.courseLessonReference.deleteMany({
    where: { lesson: { courseId: { in: [1, 8, 12] } } },
  });
  console.log(
    JSON.stringify({ removedReferences: result.count, courses: [1, 8, 12] }),
  );
}
void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
