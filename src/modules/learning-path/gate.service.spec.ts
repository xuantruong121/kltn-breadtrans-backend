import {
  gateQuestionView,
  gateRetryAt,
  gradeGate,
  selectGateQuestions,
} from './gate.logic';
import { GateService } from './gate.service';

const content = (index: number) => ({
  text: `Question ${index}`,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 1,
  passage: `Passage ${index}`,
  explanation: 'why',
  translation: 'dịch',
  transcriptSegments: ['secret'],
});

describe('gate logic', () => {
  const candidates = [
    { id: 1, quizId: 10, order: 2 },
    { id: 2, quizId: 10, order: 1 },
    { id: 3, quizId: 20, order: 1 },
    { id: 4, quizId: 20, order: 2 },
  ];

  it('keeps a Reading passage together and in order', () => {
    const picked = selectGateQuestions('READING', candidates, 3, () => 0.99);
    expect(picked.map((q) => q.id)).toEqual([2, 1, 3]);
  });

  it('draws Listening questions singly, up to the count', () => {
    expect(
      selectGateQuestions('LISTENING', candidates, 2, () => 0.5),
    ).toHaveLength(2);
    expect(
      selectGateQuestions('LISTENING', candidates, 8, () => 0.5),
    ).toHaveLength(4);
  });

  it('shows the question and nothing that reveals the answer', () => {
    const view = gateQuestionView('READING', {
      id: 1,
      quizId: 10,
      content: content(1),
    });
    expect(Object.keys(view).sort()).toEqual(
      ['hasAudio', 'id', 'options', 'passage', 'quizId', 'text'].sort(),
    );
    expect(JSON.stringify(view)).not.toMatch(/correct|explanation|secret|dịch/);
  });

  it('gives Listening no passage or transcript', () => {
    const view = gateQuestionView('LISTENING', {
      id: 1,
      quizId: 10,
      content: content(1),
    });
    expect(view).not.toHaveProperty('passage');
    expect(view.hasAudio).toBe(true);
  });

  it('passes at 75%, and counts a missing answer as wrong', () => {
    const questions = [1, 2, 3, 4].map((id) => ({ id, content: content(id) }));
    expect(
      gradeGate('LISTENING', questions, { 1: 'b', 2: 'b', 3: 'b', 4: 'a' }),
    ).toEqual({ correct: 3, total: 4, score: 75, passed: true });
    expect(gradeGate('LISTENING', questions, { 1: 'b', 2: 'b' })).toMatchObject(
      { score: 50, passed: false },
    );
  });

  it('holds a retry for 24 hours after a failure', () => {
    const failed = new Date('2026-10-31T00:00:00Z');
    expect(
      gateRetryAt(failed, new Date('2026-10-31T23:00:00Z'))?.toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(gateRetryAt(failed, new Date('2026-11-01T00:00:01Z'))).toBeNull();
    expect(gateRetryAt(null)).toBeNull();
  });
});

function setup(overrides: { unlocked?: string; poolSize?: number } = {}) {
  const attempts: any[] = [];
  const size = overrides.poolSize ?? 10;
  const questions = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    quizId: 1,
    order: i,
  }));
  const skillRows = new Map<string, any>();
  const unlocks: any[] = [];
  const matches = (a: any, where: any) =>
    Object.entries(where).every(([k, v]) =>
      k === 'id' ? a.id === v : a[k] === v,
    );
  const gateAttempt = {
    findFirst: ({ where }: any) =>
      Promise.resolve(
        [...attempts].reverse().find((a) => matches(a, where)) ?? null,
      ),
    findUnique: ({ where }: any) =>
      Promise.resolve(attempts.find((a) => a.id === where.id) ?? null),
    findUniqueOrThrow: ({ where }: any) =>
      Promise.resolve(attempts.find((a) => a.id === where.id)),
    create: ({ data }: any) => {
      const row = {
        id: attempts.length + 1,
        submittedAt: null,
        passed: null,
        answers: null,
        ...data,
      };
      attempts.push(row);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: any) => {
      const row = attempts.find((a) => a.id === where.id);
      if (!row || row.submittedAt) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    },
  };
  const tx: any = {
    $executeRaw: jest.fn(),
    gateAttempt,
    learnerSkillLevel: {
      findUnique: () => Promise.resolve(skillRows.get('LISTENING') ?? null),
      upsert: ({ create, update }: any) => {
        const prev = skillRows.get('LISTENING');
        skillRows.set(
          'LISTENING',
          prev ? { ...prev, ...update } : { ...create },
        );
        return Promise.resolve();
      },
    },
    levelUnlock: {
      createMany: ({ data }: any) => {
        unlocks.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
  };
  const prisma: any = {
    ...tx,
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    quiz: {
      findMany: () =>
        Promise.resolve([{ title: 'Listening B1 — Work', questions }]),
    },
    question: {
      findMany: ({ where }: any) =>
        Promise.resolve(
          where.id.in.map((id: number) => ({
            id,
            quizId: 1,
            content: content(id),
          })),
        ),
    },
  };
  const unlocked = overrides.unlocked ?? 'BASIC';
  const levelAccess = {
    unlockedLevels: () =>
      Promise.resolve({
        LISTENING: unlocked,
        READING: unlocked,
        SPEAKING: unlocked,
        WRITING: unlocked,
      }),
  };
  return {
    service: new GateService(prisma, levelAccess as never),
    attempts,
    skillRows,
    unlocks,
  };
}

const allCorrect = (ids: number[]) =>
  Object.fromEntries(ids.map((id) => [String(id), 'b']));

describe('GateService', () => {
  it('targets the next level with up to 8 questions', async () => {
    const { service } = setup();
    expect(await service.status(7, 'LISTENING')).toMatchObject({
      available: true,
      targetLevel: 'INTERMEDIATE',
      questionCount: 8,
      passPercent: 75,
      retryAt: null,
    });
  });

  it('uses what there is when the pool is small', async () => {
    const { service } = setup({ poolSize: 5 });
    expect((await service.status(7, 'LISTENING')).questionCount).toBe(5);
  });

  it.each([
    ['SPEAKING', {}, 'PROGRESS_ONLY'],
    ['WRITING', {}, 'PROGRESS_ONLY'],
    ['LISTENING', { unlocked: 'ADVANCED' }, 'TOP_LEVEL'],
    ['LISTENING', { poolSize: 3 }, 'NO_QUESTIONS'],
  ])('has no gate for %s %o', async (skill, options, reason) => {
    const { service } = setup(options);
    expect(await service.status(7, skill as never)).toMatchObject({
      available: false,
      reason,
    });
  });

  it('serves questions without the key', async () => {
    const { service } = setup();
    const gate = await service.start(7, 'LISTENING');
    expect(gate.questions).toHaveLength(8);
    expect(JSON.stringify(gate)).not.toMatch(/correctIndex|explanation/);
  });

  it('resumes the unfinished attempt with the same questions', async () => {
    const { service, attempts } = setup();
    const first = await service.start(7, 'LISTENING');
    const second = await service.start(7, 'LISTENING');
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.questions.map((q) => q.id)).toEqual(
      first.questions.map((q) => q.id),
    );
    expect(attempts).toHaveLength(1);
  });

  it('opens the level on a pass, as GATE_TEST', async () => {
    const { service, skillRows, unlocks } = setup();
    const gate = await service.start(7, 'LISTENING');
    const result = await service.submit(
      7,
      gate.attemptId,
      allCorrect(gate.questions.map((q) => q.id)),
    );
    expect(result).toMatchObject({
      passed: true,
      score: 100,
      levelLabel: 'Trung cấp',
      retryAt: null,
    });
    expect(skillRows.get('LISTENING')).toMatchObject({
      unlockedLevel: 'INTERMEDIATE',
      level: 'INTERMEDIATE',
    });
    expect(unlocks.map((u) => u.method)).toContain('GATE_TEST');
    expect(result).not.toHaveProperty('questions');
  });

  it('holds the level on a fail and blocks a retry for 24 hours', async () => {
    const { service, skillRows } = setup();
    const gate = await service.start(7, 'LISTENING');
    const result = await service.submit(7, gate.attemptId, {});
    expect(result).toMatchObject({ passed: false, score: 0 });
    expect(result.retryAt).toBeInstanceOf(Date);
    expect(skillRows.size).toBe(0);
    expect((await service.status(7, 'LISTENING')).retryAt).toBeInstanceOf(Date);
    await expect(service.start(7, 'LISTENING')).rejects.toMatchObject({
      response: { error: { code: 'GATE_COOLDOWN' } },
    });
  });

  it('grades once: a resubmit returns the stored result', async () => {
    const { service, unlocks } = setup();
    const gate = await service.start(7, 'LISTENING');
    await service.submit(7, gate.attemptId, {});
    const again = await service.submit(
      7,
      gate.attemptId,
      allCorrect(gate.questions.map((q) => q.id)),
    );
    expect(again).toMatchObject({ passed: false, score: 0 });
    expect(unlocks).toHaveLength(0);
  });

  it("refuses another learner's attempt", async () => {
    const { service } = setup();
    const gate = await service.start(7, 'LISTENING');
    await expect(service.submit(8, gate.attemptId, {})).rejects.toThrow(
      'Không tìm thấy bài mở khoá',
    );
  });

  it('refuses to start where there is no gate', async () => {
    const { service } = setup();
    await expect(service.start(7, 'SPEAKING')).rejects.toMatchObject({
      response: { error: { code: 'GATE_UNAVAILABLE' } },
    });
  });
});
