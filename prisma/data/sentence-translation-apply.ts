/**
 * Writes the "Dịch câu" exercises (sentence-translation-practice.ts) to a
 * database. Additive and idempotent: the topic is reused when present and an
 * exercise is created only when no quiz has its title, so a rerun writes
 * nothing. Used by prisma/seed.ts and scripts/sentence-translation-load.ts.
 */
import { Prisma, PrismaClient, QuizType, TopicCategory } from '@prisma/client';

import { translationTaskIssues } from '../../src/modules/writing/sentence-translation.logic';
import {
  SENTENCE_TRANSLATION_EXERCISES,
  SENTENCE_TRANSLATION_TOPIC,
  translationTaskContent,
} from './sentence-translation-practice';

type Db = PrismaClient | Prisma.TransactionClient;

/** Throws before any write when a sentence fails the authoring checks. */
export function assertSentenceTranslationContent() {
  for (const exercise of SENTENCE_TRANSLATION_EXERCISES)
    exercise.sentences.forEach((sentence, i) => {
      const issues = translationTaskIssues(
        translationTaskContent(exercise, sentence),
      );
      if (issues.length)
        throw new Error(
          `STOP: "${exercise.title}" sentence ${i + 1}: ${issues.join(', ')}`,
        );
    });
}

/** What a run would do: the existing topic and the exercises still missing. */
export async function sentenceTranslationPlan(db: Db) {
  const topic = await db.practiceTopic.findFirst({
    where: {
      name: SENTENCE_TRANSLATION_TOPIC.name,
      category: TopicCategory.WRITING_PART1,
    },
    select: { id: true },
  });
  const present = await db.quiz.findMany({
    where: {
      title: { in: SENTENCE_TRANSLATION_EXERCISES.map((e) => e.title) },
    },
    select: { title: true },
  });
  const have = new Set(present.map((q) => q.title));
  return {
    topicId: topic?.id ?? null,
    missing: SENTENCE_TRANSLATION_EXERCISES.filter((e) => !have.has(e.title)),
  };
}

export async function applySentenceTranslation(db: Db) {
  assertSentenceTranslationContent();
  const plan = await sentenceTranslationPlan(db);
  if (plan.missing.length === 0)
    return { topicId: plan.topicId, created: [] as string[] };
  const topicId =
    plan.topicId ??
    (
      await db.practiceTopic.create({
        data: {
          name: SENTENCE_TRANSLATION_TOPIC.name,
          vietnameseName: SENTENCE_TRANSLATION_TOPIC.vietnameseName,
          category: TopicCategory.WRITING_PART1,
        },
        select: { id: true },
      })
    ).id;
  const created: string[] = [];
  for (const exercise of plan.missing) {
    const quiz = await db.quiz.create({
      data: {
        title: exercise.title,
        description: exercise.description,
        type: QuizType.WRITING_PICTURE,
        practiceTopicId: topicId,
        // A1 and A2 are free (practice-level.ts); the seed resyncs it anyway.
        isPremiumContent: false,
        publishedAt: new Date(),
        questions: {
          create: exercise.sentences.map((sentence, i) => ({
            type: 'WRITING',
            order: i + 1,
            content: translationTaskContent(exercise, sentence),
          })),
        },
      },
      select: { id: true, title: true },
    });
    created.push(`quiz ${quiz.id} "${quiz.title}"`);
  }
  return { topicId, created };
}
