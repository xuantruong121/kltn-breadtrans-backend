import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { LocationService } from '../location/location.service';
import { ReadingService } from '../reading/reading.service';
import { UserService } from './user.service';

/**
 * getLearningHistory: one page of whole learner days, plus the 7-day strip
 * counted over every row. The SQL that counts rows per learner day is checked
 * against a real database separately; here its answer is supplied.
 */
describe('UserService.getLearningHistory', () => {
  const row = (id: number, occurredAt: string, type = 'QUIZ') => ({
    id,
    userId: 7,
    type,
    title: `Activity ${id}`,
    detail: null,
    score: null,
    durationSec: null,
    sourceType: null,
    sourceId: null,
    occurredAt: new Date(occurredAt),
  });

  let service: UserService;
  let queryRaw: jest.Mock;
  let findMany: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-28T05:00:00Z')); // 12:00 on 28/11 in Vietnam
    queryRaw = jest.fn();
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: queryRaw,
      learningActivity: { findMany, groupBy: jest.fn().mockResolvedValue([]) },
      userStats: {
        findUnique: jest.fn().mockResolvedValue({ streakCount: 3 }),
      },
      diagnosticAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      submission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: ReadingService, useValue: {} },
        { provide: LocationService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(UserService);
  });

  afterEach(() => jest.useRealTimers());

  const perDay = [
    { dayKey: '2026-11-28', count: 12 },
    { dayKey: '2026-11-27', count: 12 },
    { dayKey: '2026-11-26', count: 5 },
    { dayKey: '2026-11-25', count: 30 },
    { dayKey: '2026-11-24', count: 1 },
  ];

  it('asks for the first page by default and sends no upper edge on it', async () => {
    queryRaw.mockResolvedValue(perDay);
    findMany.mockResolvedValue([
      row(2, '2026-11-28T02:00:00Z'),
      row(1, '2026-11-27T02:00:00Z'),
    ]);
    const result = await service.getLearningHistory(7);

    expect(result.pagination).toEqual({ page: 1, pageCount: 3, totalRows: 60 });
    const where = findMany.mock.calls[0][0].where;
    // Page 1 holds 28/11 and 27/11: from 00:01 on 27/11 in Vietnam, no upper edge.
    expect(where.occurredAt.gte).toEqual(new Date('2026-11-26T17:01:00Z'));
    expect(where.occurredAt).not.toHaveProperty('lt');
    expect(result.activities.map((a) => a.dayKey)).toEqual([
      '2026-11-28',
      '2026-11-27',
    ]);
    expect(result.summary.completedCount).toBe(60);
  });

  it('asks for a later page with both edges, on whole learner days', async () => {
    queryRaw.mockResolvedValue(perDay);
    await service.getLearningHistory(7, undefined, 2);

    const where = findMany.mock.calls[0][0].where;
    // Page 2 holds 26/11 and 25/11.
    expect(where.occurredAt.gte).toEqual(new Date('2026-11-24T17:01:00Z'));
    expect(where.occurredAt.lt).toEqual(new Date('2026-11-26T17:01:00Z'));
  });

  it('keeps the type filter on the rows', async () => {
    queryRaw.mockResolvedValue(perDay);
    await service.getLearningHistory(7, 'DIAGNOSTIC', 1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      userId: 7,
      type: 'DIAGNOSTIC',
    });
  });

  it('puts a page number outside the range on the nearest page that exists', async () => {
    queryRaw.mockResolvedValue(perDay);
    expect(
      (await service.getLearningHistory(7, undefined, 99)).pagination.page,
    ).toBe(3);
    expect(
      (await service.getLearningHistory(7, undefined, 0)).pagination.page,
    ).toBe(1);
  });

  it('returns an empty page, not an error, for a learner with no history', async () => {
    queryRaw.mockResolvedValue([]);
    const result = await service.getLearningHistory(7);
    expect(result.activities).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, pageCount: 0, totalRows: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(result.weekly).toHaveLength(7);
    expect(result.weekly.every((d) => d.count === 0)).toBe(true);
  });

  it('counts the 7-day strip over every row, not only the page, in learner days', async () => {
    queryRaw.mockResolvedValue(perDay);
    const result = await service.getLearningHistory(7, undefined, 3);
    expect(result.weekly).toEqual([
      { dayKey: '2026-11-22', count: 0 },
      { dayKey: '2026-11-23', count: 0 },
      { dayKey: '2026-11-24', count: 1 },
      { dayKey: '2026-11-25', count: 30 },
      { dayKey: '2026-11-26', count: 5 },
      { dayKey: '2026-11-27', count: 12 },
      { dayKey: '2026-11-28', count: 12 },
    ]);
  });

  it('puts a row made in the first minute after midnight in the day before', async () => {
    queryRaw.mockResolvedValue([{ dayKey: '2026-11-27', count: 1 }]);
    // 00:00:30 on 28/11 Vietnam = 17:00:30 on 27/11 UTC: still learner day 27/11.
    findMany.mockResolvedValue([row(1, '2026-11-27T17:00:30Z')]);
    const result = await service.getLearningHistory(7);
    expect(result.activities[0].dayKey).toBe('2026-11-27');
  });
});
