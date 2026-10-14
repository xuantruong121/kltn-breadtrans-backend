import { Role } from '@prisma/client';
import { CourseLearningV5Service } from './course-v5.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseService } from './course.service';

describe('CourseLearningV5Service', () => {
  const prisma: any = {
    courseLesson: { findMany: jest.fn(), findFirst: jest.fn() },
    courseLessonAttempt: { findMany: jest.fn() },
    courseLessonExercise: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const courseService: any = { getCourseById: jest.fn() };
  let service: CourseLearningV5Service;
  const user = { id: 7, role: Role.STUDENT };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CourseLearningV5Service(
      prisma as PrismaService,
      courseService as CourseService,
    );
    courseService.getCourseById.mockResolvedValue({
      id: 1,
      title: 'Course',
      description: 'Description',
      level: 'A2',
      canAccess: true,
    });
  });

  it('opens any published lesson without sequential locking and hides answer keys', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 12,
      courseId: 1,
      slug: 'lesson-2',
      order: 2,
      title: 'Lesson',
      summary: 'Summary',
      learningObjectives: [],
      estimatedMinutes: 15,
      difficulty: 'A2',
      coverImage: null,
      sections: [],
      references: [],
      media: [],
      exercises: [
        {
          id: 44,
          slug: 'practice',
          order: 1,
          type: 'MULTIPLE_CHOICE',
          title: 'Practice',
          prompt: 'Prompt',
          instructions: null,
          content: {
            audioUrl: 'https://cdn.example/audio.mp3',
            listeningScript: 'Nora: private transcript',
            transcript: 'private transcript alias',
          },
          rubric: { criteria: ['clarity'] },
          required: true,
          minimumScore: null,
          questions: [
            {
              id: 88,
              order: 1,
              prompt: 'Question',
              options: ['A', 'B'],
              correctAnswer: 'A',
              explanation: 'Because',
            },
          ],
        },
      ],
    });
    prisma.courseLesson.findMany.mockResolvedValue([
      { id: 11, order: 1, title: 'One' },
      { id: 12, order: 2, title: 'Two' },
    ]);
    prisma.courseLessonAttempt.findMany.mockResolvedValue([]);
    const result = await service.getLesson(1, 12, user);
    expect(result.lesson.exercises[0].questions[0]).not.toHaveProperty(
      'correctAnswer',
    );
    expect(result.lesson.exercises[0].questions[0]).not.toHaveProperty(
      'explanation',
    );
    expect(result.lesson.exercises[0].content).toEqual({
      audioUrl: 'https://cdn.example/audio.mp3',
    });
    expect(result.lesson.exercises[0]).toHaveProperty('rubric');
  });

  it('returns guided and final exercises once with distinct question identities', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 12,
      courseId: 1,
      slug: 'present-simple',
      order: 1,
      title: 'Present simple',
      summary: 'Summary',
      learningObjectives: [],
      estimatedMinutes: 15,
      difficulty: 'A2',
      coverImage: null,
      sections: [],
      references: [],
      media: [],
      exercises: [
        {
          id: 44,
          slug: 'practice-present-simple',
          order: 1,
          type: 'MULTIPLE_CHOICE',
          title: 'Guided practice',
          prompt: 'Practice',
          instructions: null,
          content: {},
          rubric: null,
          required: true,
          minimumScore: null,
          questions: [
            {
              id: 88,
              order: 1,
              prompt: 'She ____ coffee every morning.',
              options: ['drink', 'drinks'],
            },
          ],
        },
        {
          id: 45,
          slug: 'checkpoint-present-simple',
          order: 2,
          type: 'CHECKPOINT',
          title: 'Final check',
          prompt: 'Check',
          instructions: null,
          content: {},
          rubric: null,
          required: true,
          minimumScore: null,
          questions: [
            {
              id: 89,
              order: 1,
              prompt: 'Look! Minh ___ for the bus now.',
              options: ['waits', 'is waiting'],
            },
          ],
        },
      ],
    });
    prisma.courseLesson.findMany.mockResolvedValue([
      { id: 12, order: 1, title: 'Present simple' },
    ]);
    prisma.courseLessonAttempt.findMany.mockResolvedValue([]);

    const result = await service.getLesson(1, 12, user);
    expect(result.lesson.exercises).toHaveLength(2);
    expect(result.lesson.exercises.map((exercise) => exercise.id)).toEqual([
      44, 45,
    ]);
    expect(result.lesson.exercises[0].questions[0].id).not.toBe(
      result.lesson.exercises[1].questions[0].id,
    );
    expect(result.lesson.exercises[1].questions[0].prompt).not.toBe(
      result.lesson.exercises[0].questions[0].prompt,
    );
  });

  it('scores course-owned answers in a transaction and returns explanations only after submission', async () => {
    prisma.courseLessonExercise.findFirst.mockResolvedValue({
      id: 44,
      lessonId: 12,
      minimumScore: null,
      questions: [
        {
          id: 88,
          order: 1,
          prompt: 'Question',
          options: ['A', 'B'],
          correctAnswer: 'A',
          explanation: 'Correct context',
        },
      ],
    });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          courseLessonAttempt: {
            create: jest.fn().mockResolvedValue({ id: 99 }),
          },
        }),
    );
    const result = await service.submitExercise(1, 12, 44, user, {
      answers: [{ questionId: 88, answer: 'A' }],
    });
    expect(result.completed).toBe(true);
    expect(result.feedback[0].explanation).toBe('Correct context');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, duplicate, and foreign question ids before any transaction', async () => {
    prisma.courseLessonExercise.findFirst.mockResolvedValue({
      id: 44,
      lessonId: 12,
      questions: [{ id: 88, correctAnswer: 'A', explanation: '' }],
    });
    await expect(
      service.submitExercise(1, 12, 44, user, { answers: [] }),
    ).rejects.toThrow();
    await expect(
      service.submitExercise(1, 12, 44, user, {
        answers: [
          { questionId: 88, answer: 'A' },
          { questionId: 88, answer: 'A' },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      service.submitExercise(1, 12, 44, user, {
        answers: [{ questionId: 999, answer: 'A' }],
      }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an option that is not part of the current question before persistence', async () => {
    prisma.courseLessonExercise.findFirst.mockResolvedValue({
      id: 44,
      lessonId: 12,
      questions: [
        {
          id: 88,
          order: 1,
          options: ['A', 'B'],
          correctAnswer: 'A',
          explanation: '',
        },
      ],
    });
    await expect(
      service.submitExercise(1, 12, 44, user, {
        answers: [{ questionId: 88, answer: 'C' }],
      }),
    ).rejects.toThrow('Lựa chọn không hợp lệ');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reuses a matching submitted attempt under the transaction lock', async () => {
    prisma.courseLessonExercise.findFirst.mockResolvedValue({
      id: 44,
      lessonId: 12,
      minimumScore: null,
      questions: [
        {
          id: 88,
          order: 1,
          options: ['A', 'B'],
          correctAnswer: 'A',
          explanation: 'Because',
        },
      ],
    });
    const create = jest.fn();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          $executeRaw: jest.fn(),
          courseLessonAttempt: {
            findFirst: jest.fn().mockResolvedValue({
              id: 101,
              answers: [{ questionId: 88, answer: 'A' }],
            }),
            create,
          },
        }),
    );
    const result = await service.submitExercise(1, 12, 44, user, {
      answers: [{ questionId: 88, answer: 'A' }],
    });
    expect(result.attemptId).toBe(101);
    expect(create).not.toHaveBeenCalled();
  });
});
