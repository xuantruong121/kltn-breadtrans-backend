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

  // QA 2026-11-22: "Viết câu" saved with Lưu reopened as "Viết theo tranh",
  // and an empty picture exercise came back as SENTENCE.
  it('reads the kind saved with the exercise before guessing from its tasks', async () => {
    const sentence: any = await build(
      quiz({ bilingualContent: { writingKind: 'SENTENCE' } }),
    ).get('writing', '5', admin);
    expect(sentence.writingKind).toBe('SENTENCE');
    const picture: any = await build(quiz({})).get('writing', '5', admin);
    expect(picture.writingKind).toBe('PICTURE');
  });

  it('saves the picked kind in bilingualContent on create and on update', async () => {
    const prisma = {
      quiz: {
        create: jest.fn().mockResolvedValue({ id: 9 }),
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          title: 'Writing A2 — Câu',
          type: QuizType.WRITING_PICTURE,
          bilingualContent: { note: 'kept' },
        }),
        update: jest.fn().mockResolvedValue({ id: 9 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);
    await service.create(
      'writing',
      { title: 'Câu', type: 'WRITING_PICTURE', writingKind: 'SENTENCE' },
      admin,
    );
    expect(prisma.quiz.create.mock.calls[0][0].data.bilingualContent).toEqual({
      writingKind: 'SENTENCE',
    });
    await service.update(
      'writing',
      '9',
      { title: 'Câu', type: 'WRITING_PICTURE', writingKind: 'PICTURE' },
      admin,
    );
    expect(prisma.quiz.update.mock.calls[0][0].data.bilingualContent).toEqual({
      note: 'kept',
      writingKind: 'PICTURE',
    });
  });

  it('leaves bilingualContent alone when no kind is sent', async () => {
    const prisma = { quiz: { create: jest.fn().mockResolvedValue({ id: 9 }) } };
    await new SkillCmsService(prisma as any).create(
      'writing',
      { title: 'Email', type: 'WRITING_EMAIL' },
      admin,
    );
    expect(
      prisma.quiz.create.mock.calls[0][0].data.bilingualContent,
    ).toBeUndefined();
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
