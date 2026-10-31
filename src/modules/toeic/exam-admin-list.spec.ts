import { examListFacets, filterExamList } from './exam-admin-list';

const exam = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Đề ${id}`,
  publicationStatus: 'DRAFT',
  familyCode: 'TOEIC',
  variantCode: 'TOEIC_LR',
  learnerReady: false,
  totalQuestions: 100,
  updatedAt: `2026-10-0${id}`,
  ...extra,
});

describe('admin exam list rules', () => {
  const exams = [
    exam(1, { publicationStatus: 'PUBLISHED', learnerReady: true }),
    exam(2, { variantCode: 'TOEIC_SW', totalQuestions: 19 }),
    exam(3, {
      title: 'Mini test',
      description: 'Part 5 nhanh',
      totalQuestions: 30,
    }),
  ];

  it('filters by search, status, family, variant and readiness', () => {
    const ids = (q: Record<string, string>) =>
      filterExamList(exams, q).map((e) => e.id);
    expect(ids({})).toEqual([3, 2, 1]);
    expect(ids({ q: 'part 5' })).toEqual([3]);
    expect(ids({ status: 'PUBLISHED' })).toEqual([1]);
    expect(ids({ variant: 'TOEIC_SW' })).toEqual([2]);
    expect(ids({ family: 'IELTS' })).toEqual([]);
    expect(ids({ ready: 'READY' })).toEqual([1]);
    expect(ids({ ready: 'NOT_READY' })).toEqual([3, 2]);
  });

  it('sorts by edit date, title or question count', () => {
    const ids = (sort: string) =>
      filterExamList(exams, { sort }).map((e) => e.id);
    expect(ids('TITLE')).toEqual([1, 2, 3]);
    expect(ids('QUESTIONS')).toEqual([1, 3, 2]);
  });

  it('counts every exam for the header', () => {
    expect(examListFacets(exams)).toEqual({
      total: 3,
      published: 1,
      learnerReady: 1,
    });
  });
});
