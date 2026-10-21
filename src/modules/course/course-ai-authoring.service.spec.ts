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
    courseLessonSection: { createMany: jest.fn(), update: jest.fn() },
    courseLessonExercise: { create: jest.fn() },
  } as any;
  const prisma = {
    course: { findUnique: jest.fn() },
    courseLesson: { findMany: jest.fn(), findFirst: jest.fn() },
    courseLessonSection: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: any) => callback(tx)),
  } as any;
  const ai = {
    suggestCourseCurriculum: jest.fn(),
    suggestCourseLessonContent: jest.fn(),
    suggestCourseSectionRefinement: jest.fn(),
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

  it('adds only missing AI exercises and never overwrites manual exercises', async () => {
    tx.courseLesson.findFirst = jest.fn().mockResolvedValue({
      id: 9,
      sections: [],
      exercises: [{ id: 1, slug: 'guided-practice' }],
    });
    const candidateExercise = (title: string) => ({
      type: 'MULTIPLE_CHOICE' as any,
      title,
      prompt: 'Choose.',
      questions: [
        {
          prompt: 'I __ ready.',
          options: ['am', 'is'],
          correctAnswer: 'am',
          explanation: 'I takes am.',
        },
        {
          prompt: 'You __ ready.',
          options: ['am', 'are'],
          correctAnswer: 'are',
          explanation: 'You takes are.',
        },
        {
          prompt: 'She __ ready.',
          options: ['is', 'are'],
          correctAnswer: 'is',
          explanation: 'She takes is.',
        },
      ],
    });
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
          guidedPractice: candidateExercise('Guided practice'),
          finalCheck: candidateExercise('Final check'),
        },
        admin,
      ),
    ).resolves.toMatchObject({
      mode: 'APPLIED_TO_DRAFT',
      skippedExerciseSlugs: ['guided-practice'],
    });
    expect(tx.courseLessonExercise.create).toHaveBeenCalledTimes(1);
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
      exercises: [],
    });
    ai.suggestCourseLessonContent.mockResolvedValue({
      sections: [{ type: 'THEORY', heading: 'Rule', content: 'Use hello.' }],
      guidedPractice: {
        type: 'MULTIPLE_CHOICE',
        title: 'Guided practice',
        prompt: 'Choose.',
        questions: [],
      },
      finalCheck: {
        type: 'MULTIPLE_CHOICE',
        title: 'Final check',
        prompt: 'Choose.',
        questions: [],
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

  it('can generate a single missing exercise as a candidate without Draft writes', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 9,
      title: 'Greetings',
      summary: 'Basic greetings.',
      learningObjectives: ['Greet someone'],
      sections: [{ heading: 'Welcome' }],
      exercises: [],
    });
    ai.suggestCourseLessonContent.mockResolvedValue({
      sections: [{ type: 'THEORY', heading: 'Rule', content: 'Use hello.' }],
      guidedPractice: {
        type: 'MULTIPLE_CHOICE',
        title: 'Guided',
        prompt: 'Choose.',
        questions: [],
      },
      finalCheck: {
        type: 'MULTIPLE_CHOICE',
        title: 'Final',
        prompt: 'Choose.',
        questions: [],
      },
    });

    const result = await service.generateLessonContent(
      71,
      9,
      { scope: 'GUIDED_PRACTICE' },
      admin,
    );

    expect(result).toMatchObject({
      mode: 'CANDIDATE_ONLY',
      candidate: { candidateCourseId: 71, candidateLessonId: 9, sections: [] },
    });
    expect((result as any).candidate.finalCheck).toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves paragraphs, bullets, and examples through Apply instead of flattening to text', async () => {
    tx.courseLesson.findFirst = jest.fn().mockResolvedValue({
      id: 9,
      sections: [],
      exercises: [],
    });
    await service.applyLessonContent(
      71,
      9,
      {
        candidateCourseId: 71,
        candidateLessonId: 9,
        sections: [
          {
            type: 'THEORY',
            heading: 'Present simple',
            content: 'Use the base verb form for habits.',
            paragraphs: [
              'Use the base verb form for habits.',
              'Add -s for he/she/it.',
            ],
            bullets: ['Subject + verb', 'Add -s for third person'],
            examples: [
              {
                text: 'She works every day.',
                translation: 'Cô ấy làm việc mỗi ngày.',
                explanation: 'Third-person -s.',
              },
            ],
          },
        ],
      },
      admin,
    );
    expect(tx.courseLessonSection.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          content: {
            text: 'Use the base verb form for habits.',
            paragraphs: [
              'Use the base verb form for habits.',
              'Add -s for he/she/it.',
            ],
            bullets: ['Subject + verb', 'Add -s for third person'],
            examples: [
              {
                text: 'She works every day.',
                translation: 'Cô ấy làm việc mỗi ngày.',
                explanation: 'Third-person -s.',
              },
            ],
          },
        }),
      ],
    });
  });

  it('updates an existing Draft section in place when the candidate carries a sectionId', async () => {
    tx.courseLesson.findFirst = jest.fn().mockResolvedValue({
      id: 9,
      sections: [{ id: 501, heading: 'Present simple', type: 'THEORY' }],
      exercises: [],
    });
    const result = await service.applyLessonContent(
      71,
      9,
      {
        candidateCourseId: 71,
        candidateLessonId: 9,
        sections: [
          {
            type: 'THEORY',
            heading: 'Present simple',
            content: 'Expanded explanation.',
            sectionId: 501,
            bullets: ['New key point'],
          },
        ],
      },
      admin,
    );
    expect(tx.courseLessonSection.update).toHaveBeenCalledWith({
      where: { id: 501 },
      data: expect.objectContaining({
        heading: 'Present simple',
        content: expect.objectContaining({
          text: 'Expanded explanation.',
          bullets: ['New key point'],
        }),
      }),
    });
    expect(tx.courseLessonSection.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sectionsAdded: 0 });
  });

  it('preserves unmanaged legacy section extensions when an AI improvement updates it in place', async () => {
    tx.courseLesson.findFirst = jest.fn().mockResolvedValue({
      id: 9,
      sections: [
        {
          id: 501,
          heading: 'Present simple',
          type: 'THEORY',
          content: {
            text: 'Old text.',
            formulas: ['subject + verb'],
            items: [{ label: 'legacy' }],
            audioExamples: [
              { term: 'works', audioUrl: 'https://audio.example/works.mp3' },
            ],
            legacyExtension: { keep: true },
          },
        },
      ],
      exercises: [],
    });
    await service.applyLessonContent(
      71,
      9,
      {
        candidateCourseId: 71,
        candidateLessonId: 9,
        sections: [
          {
            type: 'THEORY',
            heading: 'Present simple',
            content: 'Updated text.',
            sectionId: 501,
          },
        ],
      },
      admin,
    );
    expect(tx.courseLessonSection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            text: 'Updated text.',
            formulas: ['subject + verb'],
            items: [{ label: 'legacy' }],
            audioExamples: [
              { term: 'works', audioUrl: 'https://audio.example/works.mp3' },
            ],
            legacyExtension: { keep: true },
          }),
        }),
      }),
    );
  });

  it('generates a section-level refinement candidate without touching the Draft', async () => {
    prisma.courseLessonSection.findFirst.mockResolvedValue({
      id: 501,
      type: 'THEORY',
      heading: 'Present simple',
      content: { text: 'Use the base verb form.' },
      lesson: {
        title: 'Daily routines',
        learningObjectives: ['Describe daily habits'],
      },
    });
    ai.suggestCourseSectionRefinement.mockResolvedValue({
      type: 'THEORY',
      heading: 'Present simple',
      content: 'Use the base verb form for habits, and add -s for he/she/it.',
      bullets: ['Subject + verb', 'Add -s for third person'],
    });
    const result = await service.refineLessonSection(
      71,
      9,
      501,
      { action: 'EXPAND' },
      admin,
    );
    expect(ai.suggestCourseSectionRefinement).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXPAND' }),
    );
    expect(result).toMatchObject({
      mode: 'CANDIDATE_ONLY',
      candidate: {
        candidateCourseId: 71,
        candidateLessonId: 9,
        scope: 'SECTION_REFINE',
        action: 'EXPAND',
        sections: [expect.objectContaining({ sectionId: 501 })],
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('surfaces deterministic thin-content warnings on the generated candidate', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 9,
      title: 'Greetings',
      summary: 'Basic greetings.',
      learningObjectives: ['Greet someone'],
      sections: [],
      exercises: [],
    });
    ai.suggestCourseLessonContent.mockResolvedValue({
      sections: [{ type: 'THEORY', heading: 'Rule', content: 'Use hello.' }],
      guidedPractice: {
        type: 'MULTIPLE_CHOICE',
        title: 'Guided',
        prompt: 'Choose.',
        questions: [],
      },
      finalCheck: {
        type: 'MULTIPLE_CHOICE',
        title: 'Final',
        prompt: 'Choose.',
        questions: [],
      },
    });
    const result = await service.generateLessonContent(71, 9, {}, admin);
    expect((result as any).candidate.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Lý thuyết')]),
    );
  });
});
