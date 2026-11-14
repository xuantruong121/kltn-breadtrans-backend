import { Role, QuizType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { WritingQuestionDto } from './skill-cms.dto';
import { SkillCmsService } from './skill-cms.service';

const admin = { id: 7, role: Role.ADMIN };

const translationDto = {
  type: 'WRITING',
  taskType: 'SENTENCE_TRANSLATION',
  prompt: 'Mẹ tôi là giáo viên.',
  level: 'A1',
  acceptedAnswers: [' My mother is a teacher. ', 'My mom is a teacher.', ''],
  hints: [
    { vi: 'giáo viên', en: 'teacher' },
    { vi: ' ', en: 'x' },
  ],
  grammarTip: ' Nghề nghiệp cần "a/an". ',
};

describe('Dịch câu in the skill CMS', () => {
  it('stores the answers, hints and tip of a translation sentence on a WRITING_PICTURE quiz', async () => {
    const prisma = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 91, type: QuizType.WRITING_PICTURE }),
      },
      question: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    await new SkillCmsService(prisma as any).addWritingQuestion(
      '91',
      translationDto,
      admin,
    );
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: {
          skill: 'WRITING',
          taskType: 'SENTENCE_TRANSLATION',
          prompt: 'Mẹ tôi là giáo viên.',
          level: 'A1',
          acceptedAnswers: ['My mother is a teacher.', 'My mom is a teacher.'],
          hints: [{ vi: 'giáo viên', en: 'teacher' }],
          grammarTip: 'Nghề nghiệp cần "a/an".',
        },
      }),
    });
  });

  it('keeps dismissed translations when a sentence is edited', async () => {
    const prisma = {
      question: {
        findFirst: jest.fn().mockResolvedValue({
          id: 501,
          type: 'WRITING',
          content: {
            taskType: 'SENTENCE_TRANSLATION',
            dismissedAnswers: ['my mother teacher'],
          },
          quiz: { type: QuizType.WRITING_PICTURE },
        }),
        update: jest.fn().mockResolvedValue({ id: 501 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    await new SkillCmsService(prisma as any).updateWritingQuestion(
      '91',
      '501',
      translationDto,
      admin,
    );
    const content = prisma.question.update.mock.calls[0][0].data.content;
    expect(content.dismissedAnswers).toEqual(['my mother teacher']);
    expect(content.acceptedAnswers).toHaveLength(2);
  });

  it('refuses a translation sentence on an e-mail quiz', async () => {
    const prisma = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 17, type: QuizType.WRITING_EMAIL }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
      question: { findFirst: jest.fn() },
    };
    await expect(
      new SkillCmsService(prisma as any).addWritingQuestion(
        '17',
        translationDto,
        admin,
      ),
    ).rejects.toThrow('task family của dạng tranh');
  });

  it('creates a translation exercise on WRITING_PICTURE in the Sentence Translation topic', async () => {
    const prisma = {
      practiceTopic: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 11 }),
      },
      quiz: { create: jest.fn().mockResolvedValue({ id: 99 }) },
    };
    await new SkillCmsService(prisma as any).create(
      'writing',
      { title: 'Dịch câu: Nhà hàng', level: 'A2', writingKind: 'TRANSLATION' },
      admin,
    );
    expect(prisma.practiceTopic.create).toHaveBeenCalledWith({
      data: {
        name: 'Sentence Translation',
        category: 'WRITING_PART1',
        vietnameseName: 'Dịch câu',
      },
      select: { id: true },
    });
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: QuizType.WRITING_PICTURE,
          practiceTopicId: 11,
        }),
      }),
    );
  });

  it('never puts a new picture exercise in the Sentence Translation topic', async () => {
    const prisma = {
      practiceTopic: {
        findMany: jest.fn().mockResolvedValue([
          { id: 11, name: 'Sentence Translation' },
          { id: 6, name: 'Writing Sentence' },
        ]),
      },
      quiz: { create: jest.fn().mockResolvedValue({ id: 100 }) },
    };
    await new SkillCmsService(prisma as any).create(
      'writing',
      { title: 'Tranh: Văn phòng', level: 'A2', type: 'WRITING_PICTURE' },
      admin,
    );
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ practiceTopicId: 6 }),
      }),
    );
  });

  it('blocks publishing a translation sentence that misses answers, hints or the tip', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 91,
          type: QuizType.WRITING_PICTURE,
          title: 'Writing A1 — Dịch câu: Gia đình',
          questions: [
            {
              id: 501,
              type: 'WRITING',
              content: {
                taskType: 'SENTENCE_TRANSLATION',
                prompt: 'Mẹ tôi là giáo viên.',
                acceptedAnswers: ['My mother is a teacher.'],
                hints: [],
                grammarTip: '',
              },
              order: 0,
            },
          ],
          _count: { submissions: 0 },
        }),
      },
      toeicWritingSetItem: { count: jest.fn().mockResolvedValue(0) },
    };
    const result = await new SkillCmsService(prisma as any).validate(
      'writing',
      '91',
      admin,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Câu 1: Cần ít nhất 2 đáp án tiếng Anh',
        'Câu 1: Cần ít nhất 1 gợi ý từ vựng',
        'Câu 1: Cần lưu ý ngữ pháp',
      ]),
    );
  });

  it('the DTO accepts answers, hints and a tip, and refuses an over-long answer list', async () => {
    const ok = plainToInstance(WritingQuestionDto, translationDto);
    expect(await validate(ok)).toEqual([]);
    const tooMany = plainToInstance(WritingQuestionDto, {
      ...translationDto,
      acceptedAnswers: Array.from({ length: 11 }, (_, i) => `Answer ${i}`),
    });
    expect((await validate(tooMany)).map((e) => e.property)).toEqual([
      'acceptedAnswers',
    ]);
  });
});
