import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WordBlasterService } from './word-blaster.service';
import { landsAt, type BlasterBlock } from './word-blaster.logic';

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

const entries = Array.from({ length: 30 }, (_, i) => {
  const w = `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
  return {
    id: i + 1,
    headword: w,
    displayWord: w,
    pos: 'noun',
    meaningVi: `nghĩa số ${i}`,
    exampleEn: null,
    ipaUs: null,
    ipaUk: null,
    deckWords: [
      { topic: { id: 1 + (i % 3), level: ['A2', 'B1', 'B2'][i % 3] } },
    ],
  };
});

describe('WordBlasterService', () => {
  let redis: FakeRedis;
  let gamification: {
    deductBanh: jest.Mock;
    awardBanh: jest.Mock;
    awardXp: jest.Mock;
  };
  let service: WordBlasterService;
  let now: number;

  beforeEach(() => {
    redis = new FakeRedis();
    now = 1_000_000;
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
    };
    const prisma = {
      dictionaryEntry: { findMany: jest.fn().mockResolvedValue(entries) },
      pointHistory: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
      },
    };
    service = new WordBlasterService(
      prisma as never,
      redis as never,
      gamification as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const stored = (id: string) =>
    JSON.parse(redis.store.get(`blaster:session:${id}`)!) as {
      blocks: BlasterBlock[];
    };

  it('refuses a stake outside 20/50/100 and a short balance, taking nothing', async () => {
    await expect(service.start(1, 30, 'copy')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    gamification.deductBanh.mockResolvedValueOnce({
      success: false,
      newBalance: 5,
      message: 'Không đủ',
    });
    await expect(service.start(1, 20, 'copy')).rejects.toThrow('Không đủ');
    expect(redis.store.size).toBe(0);
  });

  it('starts a game: stake taken once, no answer sent, the open game comes back', async () => {
    const view = await service.start(1, 20, 'copy');
    expect(gamification.deductBanh).toHaveBeenCalledWith(
      1,
      20,
      expect.any(String),
      'BLASTER_STAKE',
      `blaster:${view.sessionId}:stake`,
      expect.anything(),
    );
    expect(view.blocks).toHaveLength(20);
    const json = JSON.stringify(view);
    expect(json).not.toContain('answers');
    expect(json).not.toContain('meaningVi');
    const again = await service.start(1, 50, 'copy');
    expect(again.sessionId).toBe(view.sessionId);
    expect(gamification.deductBanh).toHaveBeenCalledTimes(1);
  });

  it('only the owner can shoot', async () => {
    const view = await service.start(1, 20, 'copy');
    await expect(service.shot(2, view.sessionId, 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('breaking every block wins: stake back, half as a capped bonus, XP, paid once', async () => {
    const view = await service.start(1, 50, 'copy');
    const blocks = stored(view.sessionId).blocks;
    for (const b of blocks) {
      now = 1_000_000 + b.spawnAtMs + 100;
      const res = await service.shot(1, view.sessionId, b.answers[0]);
      expect(res.hitBlockId).toBe(b.id);
    }
    const last = await service.finish(1, view.sessionId, false);
    expect(last.result).toMatchObject({
      outcome: 'win',
      destroyed: 20,
      net: 25,
      xp: 40,
    });
    // The Arena only plays with dictionary words: no word list, nothing to review.
    expect(last.result).not.toHaveProperty('words');
    expect(gamification.awardBanh).toHaveBeenCalledTimes(2);
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      50,
      'BLASTER_RETURN',
      `blaster:${view.sessionId}:return`,
      expect.objectContaining({ isCapped: false }),
    );
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      25,
      'BLASTER_WIN',
      `blaster:${view.sessionId}:win`,
      expect.objectContaining({ isCapped: true }),
    );
    // A second finish pays nothing more.
    await service.finish(1, view.sessionId, false);
    expect(gamification.awardBanh).toHaveBeenCalledTimes(2);
    expect(redis.store.has('blaster:user:1')).toBe(false);
  });

  it('a wrong answer breaks nothing', async () => {
    const view = await service.start(1, 20, 'copy');
    now += 3000;
    const res = await service.shot(1, view.sessionId, 'not a word here');
    expect(res.hitBlockId).toBeNull();
    expect(res.result).toBeNull();
  });

  it('leaving loses at once and pays nothing', async () => {
    const view = await service.start(1, 20, 'copy');
    const res = await service.finish(1, view.sessionId, true);
    expect(res.result).toMatchObject({
      outcome: 'lose',
      forfeit: true,
      net: -20,
    });
    expect(gamification.awardBanh).not.toHaveBeenCalled();
  });

  it('a game left alone is settled by the sweep once every block has landed', async () => {
    const view = await service.start(1, 20, 'copy');
    const blocks = stored(view.sessionId).blocks;
    expect(await service.sweepExpired()).toBe(0);
    now = 1_000_000 + Math.max(...blocks.map(landsAt)) + 10_000;
    expect(await service.sweepExpired()).toBe(1);
    const settled = JSON.parse(
      redis.store.get(`blaster:session:${view.sessionId}`)!,
    );
    expect(settled.result).toMatchObject({ outcome: 'lose', destroyed: 0 });
    expect(gamification.awardBanh).not.toHaveBeenCalled();
    expect(await service.sweepExpired()).toBe(0);
  });
});
