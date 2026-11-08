import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Socket } from 'socket.io';
import { ArenaGateway } from './arena.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from './events.gateway';

describe('ArenaGateway security validation', () => {
  let gateway: ArenaGateway;
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    redis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      rpush: jest.fn(),
      llen: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArenaGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn() } },
        },
        { provide: EventsGateway, useValue: { sendCurrencyUpdate: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: getRedisConnectionToken('default'), useValue: redis },
      ],
    }).compile();
    gateway = module.get(ArenaGateway);
  });

  it.each([-20, 20.5, 9999])(
    'rejects invalid stake %p before queue mutation',
    async (stake) => {
      const socket: Partial<Socket> = {
        data: { user: { userId: 1, role: 'STUDENT' } },
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleJoinQueue(socket as Socket, {
        stake,
        gameId: 'vocab-duel',
      });

      expect(socket.emit).toHaveBeenCalledWith('arena:error', {
        message: 'Mức cược không hợp lệ.',
      });
      expect(redis.sadd).not.toHaveBeenCalled();
    },
  );

  it('draws questions from the published decks of reviewed curated words', async () => {
    const levels = ['A2', 'B1', 'B2'];
    const entries = Array.from({ length: 30 }, (_, i) => {
      const word = `word${String.fromCharCode(97 + (i % 26))}${i}`.replace(
        /\d/g,
        (d) => 'abcdefghij'[Number(d)],
      );
      return {
        id: i + 1,
        headword: word,
        displayWord: word,
        pos: 'noun',
        meaningVi: `nghĩa ${i}`,
        exampleEn: `The ${word} is ready.`,
        ipaUs: null,
        ipaUk: null,
        deckWords: [{ topic: { level: levels[i % 3] } }],
      };
    });
    const prisma = {
      dictionaryEntry: { findMany: jest.fn().mockResolvedValue(entries) },
    };
    (gateway as unknown as { prisma: unknown }).prisma = prisma;

    const questions = await (
      gateway as unknown as {
        fetchArenaQuestions: (
          count: number,
        ) => Promise<{ id: number; options: string[] }[]>;
      }
    ).fetchArenaQuestions(10);

    expect(prisma.dictionaryEntry.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dictionaryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'APPROVED',
          source: 'CURATED',
          deckWords: { some: { topic: { publicationStatus: 'PUBLISHED' } } },
        },
      }),
    );
    expect(questions).toHaveLength(10);
    for (const q of questions) expect(new Set(q.options).size).toBe(4);
  });

  it('falls back to every reviewed word when the decks are too small', async () => {
    const prisma = {
      dictionaryEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    (gateway as unknown as { prisma: unknown }).prisma = prisma;
    const questions = await (
      gateway as unknown as {
        fetchArenaQuestions: (
          count: number,
        ) => Promise<{ ipa: string | null }[]>;
      }
    ).fetchArenaQuestions(10);
    expect(prisma.dictionaryEntry.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.dictionaryEntry.findMany).toHaveBeenLastCalledWith({
      where: { status: 'APPROVED', source: 'CURATED' },
    });
    // The fixed sentences never show the answer's pronunciation.
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) expect(q.ipa).toBeNull();
  });

  it('rejects an unapproved game id', async () => {
    const socket: Partial<Socket> = {
      data: { user: { userId: 1, role: 'STUDENT' } },
      emit: jest.fn(),
    };

    await gateway.handleJoinQueue(socket as Socket, {
      stake: 20,
      gameId: 'forged-game',
    });

    expect(socket.emit).toHaveBeenCalledWith('arena:error', {
      message: 'Loại trò chơi không hợp lệ.',
    });
    expect(redis.sadd).not.toHaveBeenCalled();
  });

  it('allows only one concurrent settlement claimant', async () => {
    let lockCalls = 0;
    redis.set.mockImplementation((key: string) => {
      if (key.startsWith('arena:lock:settle:')) {
        lockCalls += 1;
        return lockCalls === 1 ? 'OK' : null;
      }
      return 'OK';
    });
    redis.eval = jest.fn().mockResolvedValue(1);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx: any = {
      gameBattle: { updateMany },
      userStats: {
        update: jest.fn().mockResolvedValue({ totalBanhRan: 120 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ totalBanhRan: 90 }),
      },
      pointHistory: { create: jest.fn() },
      currencyTransaction: { create: jest.fn() },
      banhTransaction: { create: jest.fn(), createMany: jest.fn() },
    };
    const gatewayInternals = gateway as unknown as {
      prisma: { $transaction: jest.Mock };
      server: { to: jest.Mock };
    };
    const prisma = gatewayInternals.prisma;
    prisma.$transaction = jest.fn((callback: (client: any) => unknown) =>
      callback(tx),
    );
    gatewayInternals.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    const match: any = {
      matchId: 'match-concurrent',
      stake: 10,
      p1: { userId: 1, userName: 'P1', score: 10 },
      p2: { userId: 2, userName: 'P2', score: 5 },
      isSettled: false,
    };
    const finalizeMatch = (
      gateway as unknown as {
        finalizeMatch: (
          targetMatch: any,
          winnerRole: 'p1' | 'p2' | 'draw',
          isForfeit: boolean,
        ) => Promise<void>;
      }
    ).finalizeMatch.bind(gateway);
    await Promise.all([
      finalizeMatch(match, 'p1', false),
      finalizeMatch(match, 'p1', false),
    ]);

    expect(updateMany).toHaveBeenCalledTimes(1);
    // The win pays Bread once (BanhTransaction ARENA_WIN) and writes nothing
    // to the XP log.
    expect(tx.banhTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.banhTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 20, source: 'ARENA_WIN' }),
      }),
    );
    expect(tx.pointHistory.create).not.toHaveBeenCalled();
  });

  it('leave_match ends the match at once: the rival wins by forfeit', async () => {
    const match = {
      matchId: 'match-leave',
      stake: 50,
      p1: { userId: 1, userName: 'P1', score: 300, answers: {} },
      p2: { userId: 2, userName: 'P2', score: 0, answers: {} },
      isSettled: false,
    };
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'arena:match:match-leave' ? JSON.stringify(match) : null,
      ),
    );
    const internals = gateway as unknown as {
      authUser: jest.Mock;
      finalizeMatch: jest.Mock;
    };
    internals.authUser = jest.fn().mockResolvedValue({ userId: 1 });
    internals.finalizeMatch = jest.fn().mockResolvedValue(undefined);
    const socket = { emit: jest.fn() } as unknown as Socket;

    await gateway.handleLeaveMatch(socket, { matchId: 'match-leave' });

    expect(internals.finalizeMatch).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match-leave' }),
      'p2',
      true,
      'left',
    );
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('leave_match from someone outside the match changes nothing', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        matchId: 'm',
        p1: { userId: 1 },
        p2: { userId: 2 },
        isSettled: false,
      }),
    );
    const internals = gateway as unknown as {
      authUser: jest.Mock;
      finalizeMatch: jest.Mock;
    };
    internals.authUser = jest.fn().mockResolvedValue({ userId: 9 });
    internals.finalizeMatch = jest.fn();
    const socket = { emit: jest.fn() } as unknown as Socket;

    await gateway.handleLeaveMatch(socket, { matchId: 'm' });

    expect(internals.finalizeMatch).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('arena:error', expect.anything());
  });

  it('pays 5 XP per correct answer to both players, up to 150 Arena XP a day', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval = jest.fn().mockResolvedValue(1);
    const tx: any = {
      gameBattle: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userStats: {
        update: jest.fn().mockResolvedValue({ totalBanhRan: 120 }),
      },
      currencyTransaction: { create: jest.fn() },
      banhTransaction: { create: jest.fn() },
    };
    // Player 2 already has 140 Arena XP today.
    const aggregate = jest.fn(({ where }: { where: { userId: number } }) =>
      Promise.resolve({ _sum: { points: where.userId === 2 ? 140 : null } }),
    );
    const awardXp = jest.fn().mockResolvedValue({});
    const emit = jest.fn();
    const withXp = gateway as unknown as {
      prisma: Record<string, unknown>;
      server: unknown;
      gamification: unknown;
      finalizeMatch: (
        m: any,
        w: 'p1' | 'p2' | 'draw',
        f: boolean,
      ) => Promise<void>;
    };
    withXp.prisma.$transaction = jest.fn((cb: (c: any) => unknown) => cb(tx));
    withXp.prisma.pointHistory = { aggregate };
    withXp.server = { to: jest.fn().mockReturnValue({ emit }) };
    withXp.gamification = { awardXp };

    const answers = (correct: number) =>
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          i,
          {
            isCorrect: i < correct,
            selectedOption: 'x',
            addedPoints: 0,
            answeredAt: 0,
          },
        ]),
      );
    await withXp.finalizeMatch.call(
      gateway,
      {
        matchId: 'match-xp',
        stake: 20,
        p1: { userId: 1, userName: 'P1', score: 900, answers: answers(7) },
        p2: { userId: 2, userName: 'P2', score: 300, answers: answers(4) },
        isSettled: false,
      },
      'p1',
      false,
    );

    expect(awardXp).toHaveBeenCalledWith(1, 35, 'Đấu trường từ vựng');
    expect(awardXp).toHaveBeenCalledWith(2, 10, 'Đấu trường từ vựng');
    const ended = emit.mock.calls.find((c) => c[0] === 'arena:match_ended')![1];
    expect(ended.forfeitReason).toBeNull();
    expect(ended.p1).toMatchObject({ xp: 35, xpCapped: false });
    expect(ended.p2).toMatchObject({ xp: 10, xpCapped: true });
  });
});
