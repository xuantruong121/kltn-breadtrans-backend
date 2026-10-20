import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CourseStatus, Role } from '@prisma/client';
import { CourseAiAuthoringService } from './course-ai-authoring.service';

const admin = { id: 1, role: Role.ADMIN };
const candidate = {
  candidateCourseId: 71,
  lessons: [
    {
      title: 'Greetings at work',
      summary: 'Use greetings in a short workplace exchange.',
      objectives: ['Greet a colleague'],
      sections: [
        { type: 'INTRO', heading: 'Goal', content: 'Learn a greeting.' },
        { type: 'EXAMPLE', heading: 'Model', content: 'Good morning.' },
      ],
    },
  ],
};

describe('CourseAiAuthoringService', () => {
  const tx = {
    courseLesson: { count: jest.fn(), create: jest.fn() },
    courseLessonSection: { createMany: jest.fn() },
    courseLessonExercise: { create: jest.fn() },
  } as any;
  const prisma = {
    course: { findUnique: jest.fn() },
    courseLesson: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((callback: any) => callback(tx)),
  } as any;
  const ai = {
    suggestCourseCurriculum: jest.fn(),
    suggestCourseLessonContent: jest.fn(),
  } as any;
  const service = new CourseAiAuthoringService(prisma, ai);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.course.findUnique.mockResolvedValue({
      id: 71,
      title: 'QA course',
      status: CourseStatus.DRAFT,
      level: 'BEGINNER',
      description: null,
    });
    prisma.courseLesson.findMany.mockResolvedValue([]);
    tx.courseLesson.count.mockResolvedValue(0);
    tx.courseLesson.create.mockResolvedValue({ id: 101 });
    tx.courseLessonSection.createMany.mockResolvedValue({ count: 2 });
  });

  it('keeps curriculum generation as a candidate without Course writes', async () => {
    ai.suggestCourseCurriculum.mockResolvedValue({
      candidates: candidate.lessons,
    });
    const result = await service.generateCurriculum(71, {}, admin);
    expect(result).toMatchObject({
      mode: 'CANDIDATE_ONLY',
      candidate: { candidateCourseId: 71 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires explicit Draft-only Apply and safely rejects a repeated Apply', async () => {
    await expect(
      service.applyCurriculum(71, candidate as any, admin),
    ).resolves.toMatchObject({ mode: 'APPLIED_TO_DRAFT' });
    expect(tx.courseLesson.create).toHaveBeenCalledTimes(1);
    tx.courseLesson.count.mockResolvedValueOnce(1);
    await expect(
      service.applyCurriculum(71, candidate as any, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.courseLesson.create).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong candidate context, published Course, and non-Admin Apply', async () => {
    await expect(
      service.applyCurriculum(72, candidate as any, admin),
    ).rejects.toThrow('Candidate không thuộc');
    prisma.course.findUnique.mockResolvedValueOnce({
      id: 71,
      status: CourseStatus.PUBLISHED,
    });
    await expect(
      service.applyCurriculum(71, candidate as any, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.applyCurriculum(71, candidate as any, {
        id: 2,
        role: Role.STUDENT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks Lesson Apply when the target already has manual exercises', async () => {
    tx.courseLesson.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 9, sections: [], exercises: [{ id: 1 }] });
    await expect(
      service.applyLessonContent(
        71,
        9,
        {
          candidateCourseId: 71,
          candidateLessonId: 9,
          sections: [
            { type: 'THEORY' as any, heading: 'Rule', content: 'Use be.' },
          ],
          exercise: {
            type: 'MULTIPLE_CHOICE' as any,
            title: 'Check',
            prompt: 'Choose.',
            question: {
              prompt: 'I __ ready.',
              options: ['am', 'is'],
              correctAnswer: 'am',
              explanation: 'I takes am.',
            },
          },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the Draft untouched when the provider returns malformed output or times out', async () => {
    ai.suggestCourseCurriculum.mockRejectedValueOnce(
      new Error('AI không thể tạo curriculum hợp lệ'),
    );
    await expect(service.generateCurriculum(71, {}, admin)).rejects.toThrow(
      'AI không thể tạo curriculum hợp lệ',
    );
    ai.suggestCourseCurriculum.mockRejectedValueOnce(
      new Error('Gemini timeout'),
    );
    await expect(service.generateCurriculum(71, {}, admin)).rejects.toThrow(
      'Gemini timeout',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.courseLesson.create).not.toHaveBeenCalled();
  });

  it('keeps lesson generation candidate-only and rejects a candidate for another lesson', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 9,
      title: 'Greetings',
      summary: 'Basic greetings.',
      learningObjectives: ['Greet someone'],
      sections: [],
    });
    ai.suggestCourseLessonContent.mockResolvedValue({
      sections: [{ type: 'THEORY', heading: 'Rule', content: 'Use hello.' }],
      exercise: {
        type: 'MULTIPLE_CHOICE',
        title: 'Check',
        prompt: 'Choose.',
        question: {
          prompt: 'Hello is a __.',
          options: ['greeting', 'number'],
          correctAnswer: 'greeting',
          explanation: 'Hello is a greeting.',
        },
      },
    });
    const result = await service.generateLessonContent(71, 9, {}, admin);
    expect(result).toMatchObject({
      mode: 'CANDIDATE_ONLY',
      candidate: { candidateCourseId: 71, candidateLessonId: 9 },
    });
    await expect(
      service.applyLessonContent(
        71,
        10,
        { ...(result as any).candidate },
        admin,
      ),
    ).rejects.toThrow('Candidate không thuộc');
  });
});
