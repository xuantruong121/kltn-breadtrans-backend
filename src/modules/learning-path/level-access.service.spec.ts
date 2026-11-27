import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PracticeLevel, QuizType, Role } from '@prisma/client';

import { legacyPracticeLevel } from '../subscription/practice-level';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import {
  SpeakingContentAccessService,
  type SpeakingContentAccessSubject,
} from '../speaking/speaking-content-access.service';
import { LevelAccessService } from './level-access.service';

const ALL_QUIZZES = [
  { title: 'Reading A1 — a', practiceLevel: 'STARTER' },
  { title: 'Reading A2 — b', practiceLevel: 'BASIC' },
  { title: 'Reading B1 — c', practiceLevel: 'INTERMEDIATE' },
  { title: 'Reading C1 — d', practiceLevel: 'ADVANCED' },
];

function setup(skillRows: Array<Record<string, unknown>> = []) {
  const prisma: any = {
    learnerSkillLevel: { findMany: jest.fn().mockResolvedValue(skillRows) },
    quiz: {
      findMany: jest.fn(({ where }: any) => {
        // levelsWithContent: every level has content in every quiz skill.
        if (where.publicationStatus)
          return Promise.resolve(
            [
              'BILINGUAL_READING',
              'LISTENING_PRACTICE',
              'WRITING_EMAIL',
            ].flatMap((type) => ALL_QUIZZES.map((item) => ({ type, ...item }))),
          );
        return Promise.resolve(prisma.exemptQuizzes ?? []);
      }),
    },
    speakingPracticeSet: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { level: 'STARTER' },
          { level: 'BASIC' },
          { level: 'INTERMEDIATE' },
          { level: 'ADVANCED' },
        ]),
    },
    speakingExercise: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const level = new LevelAccessService(prisma);
  const plans = { effectivePlanCode: jest.fn().mockResolvedValue('PRO') };
  return {
    prisma,
    level,
    quizAccess: new QuizContentAccessService(plans as never, prisma, level),
    speakingAccess: new SpeakingContentAccessService(plans as never, level),
  };
}

const reading = (title: string, overrides: Record<string, unknown> = {}) => ({
  id: 10,
  type: QuizType.BILINGUAL_READING,
  title,
  practiceLevel: legacyPracticeLevel(title),
  isPremiumContent: false,
  ...overrides,
});

const row = (skill: string, unlockedLevel: string) => ({
  skill,
  unlockedLevel,
});

describe('LevelAccessService', () => {
  it('gives unplaced skills Cơ bản and keeps stored levels', async () => {
    const { level } = setup([row('READING', 'INTERMEDIATE')]);
    expect(await level.unlockedLevels(7)).toEqual({
      LISTENING: 'BASIC',
      READING: 'INTERMEDIATE',
      SPEAKING: 'BASIC',
      WRITING: 'BASIC',
    });
  });

  it('gives guests the open default without a lookup', async () => {
    const { level, prisma } = setup();
    expect((await level.unlockedLevels()).READING).toBe('BASIC');
    expect(prisma.learnerSkillLevel.findMany).not.toHaveBeenCalled();
  });

  it('passes over a level with nothing published', async () => {
    const { level, prisma } = setup([row('WRITING', 'STARTER')]);
    prisma.quiz.findMany.mockResolvedValue([
      {
        type: 'WRITING_EMAIL',
        title: 'Writing A2 — b',
        practiceLevel: 'BASIC',
      },
    ]);
    expect((await level.unlockedLevels(7)).WRITING).toBe('BASIC');
  });
});

describe('quiz access with level locks', () => {
  it('refuses an item above the open level, naming both', async () => {
    const { quizAccess } = setup([row('READING', 'BASIC')]);
    const err: ForbiddenException = await quizAccess
      .assertAccess(reading('Reading B1 — c'), 7)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({
      error: {
        code: 'LEVEL_LOCKED',
        skill: 'READING',
        level: 'INTERMEDIATE',
        unlockedLevel: 'BASIC',
      },
    });
  });

  it('opens an item at or below the open level', async () => {
    const { quizAccess } = setup([row('READING', 'INTERMEDIATE')]);
    await expect(
      quizAccess.assertAccess(reading('Reading B1 — c'), 7),
    ).resolves.toBeUndefined();
    await expect(
      quizAccess.assertAccess(reading('Reading A1 — a'), 7),
    ).resolves.toBeUndefined();
  });

  it('asks a guest to log in', async () => {
    const { quizAccess } = setup();
    await expect(
      quizAccess.assertAccess(reading('Reading B1 — c')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('never locks an admin', async () => {
    const { quizAccess } = setup();
    await expect(
      quizAccess.assertAccess(reading('Reading C1 — d'), 1, Role.ADMIN),
    ).resolves.toBeUndefined();
  });

  it('leaves quizzes linked to an exam alone', async () => {
    const { quizAccess, prisma } = setup();
    prisma.exemptQuizzes = [{ id: 10 }];
    await expect(
      quizAccess.assertAccess(reading('Reading C1 — d'), 7),
    ).resolves.toBeUndefined();
  });

  it('reports the level lock on list rows and keeps the plan result', async () => {
    const { quizAccess } = setup([row('READING', 'BASIC')]);
    const map = await quizAccess.resolveMany(
      [reading('Reading A2 — b'), reading('Reading B1 — c', { id: 11 })],
      7,
    );
    expect(map.get(10)).toMatchObject({
      practiceLevel: 'BASIC',
      isLevelLocked: false,
    });
    expect(map.get(11)).toMatchObject({
      practiceLevel: 'INTERMEDIATE',
      isLevelLocked: true,
      isLocked: false,
    });
  });
});

describe('speaking access with level locks', () => {
  const exercise = (
    level: PracticeLevel,
    overrides: Partial<SpeakingContentAccessSubject> = {},
  ): SpeakingContentAccessSubject & { title?: string } => ({
    id: 20,
    isPremiumContent: false,
    title: 'Giới thiệu',
    practiceSet: { scope: 'SKILL_PRACTICE', level },
    ...overrides,
  });

  it('refuses a set above the open level', async () => {
    const { speakingAccess } = setup([row('SPEAKING', 'BASIC')]);
    const err: ForbiddenException = await speakingAccess
      .assertAccess(exercise('INTERMEDIATE'), 7)
      .catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      error: { code: 'LEVEL_LOCKED', skill: 'SPEAKING', level: 'INTERMEDIATE' },
    });
  });

  it('leaves exam tasks alone', async () => {
    const { speakingAccess } = setup();
    await expect(
      speakingAccess.assertAccess(
        exercise('ADVANCED', {
          practiceSet: { scope: 'EXAM_INTERNAL', level: 'ADVANCED' },
        }),
        7,
      ),
    ).resolves.toBeUndefined();
  });
});
