import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from './health.controller';

function setup(database: 'up' | 'down', cache: 'up' | 'down') {
  const prisma = {
    $queryRaw: jest.fn(() =>
      database === 'up'
        ? Promise.resolve([{ ok: 1 }])
        : Promise.reject(new Error('postgres://user:secret@db refused')),
    ),
  };
  const redis = {
    ping: jest.fn(() =>
      cache === 'up'
        ? Promise.resolve('PONG')
        : Promise.reject(new Error('redis refused')),
    ),
  };
  return new HealthController(prisma as never, redis as never);
}

describe('GET /api/health', () => {
  it('answers ok when PostgreSQL and Redis answer', async () => {
    await expect(setup('up', 'up').check()).resolves.toEqual({ status: 'ok' });
  });

  it('answers 503 when PostgreSQL is down', async () => {
    await expect(setup('down', 'up').check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 503 when Redis is down', async () => {
    await expect(setup('up', 'down').check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('never repeats the connection error to the caller', async () => {
    await expect(setup('down', 'up').check()).rejects.not.toThrow(/secret/);
  });
});
