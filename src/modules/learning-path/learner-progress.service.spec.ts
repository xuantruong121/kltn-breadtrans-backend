import { LearnerProgressService } from './learner-progress.service';

/** In-memory stand-in for the tables one recorded attempt touches. */
function setup(overrides: { skillRow?: Record<string, unknown> | null } = {}) {
  const events: any[] = [];
  const unlocks: any[] = [];
  const difficulty = new Map<string, any>();
  let skillRow: any =
    overrides.skillRow === undefined
      ? {
          userId: 7,
          skill: 'READING',
          level: 'BASIC',
          unlockedLevel: 'BASIC',
          ability: 0.25,
        }
      : overrides.skillRow;

  const tx: any = {
    $executeRaw: jest.fn(),
    learnerProgressEvent: {
      createMany: ({ data }: any) => {
        const [row] = data;
        if (events.some((e) => e.sourceKey === row.sourceKey))
          return Promise.resolve({ count: 0 });
        events.push(row);
        return Promise.resolve({ count: 1 });
      },
      findMany: ({ where }: any) =>
        Promise.resolve(
          events.filter(
            (e) => e.skill === where.skill && e.level === where.level,
          ),
        ),
    },
    learnerSkillLevel: {
      findUnique: () => Promise.resolve(skillRow),
      create: ({ data }: any) => {
        skillRow = { ...data };
        return Promise.resolve(skillRow);
      },
      update: ({ data }: any) => {
        skillRow = { ...skillRow, ...data };
        return Promise.resolve(skillRow);
      },
    },
    contentDifficulty: {
      findUnique: ({ where }: any) =>
        Promise.resolve(
          difficulty.get(String(where.contentType_contentId.contentId)) ?? null,
        ),
      upsert: ({ where, create, update }: any) => {
        const key = String(where.contentType_contentId.contentId);
        const prev = difficulty.get(key);
        difficulty.set(
          key,
          prev
            ? {
                difficulty: update.difficulty,
                attempts: prev.attempts + 1,
              }
            : create,
        );
        return Promise.resolve(difficulty.get(key));
      },
    },
    levelUnlock: {
      createMany: ({ data }: any) => {
        unlocks.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
  };
  const quiz = (id: number, title = 'Reading A2 — Trip') => ({
    id,
    type: 'BILINGUAL_READING',
    title,
    practiceTopicId: null,
    courseId: null,
    toeicWritingSetItems: [],
    courseActivities: [],
  });
  const prisma: any = {
    ...tx,
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    quiz: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(quiz(where.id))),
    },
    speakingExercise: { findUnique: jest.fn(), findFirst: jest.fn() },
  };
  return {
    service: new LearnerProgressService(prisma),
    prisma,
    tx,
    events,
    unlocks,
    difficulty,
    quiz,
    skill: () => skillRow,
  };
}

const attempt = (quizId: number, submissionId: number, scorePercent = 80) => ({
  userId: 7,
  quizId,
  submissionId,
  scorePercent,
});

describe('LearnerProgressService', () => {
  it('moves ability and the item difficulty, and logs the attempt', async () => {
    const t = setup();
    await t.service.recordQuizAttempt(attempt(1, 100, 100));
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({
      skill: 'READING',
      level: 'BASIC',
      contentType: 'QUIZ',
      contentId: 1,
      sourceKey: 'quiz:100',
      scorePercent: 100,
    });
    expect(t.skill().ability).toBeGreaterThan(0.25);
    expect(t.difficulty.get('1')).toMatchObject({ attempts: 1 });
    expect(t.difficulty.get('1').difficulty).toBeLessThan(-0.5);
  });

  it('counts a replayed submission once', async () => {
    const t = setup();
    await t.service.recordQuizAttempt(attempt(1, 100));
    const ability = t.skill().ability;
    await t.service.recordQuizAttempt(attempt(1, 100));
    expect(t.events).toHaveLength(1);
    expect(t.skill().ability).toBe(ability);
    expect(t.difficulty.get('1').attempts).toBe(1);
  });

  it('opens the next level after three items averaging 70%', async () => {
    const t = setup();
    expect(await t.service.recordQuizAttempt(attempt(1, 100, 70))).toBeNull();
    expect(await t.service.recordQuizAttempt(attempt(2, 101, 75))).toBeNull();
    expect(await t.service.recordQuizAttempt(attempt(3, 102, 70))).toBe(
      'INTERMEDIATE',
    );
    expect(t.skill()).toMatchObject({
      unlockedLevel: 'INTERMEDIATE',
      level: 'INTERMEDIATE',
    });
    expect(t.unlocks.map((u) => [u.level, u.method])).toContainEqual([
      'INTERMEDIATE',
      'PATH_PROGRESS',
    ]);
  });

  it('does not count the same item three times', async () => {
    const t = setup();
    await t.service.recordQuizAttempt(attempt(1, 100, 90));
    await t.service.recordQuizAttempt(attempt(1, 101, 90));
    await t.service.recordQuizAttempt(attempt(1, 102, 90));
    expect(t.skill().unlockedLevel).toBe('BASIC');
  });

  it('holds the level while the average is short', async () => {
    const t = setup();
    await t.service.recordQuizAttempt(attempt(1, 100, 50));
    await t.service.recordQuizAttempt(attempt(2, 101, 50));
    await t.service.recordQuizAttempt(attempt(3, 102, 50));
    expect(t.skill().unlockedLevel).toBe('BASIC');
    expect(t.unlocks).toHaveLength(0);
  });

  it('starts an unplaced learner at the open level', async () => {
    const t = setup({ skillRow: null });
    await t.service.recordQuizAttempt(attempt(1, 100));
    expect(t.skill()).toMatchObject({ level: 'BASIC', unlockedLevel: 'BASIC' });
  });

  it.each([
    ['a course quiz', { courseId: 3 }],
    ['an exam writing item', { toeicWritingSetItems: [{ id: 1 }] }],
    ['a course activity', { courseActivities: [{ id: 1 }] }],
    ['an item with no level tag', { title: 'Untagged practice' }],
  ])('ignores %s', async (_name, facts) => {
    const t = setup();
    t.prisma.quiz.findUnique.mockResolvedValue({ ...t.quiz(1), ...facts });
    expect(await t.service.recordQuizAttempt(attempt(1, 100))).toBeNull();
    expect(t.events).toHaveLength(0);
  });

  it('never fails the grading that called it', async () => {
    const t = setup();
    t.prisma.quiz.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      t.service.recordQuizAttempt(attempt(1, 100)),
    ).resolves.toBeNull();
  });

  it('reads the percent from the event and skips attempts without one', async () => {
    const t = setup();
    await t.service.onQuizSubmitted({ userId: 7, quizId: 1, submissionId: 5 });
    expect(t.events).toHaveLength(0);
    await t.service.onQuizSubmitted({
      userId: 7,
      quizId: 1,
      submissionId: 5,
      scorePercent: 60,
    });
    expect(t.events[0].scorePercent).toBe(60);
  });

  describe('speaking', () => {
    const exercise = (overrides: Record<string, unknown> = {}) => ({
      id: 9,
      title: 'Giới thiệu',
      practiceSetId: 'set-1',
      practiceSet: {
        level: 'A2',
        scope: 'SKILL_PRACTICE',
        courseActivities: [],
      },
      ...overrides,
    });
    const speaking = (submissionId: number, overallScore: number | null) => ({
      userId: 7,
      exerciseId: 9,
      submissionId,
      overallScore,
    });

    it('counts each exercise, with difficulty on the set', async () => {
      const t = setup({
        skillRow: {
          userId: 7,
          skill: 'SPEAKING',
          level: 'BASIC',
          unlockedLevel: 'BASIC',
          ability: 0.25,
        },
      });
      t.prisma.speakingExercise.findUnique.mockResolvedValue(exercise());
      t.prisma.speakingExercise.findFirst.mockResolvedValue({ id: 4 });
      await t.service.recordSpeakingAttempt(speaking(50, 7.5));
      expect(t.events[0]).toMatchObject({
        skill: 'SPEAKING',
        contentType: 'SPEAKING_SET',
        contentId: 9,
        sourceKey: 'speaking:50',
        scorePercent: 75,
      });
      expect(t.difficulty.has('4')).toBe(true);
    });

    it('counts a real zero, not a silent recording', async () => {
      const t = setup();
      t.prisma.speakingExercise.findUnique.mockResolvedValue(exercise());
      t.prisma.speakingExercise.findFirst.mockResolvedValue({ id: 4 });
      await t.service.recordSpeakingAttempt(speaking(50, null));
      expect(t.events).toHaveLength(0);
      await t.service.recordSpeakingAttempt(speaking(51, 0));
      expect(t.events[0].scorePercent).toBe(0);
    });

    it('ignores exam speaking', async () => {
      const t = setup();
      t.prisma.speakingExercise.findUnique.mockResolvedValue(
        exercise({
          practiceSet: {
            level: 'A2',
            scope: 'EXAM_INTERNAL',
            courseActivities: [],
          },
        }),
      );
      await t.service.recordSpeakingAttempt(speaking(50, 8));
      expect(t.events).toHaveLength(0);
    });
  });
});
