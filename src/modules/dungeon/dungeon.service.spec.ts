import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DungeonService } from './dungeon.service';
import {
  monsterHit,
  type BankEntry,
  type DungeonQuestion,
  type RunState,
} from './dungeon.logic';

/** Just enough of ioredis for the service, in memory. */
class FakeRedis {
  store = new Map<string, string>();
  zset = new Map<string, number>();
  get(key: string) {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.store.has(key))
      return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve('OK');
  }
  del(key: string) {
    this.store.delete(key);
    return Promise.resolve(1);
  }
  /** The lock release script only: delete KEYS[1] while it holds ARGV[1]. */
  eval(_script: string, _n: number, key: string, owner: string) {
    if (this.store.get(key) !== owner) return Promise.resolve(0);
    this.store.delete(key);
    return Promise.resolve(1);
  }
  exists(key: string) {
    return Promise.resolve(this.store.has(key) ? 1 : 0);
  }
  zadd(_key: string, score: number, member: string) {
    this.zset.set(member, score);
    return Promise.resolve(1);
  }
  zrem(_key: string, member: string) {
    this.zset.delete(member);
    return Promise.resolve(1);
  }
  zrangebyscore(_key: string, min: number, max: number) {
    return Promise.resolve(
      [...this.zset].filter(([, s]) => s >= min && s <= max).map(([m]) => m),
    );
  }
}

const name = (i: number) =>
  `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
// Shuffled ids: the bank must not depend on the order the database returns.
const entries = Array.from({ length: 120 }, (_, i) => ({
  id: ((i * 37) % 120) + 1,
  headword: name(i),
  displayWord: name(i),
  pos: 'noun',
  meaningVi: `nghĩa số ${i}`,
  exampleEn: null,
  ipaUs: null,
  ipaUk: null,
  deckWords: [{ topic: { id: 1 + (i % 3), level: ['A2', 'B1', 'B2'][i % 3] } }],
}));

type Stored = {
  run: RunState;
  bank: BankEntry[];
  question: { q: DungeonQuestion; bankIndex: number; issuedAt: number } | null;
};

describe('DungeonService', () => {
  let redis: FakeRedis;
  let events: { userId: number; type: string; value: number }[];
  let gamification: {
    deductBanh: jest.Mock;
    awardBanh: jest.Mock;
    awardXp: jest.Mock;
    awardArenaXp: jest.Mock;
  };
  let service: DungeonService;
  let now: number;
  let findMany: jest.Mock;
  let hardWords: jest.Mock;

  beforeEach(() => {
    redis = new FakeRedis();
    events = [];
    now = Date.parse('2026-11-09T03:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    gamification = {
      deductBanh: jest
        .fn()
        .mockResolvedValue({ success: true, newBalance: 80 }),
      awardBanh: jest
        .fn()
        .mockImplementation((_u, amount) =>
          Promise.resolve({ granted: amount }),
        ),
      awardXp: jest.fn().mockResolvedValue({}),
      // The real one reads today's Arena XP and awards under one lock.
      awardArenaXp: jest
        .fn()
        .mockImplementation(
          (_u: number, _r: string, xpFor: (earned: number) => number) =>
            Promise.resolve(xpFor(0)),
        ),
    };
    findMany = jest.fn().mockResolvedValue(entries);
    // The learner's hard flashcard words; none unless a test says so.
    hardWords = jest.fn().mockResolvedValue([]);
    const prisma = {
      dictionaryEntry: { findMany },
      userVocabWordProgress: { findMany: hardWords },
      pointHistory: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
      },
      learnerEvent: {
        create: jest.fn().mockImplementation(({ data }) => {
          events.push(data);
          return Promise.resolve(data);
        }),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              events.find(
                (e) => e.userId === where.userId && e.type === where.type,
              ) ?? null,
            ),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockImplementation(({ where }) => {
          const mine = events.filter(
            (e) => e.userId === where.userId && e.type === where.type,
          );
          return Promise.resolve({
            _max: {
              value: mine.length ? Math.max(...mine.map((e) => e.value)) : null,
            },
          });
        }),
      },
    };
    service = new DungeonService(
      prisma as never,
      redis as never,
      gamification as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const stored = (id: string) =>
    JSON.parse(redis.store.get(`dungeon:run:${id}`)!) as Stored;
  const patch = (id: string, change: (s: Stored) => void) => {
    const s = JSON.parse(redis.store.get(`dungeon:run:${id}`)!);
    change(s);
    redis.store.set(`dungeon:run:${id}`, JSON.stringify(s));
  };
  const rightAnswer = (id: string) => {
    const q = stored(id).question!.q;
    return q.type === 'choice' ? { choice: q.correct } : { text: q.answers[0] };
  };
  const wrongAnswer = (id: string) => {
    const q = stored(id).question!.q;
    return q.type === 'choice'
      ? { choice: (q.correct + 1) % 4 }
      : { text: 'zzzz' };
  };

  it('opens a run: the ticket is taken once, the question carries no answer, the open run comes back', async () => {
    const view = await service.start(1, 'free');
    expect(gamification.deductBanh).toHaveBeenCalledWith(
      1,
      20,
      expect.any(String),
      'DUNGEON_STAKE',
      `dungeon:${view.sessionId}:stake`,
      expect.anything(),
    );
    expect(view.phase).toBe('fight');
    // The first question's clock starts after the intro, not while the page shows it.
    expect(view.questionStartsAt).toBe(now + 4000);
    expect(view.questionDeadline).toBe(now + 4000 + 10_000);
    expect(view.question?.type).toBe('choice');
    // The question itself carries no answer; stats.correct is the count of right answers.
    expect(JSON.stringify(view.question)).not.toMatch(
      /correct|answers|display/,
    );
    expect(JSON.stringify(view)).not.toMatch(/answers|bank|"display"/);
    const again = await service.start(1, 'daily');
    expect(again.sessionId).toBe(view.sessionId);
    expect(gamification.deductBanh).toHaveBeenCalledTimes(1);
  });

  it('a short balance takes nothing and frees the day dungeon again', async () => {
    gamification.deductBanh.mockResolvedValueOnce({
      success: false,
      newBalance: 5,
      message: 'Không đủ',
    });
    await expect(service.start(1, 'daily')).rejects.toThrow('Không đủ');
    await service.start(1, 'daily');
    expect(gamification.deductBanh).toHaveBeenCalledTimes(2);
  });

  it('two starts of the free dungeon at once pay one ticket and open one run (audit R5)', async () => {
    const [a, b] = await Promise.all([
      service.start(1, 'free'),
      service.start(1, 'free'),
    ]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(gamification.deductBanh).toHaveBeenCalledTimes(1);
  });

  it('the day dungeon is the same for everyone, whatever order the words come in', async () => {
    const a = await service.start(1, 'daily');
    findMany.mockResolvedValue([...entries].reverse());
    const b = await service.start(2, 'daily');
    expect(b.question).toEqual(a.question);
    expect(b.monster).toEqual(a.monster);
  });

  it('the day dungeon is once a day', async () => {
    const view = await service.start(1, 'daily');
    await service.finish(1, view.sessionId, true);
    await expect(service.start(1, 'daily')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.start(1, 'free')).resolves.toBeDefined();
  });

  it('only the owner can answer', async () => {
    const view = await service.start(1, 'free');
    await expect(
      service.answer(2, view.sessionId, { choice: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('right answers hit the monster; a wrong one or a timeout costs health', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    now += 1500;
    const hit = await service.answer(1, id, rightAnswer(id));
    expect(hit.last?.right).toBe(true);
    expect(hit.monster.hp).toBeLessThan(view.monster.hp);
    now += 1500;
    const miss = await service.answer(1, id, wrongAnswer(id));
    expect(miss.last?.right).toBe(false);
    expect(miss.hp).toBe(100 - monsterHit(1, false, {}));
    now += 1000;
    const timeout = await service.answer(1, id, {});
    expect(timeout.last?.timedOut).toBe(true);
  });

  it('a monster down offers toppings; only an offered one is taken, then the next floor', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    patch(id, (s) => {
      s.run.monster.hp = 1;
    });
    const down = await service.answer(1, id, rightAnswer(id));
    expect(down.phase).toBe('pick');
    expect(down.offers).toHaveLength(3);
    expect(down.question).toBeNull();
    const notOffered = ['garlic_butter', 'egg', 'cucumber', 'pate'].find(
      (t) => !down.offers.some((o) => o.id === t),
    )!;
    await expect(
      service.pick(1, id, notOffered as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    const next = await service.pick(1, id, down.offers[0].id);
    expect(next.floor).toBe(2);
    expect(next.phase).toBe('fight');
    expect(next.question).not.toBeNull();
    // The map was on the topping screen: the floor opens briefly, no second map.
    expect(next.questionStartsAt! - next.serverNow).toBe(2000);
  });

  it('a boss wants the word typed; beating it then falling pays the ticket back and 10, once', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    patch(id, (s) => {
      s.run.floor = 5;
      s.run.monster = { kind: 'sourdough_king', hp: 1, maxHp: 264, boss: true };
      s.question = null;
    });
    // A new question for the boss floor.
    patch(id, () => undefined);
    const s = stored(id);
    expect(s.run.monster.boss).toBe(true);
    // Ask again so the boss gets a typed question.
    const svc = service as unknown as {
      ask: (x: unknown) => void;
      store: (x: unknown) => Promise<void>;
    };
    const raw = JSON.parse(redis.store.get(`dungeon:run:${id}`)!);
    svc.ask(raw);
    await svc.store(raw);
    expect(stored(id).question!.q.type).toBe('typed');
    const boss = await service.answer(1, id, rightAnswer(id));
    expect(boss.stats.bossesDown).toBe(1);
    // A free run's seed is random, and about one run in twenty offers Trứng
    // ốp la first; it revives once, so the fall below would not end the run.
    const notEgg = boss.offers.find((o) => o.id !== 'egg')!;
    const next = await service.pick(1, id, notEgg.id);
    patch(id, (x) => {
      x.run.hp = 1;
      x.run.shieldsLeft = 0;
    });
    const end = await service.answer(1, id, wrongAnswer(id));
    expect(next.floor).toBe(6);
    expect(end.result?.floor).toBe(6);
    expect(end.result?.net).toBe(10);
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      20,
      'DUNGEON_RETURN',
      `dungeon:${id}:return`,
      expect.objectContaining({ isCapped: false }),
    );
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      10,
      'DUNGEON_WIN',
      `dungeon:${id}:win`,
      expect.objectContaining({ isCapped: true, bucket: 'ARENA' }),
    );
    await service.finish(1, id, true);
    expect(gamification.awardBanh).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ userId: 1, type: 'DUNGEON_FREE', value: 6 }]);
    expect(end.result?.record).toBe(true);
  });

  it('leaving early keeps the ticket and records the floor', async () => {
    const view = await service.start(1, 'daily');
    const left = await service.finish(1, view.sessionId, true);
    expect(left.result?.forfeit).toBe(true);
    expect(left.result?.net).toBe(-20);
    expect(gamification.awardBanh).not.toHaveBeenCalled();
    expect(events).toEqual([{ userId: 1, type: 'DUNGEON_DAILY', value: 1 }]);
    expect(await service.current(1)).toBeNull();
  });

  it('a run left alone is settled by the sweep', async () => {
    const view = await service.start(1, 'free');
    expect(await service.sweepIdle(now + 60_000)).toBe(0);
    expect(await service.sweepIdle(now + 4 * 60_000)).toBe(1);
    expect(stored(view.sessionId)).toMatchObject({
      result: expect.objectContaining({ floor: 1 }),
    });
  });

  describe("the learner's hard flashcard words (thesis supervisor 2026-11-26)", () => {
    const hardRow = (entryId: number) => ({
      lapses: 1,
      easeFactor: 2.3,
      nextReviewAt: new Date(0),
      word: { entryId },
    });

    it('a free run asks them within the first 20 questions', async () => {
      hardWords.mockResolvedValue([hardRow(5), hardRow(17), hardRow(33)]);
      const view = await service.start(1, 'free');
      const bank = stored(view.sessionId).bank;
      const flagged = bank
        .map((entry, i) => (entry.oftenForgotten ? i : -1))
        .filter((i) => i >= 0);
      expect(flagged).toEqual([3, 10, 16]);
      expect(
        flagged
          .map((i) => (bank[i].choice as { wordId: number }).wordId)
          .sort(),
      ).toEqual([17, 33, 5].sort());
      // Each of the three is asked once in the bank.
      const ids = bank.map((e) => (e.choice as { wordId: number }).wordId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(JSON.stringify(view)).not.toMatch(/answers|bank|"display"/);
    });

    it('the day dungeon stays the same for everyone and reads no hard words', async () => {
      const plain = await service.start(1, 'daily');
      hardWords.mockResolvedValue([hardRow(5), hardRow(17)]);
      const other = await service.start(2, 'daily');
      expect(hardWords).not.toHaveBeenCalled();
      expect(other.question).toEqual(plain.question);
      expect(
        stored(other.sessionId).bank.some((entry) => entry.oftenForgotten),
      ).toBe(false);
      expect(stored(other.sessionId).bank).toEqual(
        stored(plain.sessionId).bank,
      );
    });

    it('the result counts the hard words answered right the first time', async () => {
      const view = await service.start(1, 'free');
      const id = view.sessionId;
      // Make the question now out one of the learner's hard words.
      patch(id, (s) => {
        const at = (s.question as { bankIndex: number }).bankIndex;
        s.bank[at].oftenForgotten = true;
      });
      now += 5000;
      await service.answer(1, id, rightAnswer(id));
      const end = await service.finish(1, id, true);
      expect(end.result?.hardWords).toEqual({ hit: 1, total: 1 });
    });

    it('still opens a free run when the hard words cannot be read', async () => {
      hardWords.mockRejectedValue(new Error('db busy'));
      const view = await service.start(1, 'free');
      expect(view.phase).toBe('fight');
      expect(
        stored(view.sessionId).bank.some((entry) => entry.oftenForgotten),
      ).toBe(false);
    });
  });
});
