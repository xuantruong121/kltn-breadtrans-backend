/**
 * Checkpoint 58: create the "Viết câu theo tranh" Writing practice
 * (prisma/data/picture-writing-practice.ts) on a target database.
 *
 * Additive only: one PracticeTopic (WRITING_PART1), two WRITING_PICTURE
 * quizzes, five tasks each. Nothing existing is read for change, updated or
 * deleted. Before writing it checks every task with pictureTaskIssues and
 * fetches every picture over HTTP, so no exercise is published with a
 * missing image or invalid cue words. A rerun stops instead of duplicating.
 *
 * Usage: npx ts-node --transpile-only scripts/picture-writing-cp58.ts <dryrun|apply> --target <url|env:DATABASE_URL> [--image-base <url>]
 * apply needs PICTURE_WRITING_AUTHORIZED=create. kltn_db additionally needs
 * PICTURE_WRITING_KLTN_DB=owner-approved (separate owner authorization).
 * PICTURE_WRITING_TEST_FAIL=after-first-quiz aborts mid-transaction to prove
 * the rollback; it is ignored on kltn_db.
 */
import { PrismaClient, QuizType, TopicCategory } from '@prisma/client';

import {
  PICTURE_WRITING_EXERCISES,
  PICTURE_WRITING_TOPIC,
  pictureTaskContent,
} from '../prisma/data/picture-writing-practice';
import { pictureTaskIssues } from '../src/modules/writing/practice-writing-grading';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const mode = process.argv[2];
  const target = arg('--target');
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  const imageBase = arg('--image-base') ?? process.env.R2_PUBLIC_URL;
  if (!url || !imageBase || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error(
      'usage: <dryrun|apply> --target <url|env:DATABASE_URL> [--image-base <url>]',
    );
  if (mode === 'apply' && process.env.PICTURE_WRITING_AUTHORIZED !== 'create')
    throw new Error('REFUSED: PICTURE_WRITING_AUTHORIZED=create not set');

  // 1. Content and pictures are checked before any connection.
  const plan = PICTURE_WRITING_EXERCISES.map((exercise) => ({
    exercise,
    contents: exercise.tasks.map((task) =>
      pictureTaskContent(exercise, task, imageBase),
    ),
  }));
  for (const { exercise, contents } of plan)
    contents.forEach((content, i) => {
      const issues = pictureTaskIssues(content);
      if (issues.length)
        throw new Error(
          `STOP: "${exercise.title}" task ${i + 1}: ${issues.join(', ')}`,
        );
    });
  for (const url of new Set(
    plan.flatMap((p) => p.contents.map((c) => c.imageUrl)),
  )) {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/'))
      throw new Error(`STOP: picture not available ${res.status} ${url}`);
  }
  console.log(
    `content ok: ${plan.length} exercises, ${plan.reduce((n, p) => n + p.contents.length, 0)} tasks, pictures reachable`,
  );

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target ${db} sysid ${sysid} (${mode})`);
    if (
      mode === 'apply' &&
      db === 'kltn_db' &&
      process.env.PICTURE_WRITING_KLTN_DB !== 'owner-approved'
    )
      throw new Error(
        'REFUSED: kltn_db needs PICTURE_WRITING_KLTN_DB=owner-approved',
      );

    const existingTopic = await prisma.practiceTopic.findFirst({
      where: {
        name: PICTURE_WRITING_TOPIC.name,
        category: TopicCategory.WRITING_PART1,
      },
    });
    const twins = await prisma.quiz.count({
      where: { title: { in: plan.map((p) => p.exercise.title) } },
    });
    if (existingTopic || twins > 0)
      throw new Error(
        `STOP: already present (topic ${existingTopic?.id ?? '-'}, quizzes ${twins}); nothing written`,
      );

    for (const { exercise, contents } of plan)
      console.log(
        `plan: "${exercise.title}" premium=${exercise.isPremiumContent} tasks=${contents.length}`,
      );
    if (mode === 'dryrun') return;

    // One transaction: a failure part-way leaves nothing behind.
    const created = await prisma.$transaction(async (tx) => {
      const topic = await tx.practiceTopic.create({
        data: {
          name: PICTURE_WRITING_TOPIC.name,
          vietnameseName: PICTURE_WRITING_TOPIC.vietnameseName,
          category: TopicCategory.WRITING_PART1,
        },
      });
      const quizzes: string[] = [];
      for (const { exercise, contents } of plan) {
        const quiz = await tx.quiz.create({
          data: {
            title: exercise.title,
            description: exercise.description,
            type: QuizType.WRITING_PICTURE,
            practiceTopicId: topic.id,
            isPremiumContent: exercise.isPremiumContent,
            publishedAt: new Date(),
            questions: {
              create: contents.map((content, i) => ({
                type: 'WRITING',
                order: i + 1,
                content,
              })),
            },
          },
        });
        quizzes.push(`quiz ${quiz.id} "${quiz.title}"`);
        // Test hook: prove the rollback on a disposable database only.
        if (
          process.env.PICTURE_WRITING_TEST_FAIL === 'after-first-quiz' &&
          db !== 'kltn_db'
        )
          throw new Error('test failure after the first quiz');
      }
      return { topic: topic.id, quizzes };
    });
    console.log(
      `created topic ${created.topic}; ${created.quizzes.join('; ')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
