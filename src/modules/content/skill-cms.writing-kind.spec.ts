import { QuizType, Role } from '@prisma/client';

import { SkillCmsService } from './skill-cms.service';

/**
 * The editor reads an exercise's kind from GET :domain/:id (owner 2026-11-20):
 * a new "Dịch câu" exercise has no sentence yet, so only its topic tells it
 * from a picture exercise; without it the AI draft panel did not open.
 */
describe('SkillCmsService.get writing kind', () => {
  const admin = { id: 1, role: Role.ADMIN };
  const build = (quiz: Record<string, unknown>) => {
    const prisma = {
      quiz: { findFirst: jest.fn().mockResolvedValue(quiz) },
      practiceTopic: {
        findFirst: jest.fn().mockResolvedValue({ id: 77 }),
      },
      contentTrackTag: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new SkillCmsService(prisma as any);
  };
  const quiz = (extra: Record<string, unknown>) => ({
    id: 5,
    title: 'Bài',
    type: QuizType.WRITING_PICTURE,
    theoryContent: null,
    practiceTopicId: null,
    questions: [],
    _count: { submissions: 0 },
    ...extra,
  });

  it('reads an empty exercise in the translation topic as TRANSLATION', async () => {
    const item: any = await build(quiz({ practiceTopicId: 77 })).get(
      'writing',
      '5',
      admin,
    );
    expect(item.writingKind).toBe('TRANSLATION');
  });

  it('reads a picture task with an image as PICTURE, an email as EMAIL', async () => {
    const picture: any = await build(
      quiz({
        questions: [
          {
            content: {
              taskType: 'PICTURE_SENTENCE',
              imageUrl: 'https://cdn.example/a.png',
            },
          },
        ],
      }),
    ).get('writing', '5', admin);
    expect(picture.writingKind).toBe('PICTURE');
    const email: any = await build(quiz({ type: QuizType.WRITING_EMAIL })).get(
      'writing',
      '5',
      admin,
    );
    expect(email.writingKind).toBe('EMAIL');
  });
});

describe('SkillCmsService.list writing kind counts', () => {
  it('counts each kind over the whole Writing list for the header', async () => {
    const prisma = {
      quiz: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            title: 'A',
            type: QuizType.WRITING_PICTURE,
            practiceTopicId: 77,
          },
          {
            id: 2,
            title: 'B',
            type: QuizType.WRITING_PICTURE,
            practiceTopicId: 77,
          },
          {
            id: 3,
            title: 'C',
            type: QuizType.WRITING_EMAIL,
            practiceTopicId: 9,
          },
          {
            id: 4,
            title: 'D',
            type: QuizType.WRITING_PICTURE,
            practiceTopicId: 9,
          },
        ]),
      },
      question: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { quizId: 4, content: { taskType: 'SENTENCE' } },
          ]),
      },
      practiceTopic: { findFirst: jest.fn().mockResolvedValue({ id: 77 }) },
      contentTrackTag: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const page: any = await new SkillCmsService(prisma as any).list(
      'writing',
      { id: 1, role: Role.ADMIN },
      { page: '1', kind: 'EMAIL' },
    );
    expect(page.items.map((item: { id: number }) => item.id)).toEqual([3]);
    expect(page.facets.kinds).toEqual({
      TRANSLATION: 2,
      PICTURE: 0,
      SENTENCE: 1,
      EMAIL: 1,
    });
  });
});
