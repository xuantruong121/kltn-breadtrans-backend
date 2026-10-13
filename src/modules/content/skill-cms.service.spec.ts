import { ForbiddenException } from '@nestjs/common';
import { QuizPublicationStatus, Role, QuizType } from '@prisma/client';
import { SkillCmsService } from './skill-cms.service';

describe('SkillCmsService', () => {
  const admin = { id: 7, role: Role.ADMIN };

  it('requires an admin for domain content access', async () => {
    const service = new SkillCmsService({} as any);
    await expect(
      service.list('reading', { id: 1, role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps new quiz content in DRAFT and binds it to the domain type', async () => {
    const prisma = {
      quiz: {
        create: jest.fn().mockResolvedValue({
          id: 11,
          publicationStatus: QuizPublicationStatus.DRAFT,
          type: QuizType.BILINGUAL_READING,
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    await service.create('reading', { title: 'QA Reading' }, admin);
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('rejects a Reading publish preflight with an invalid answer index', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 12,
          title: 'Reading',
          theoryContent: 'Passage',
          questions: [
            {
              id: 1,
              type: 'MULTIPLE_CHOICE',
              content: { options: ['A'], correctIndex: 2 },
              order: 0,
            },
          ],
          _count: { submissions: 0 },
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    const result = await service.validate('reading', '12', admin);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('options/correctIndex');
  });

  it('does not let a content PATCH bypass publish preflight', async () => {
    const prisma = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 13, type: QuizType.BILINGUAL_READING }),
        update: jest.fn().mockResolvedValue({ id: 13 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);
    await service.update(
      'reading',
      '13',
      {
        title: 'Reading',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
      admin,
    );
    expect(prisma.quiz.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        }),
      }),
    );
  });
});
