import { ForbiddenException } from '@nestjs/common';
import { CourseStatus, Role } from '@prisma/client';
import { CourseAiWorkspaceService } from './course-ai-workspace.service';

const admin = { id: 7, role: Role.ADMIN };

function redisFake() {
  const data = new Map<string, string>();
  return {
    get: jest.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve('OK');
    }),
  } as any;
}

describe('CourseAiWorkspaceService', () => {
  const redis = redisFake();
  const graph = {
    id: 17,
    title: 'AI demo',
    description: 'Demo',
    level: 'BEGINNER',
    thumbnail: null,
    status: CourseStatus.DRAFT,
    courseLessons: [
      {
        id: 71,
        order: 0,
        title: 'Greetings',
        summary: 'Learn greetings.',
        learningObjectives: ['Greet people'],
        status: 'DRAFT',
        requiresFinalCheck: true,
        sections: [
          {
            id: 1,
            isRequired: true,
            content: { paragraphs: ['Hello'] },
            type: 'THEORY',
            heading: 'Greeting',
            order: 0,
          },
        ],
        media: [],
        exercises: [],
      },
    ],
  } as any;
  const prisma = {
    course: { findUnique: jest.fn() },
    courseLesson: { findFirst: jest.fn() },
  } as any;
  const authoring = {
    generateCurriculum: jest.fn(),
    generateLessonContent: jest.fn(),
    applyCurriculum: jest.fn(),
    applyLessonContent: jest.fn(),
  } as any;
  const media = {
    searchCourseCover: jest.fn(),
    generateCourseCoverImage: jest.fn(),
    searchLessonMedia: jest.fn(),
    generateLessonMediaImage: jest.fn(),
    acceptCourseCover: jest.fn(),
    acceptGeneratedCourseCover: jest.fn(),
    acceptLessonMedia: jest.fn(),
    acceptGeneratedLessonMedia: jest.fn(),
  } as any;
  const service = new CourseAiWorkspaceService(redis, prisma, authoring, media);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.course.findUnique.mockResolvedValue(graph);
    prisma.courseLesson.findFirst.mockResolvedValue(graph.courseLessons[0]);
  });

  it('builds a deterministic audit without any AI/provider call', async () => {
    const audit = await service.audit(17, admin);
    expect(audit.suggestedTasks.map((task: any) => task.type)).toEqual(
      expect.arrayContaining([
        'GUIDED_PRACTICE_CREATE',
        'FINAL_CHECK_CREATE',
        'LESSON_IMAGE_SEARCH',
      ]),
    );
    expect(authoring.generateLessonContent).not.toHaveBeenCalled();
    expect(media.searchLessonMedia).not.toHaveBeenCalled();
  });

  it('runs only selected bounded task candidates and does not apply Draft content', async () => {
    authoring.generateLessonContent.mockResolvedValue({
      mode: 'CANDIDATE_ONLY',
      candidate: {
        candidateCourseId: 17,
        candidateLessonId: 71,
        guidedPractice: { questions: [] },
      },
    });
    const workspace = await service.create(17, admin);
    const task = workspace.tasks.find(
      (item: any) => item.type === 'GUIDED_PRACTICE_CREATE',
    );
    expect(task).toBeDefined();
    const result = await service.run(17, workspace.id, [task!.id], admin);
    expect(authoring.generateLessonContent).toHaveBeenCalledWith(
      17,
      71,
      { scope: 'GUIDED_PRACTICE' },
      admin,
    );
    expect(authoring.applyLessonContent).not.toHaveBeenCalled();
    expect(result.tasks.find((item: any) => item.id === task!.id)?.status).toBe(
      'CANDIDATE_READY',
    );
  });

  it('binds a Redis workspace to the creating admin and course', async () => {
    const workspace = await service.create(17, admin);
    await expect(
      service.get(17, workspace.id, { id: 8, role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get(18, workspace.id, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
