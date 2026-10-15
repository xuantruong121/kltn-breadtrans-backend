import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

const emptyTrackingPrisma = () => ({
  user: { findUnique: jest.fn() },
  courseLesson: { findMany: jest.fn().mockResolvedValue([]) },
  submission: { findMany: jest.fn().mockResolvedValue([]) },
  listeningPracticeAttempt: { findMany: jest.fn().mockResolvedValue([]) },
  speakingSubmission: { findMany: jest.fn().mockResolvedValue([]) },
  userVocabWordProgress: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  grammarAttempt: { findMany: jest.fn().mockResolvedValue([]) },
  toeicAttempt: { findMany: jest.fn().mockResolvedValue([]) },
  learningActivity: { findMany: jest.fn().mockResolvedValue([]) },
});

const createService = (prisma: any) =>
  new AdminService(prisma, {} as any, {} as any, {} as any, undefined);

const learner = (overrides: any = {}) => ({
  id: 7,
  email: 'learner@example.com',
  role: 'STUDENT',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastLoginAt: null,
  profile: { fullName: 'Learner', avatar: null, phone: null },
  stats: { totalBanhRan: 12, streakCount: 3 },
  leaderboard: { totalPoints: 80, weeklyExp: 20, tier: 'Đồng' },
  pet: { level: 2, exp: 15 },
  enrollments: [],
  ...overrides,
});

describe('AdminService learner tracking composition', () => {
  it('rejects an unknown learner without querying tracking data', async () => {
    const prisma = emptyTrackingPrisma();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      createService(prisma).getLearnerLearningTracking(999),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.courseLesson.findMany).not.toHaveBeenCalled();
  });

  it('returns safe empty states when a learner has no learning history', async () => {
    const prisma = emptyTrackingPrisma();
    prisma.user.findUnique.mockResolvedValue(learner());

    const result = await createService(prisma).getLearnerLearningTracking(7);

    expect(result.overview).toMatchObject({
      courseCount: 0,
      completedCourseLessons: 0,
      totalCourseLessons: 0,
      courseProgressPercent: null,
      recentActivityCount: 0,
    });
    expect(result.courses).toEqual([]);
    expect(result.skills.speaking.recent).toEqual([]);
    expect(result.recentActivity).toEqual([]);
    expect(result.gamification).toMatchObject({
      streakCount: 3,
      totalPoints: 80,
    });
  });

  it('keeps course completion semantics and maps Speaking dimensions without Prosody', async () => {
    const prisma = emptyTrackingPrisma();
    prisma.user.findUnique.mockResolvedValue(
      learner({
        enrollments: [
          {
            class: {
              course: { id: 10, title: 'General English', level: 'B1' },
            },
          },
        ],
      }),
    );
    prisma.courseLesson.findMany.mockResolvedValue([
      {
        id: 101,
        title: 'Lesson 1',
        order: 1,
        course: { id: 10, title: 'General English', level: 'B1' },
        exercises: [{ id: 1001, minimumScore: 80 }],
        attempts: [
          {
            exerciseId: 1001,
            score: 8,
            maxScore: 10,
            submittedAt: new Date('2026-02-01T00:00:00.000Z'),
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          },
        ],
      },
    ]);
    prisma.speakingSubmission.findMany.mockResolvedValue([
      {
        id: 501,
        status: 'COMPLETED',
        overallScore: 8.4,
        submittedAt: new Date('2026-02-02T00:00:00.000Z'),
        aiFeedback: {
          accuracyScore: 82,
          fluencyScore: 79,
          completenessScore: 91,
          PronScore: 84,
          prosodyScore: 99,
        },
        exercise: {
          id: 21,
          title: 'Read aloud',
          practiceSet: { title: 'Daily Speaking' },
        },
      },
    ]);

    const result = await createService(prisma).getLearnerLearningTracking(7);

    expect(result.courses[0]).toMatchObject({
      completedLessons: 1,
      totalLessons: 1,
      progressPercent: 100,
    });
    expect(result.skills.speaking.recent[0]).toMatchObject({
      accuracy: 82,
      fluency: 79,
      completeness: 91,
      pronScore: 84,
    });
    expect(result.skills.speaking.recent[0]).not.toHaveProperty('prosody');
  });
});
