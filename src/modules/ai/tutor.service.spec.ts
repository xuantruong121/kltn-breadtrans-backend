import { TutorService } from './tutor.service';

describe('TutorService', () => {
  const store = new Map<string, number>();
  const redis = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    incr: jest.fn((k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return Promise.resolve(store.get(k));
    }),
    decr: jest.fn((k: string) => {
      store.set(k, (store.get(k) ?? 0) - 1);
      return Promise.resolve(store.get(k));
    }),
    expire: jest.fn(() => Promise.resolve(1)),
  };
  const ai = { tutorChat: jest.fn() };
  const plan = (code: string) => ({
    resolveEffectivePlan: jest.fn().mockResolvedValue({ plan: { code } }),
  });
  const make = (code = 'FREE') =>
    new TutorService(ai as any, redis as any, plan(code) as any);

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    ai.tutorChat.mockResolvedValue('Câu trả lời.');
  });

  it('answers and counts one question against the plan limit', async () => {
    const res = await make('PLUS').reply(7, { message: 'hi' });
    expect(res).toEqual({
      reply: 'Câu trả lời.',
      quota: { limit: 30, remaining: 29 },
      limited: false,
    });
    expect(ai.tutorChat).toHaveBeenCalledWith(expect.stringContaining('hi'));
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it('stops at the free limit without calling the provider', async () => {
    const tutor = make('FREE');
    for (let i = 0; i < 10; i++) await tutor.reply(7, { message: 'q' });
    ai.tutorChat.mockClear();

    const res = await tutor.reply(7, { message: 'one more' });

    expect(res.limited).toBe(true);
    expect(res.quota).toEqual({ limit: 10, remaining: 0 });
    expect(res.reply).toContain('10 lượt');
    expect(ai.tutorChat).not.toHaveBeenCalled();
  });

  it('gives a Pro learner a hundred and counts learners apart', async () => {
    const tutor = make('PRO');
    await tutor.reply(7, { message: 'q' });
    expect((await tutor.quota(7)).remaining).toBe(99);
    expect((await tutor.quota(8)).remaining).toBe(100);
  });

  it('does not charge a question when the provider fails', async () => {
    ai.tutorChat.mockRejectedValue(new Error('provider down'));
    const tutor = make('FREE');

    const res = await tutor.reply(7, { message: 'q' });

    expect(res.limited).toBe(false);
    expect(res.reply).toContain('không trả lời được');
    expect((await tutor.quota(7)).remaining).toBe(10);
  });

  it('falls back to the free limit when the plan cannot be read', async () => {
    const tutor = new TutorService(
      ai as any,
      redis as any,
      {
        resolveEffectivePlan: jest.fn().mockRejectedValue(new Error('db')),
      } as any,
    );
    expect((await tutor.quota(7)).limit).toBe(10);
  });
});
