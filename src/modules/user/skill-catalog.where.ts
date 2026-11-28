import {
  Prisma,
  QuizPublicationStatus,
  QuizType,
  SpeakingPracticeScope,
  TopicCategory,
} from '@prisma/client';

/**
 * What the skill progress ("Tiến độ", GET /users/me/skill-progress) counts as
 * a skill's catalog. Owner 2026-11-26: /speaking said 23 sets while its
 * catalog lists 21, because the 2 EXAM_INTERNAL sets used inside TOEIC exams
 * were counted. The filters below are the ones the learner catalogs use
 * (getListeningPractices, the Writing catalog, findAllExercises): published
 * items only, and for Speaking only the skill-practice sets. The finished
 * counts use the same filters, so "done" never runs past the total.
 */
export const LISTENING_CATALOG_QUIZ: Prisma.QuizWhereInput = {
  type: QuizType.LISTENING_PRACTICE,
  publicationStatus: QuizPublicationStatus.PUBLISHED,
};

export const WRITING_CATALOG_QUIZ: Prisma.QuizWhereInput = {
  type: { in: [QuizType.WRITING_PICTURE, QuizType.WRITING_EMAIL] },
  publicationStatus: QuizPublicationStatus.PUBLISHED,
  practiceTopic: {
    category: {
      in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
    },
  },
};

export const SPEAKING_CATALOG_EXERCISE: Prisma.SpeakingExerciseWhereInput = {
  title: { not: '' },
  targetText: { not: '' },
  publicationStatus: QuizPublicationStatus.PUBLISHED,
  OR: [
    { practiceSetId: null },
    {
      practiceSet: {
        scope: SpeakingPracticeScope.SKILL_PRACTICE,
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
    },
  ],
};
