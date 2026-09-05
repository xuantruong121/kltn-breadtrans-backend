import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
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
      },
      pointHistory: { create: jest.fn() },
      currencyTransaction: { create: jest.fn() },
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
          match: typeof match,
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
  });
});
