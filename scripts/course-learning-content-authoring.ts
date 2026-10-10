import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

/**
 * Idempotent, narrow editorial cleanup for course learning content.
 * It never deletes rows or touches learner progress. Rich learner guidance is
 * supplied by the versioned course-learning-content module.
 */
const repairs = [{ id: 1, title: 'Nghe A1 — Tin nhắn hằng ngày' }];

async function main() {
  const actions: Array<Record<string, unknown>> = [];
  for (const repair of repairs) {
    const current = await prisma.courseActivity.findUnique({
      where: { id: repair.id },
      select: { id: true, title: true },
    });
    if (!current) {
      actions.push({ ...repair, action: 'missing' });
      continue;
    }
    if (current.title === repair.title) {
      actions.push({ ...repair, action: 'unchanged' });
      continue;
    }
    if (apply)
      await prisma.courseActivity.update({
        where: { id: repair.id },
        data: { title: repair.title },
      });
    actions.push({
      ...repair,
      previousTitle: current.title,
      action: apply ? 'updated' : 'would-update',
    });
  }
  console.log(
    JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', actions }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
