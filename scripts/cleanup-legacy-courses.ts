/**
 * Removes only the canonical, legacy non-BEGINNER Course catalog.
 *
 * Modern TOEIC Exam/Assessment data is intentionally not queried or deleted.
 * Legacy Quiz shells are detached before Course deletion and stay available to
 * their own migration/replacement path. Run with --apply to mutate data.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const legacyCourseIds = [2, 3, 4, 5, 6, 7];

async function main() {
  const targets = await prisma.course.findMany({
    where: { id: { in: legacyCourseIds } },
    select: { id: true, title: true, level: true },
    orderBy: { id: 'asc' },
  });
  if (targets.some((course) => course.level === 'BEGINNER')) {
    throw new Error('Refusing to delete a BEGINNER course.');
  }
  const targetIds = targets.map((course) => course.id);
  const classes = await prisma.class.findMany({
    where: { courseId: { in: targetIds } }, select: { id: true },
  });
  const classIds = classes.map((item) => item.id);
  const enrollments = classIds.length
    ? await prisma.enrollment.findMany({ where: { classId: { in: classIds } }, select: { id: true } })
    : [];
  const enrollmentIds = enrollments.map((item) => item.id);
  const [paymentCount, quizCount] = await Promise.all([
    enrollmentIds.length ? prisma.payment.count({ where: { enrollmentId: { in: enrollmentIds } } }) : 0,
    prisma.quiz.count({ where: { courseId: { in: targetIds } } }),
  ]);

  if (apply) {
    await prisma.$transaction(async (tx) => {
      if (enrollmentIds.length) {
        await tx.payOSPaymentIntent.deleteMany({
          where: { coursePayment: { enrollmentId: { in: enrollmentIds } } },
        });
        await tx.payment.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
      }
      await tx.quiz.updateMany({ where: { courseId: { in: targetIds } }, data: { courseId: null } });
      await tx.course.deleteMany({ where: { id: { in: targetIds } } });
    });
  }

  const [basicCourses, remainingNonBasic] = await Promise.all([
    prisma.course.findMany({ where: { level: 'BEGINNER' }, select: { id: true, title: true }, orderBy: { id: 'asc' } }),
    prisma.course.count({ where: { level: { not: 'BEGINNER' } } }),
  ]);
  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'CHECK', targets, dependencies: {
      classes: classIds.length, enrollments: enrollmentIds.length, payments: paymentCount, legacyQuizShellsDetached: quizCount,
    }, result: { basicCourses, remainingNonBasic },
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
