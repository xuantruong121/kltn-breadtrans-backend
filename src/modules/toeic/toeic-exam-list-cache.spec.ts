import { ToeicService } from './toeic.service';

/** Capacity run 2026-11-09: the learner exam list is cached for 60 s. */
describe('TOEIC exam list cache', () => {
  const exam = {
    id: 1,
    title: 'Đề 1',
    description: null,
    type: 'FULL_TEST',
    difficulty: 'medium',
    durationSeconds: 7200,
    publicationStatus: 'PUBLISHED',
    groups: [],
  };
  const make = () => {
    const prisma = {
      toeicExamSet: { findMany: jest.fn().mockResolvedValue([exam]) },
    };
    return { prisma, service: new ToeicService(prisma as never, {} as never) };
  };

  afterEach(() => jest.useRealTimers());

  it('serves learners the same list for 60 s without asking the database again', async () => {
    const { prisma, service } = make();
    const first = await service.getExams(false);
    const second = await service.getExams(false);
    expect(second).toBe(first);
    expect(prisma.toeicExamSet.findMany).toHaveBeenCalledTimes(1);
    expect(first[0]).toMatchObject({ id: 1, title: 'Đề 1' });
  });

  it('reloads the learner list after 60 s', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const { prisma, service } = make();
    await service.getExams(false);
    jest.setSystemTime(1_000_000 + ToeicService.LEARNER_EXAM_LIST_TTL_MS + 1);
    await service.getExams(false);
    expect(prisma.toeicExamSet.findMany).toHaveBeenCalledTimes(2);
  });

  it('never caches the staff list (drafts included, always fresh)', async () => {
    const { prisma, service } = make();
    await service.getExams(true);
    await service.getExams(true);
    expect(prisma.toeicExamSet.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.toeicExamSet.findMany.mock.calls[0][0].where).toEqual({});
  });
});
