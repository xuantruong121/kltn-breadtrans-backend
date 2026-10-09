import {
  AttemptMode,
  AttemptStatus,
  ClassStatus,
  CourseStatus,
  EnrollmentStatus,
} from '@prisma/client';
import { GamificationListener } from '../gamification/gamification.listener';
import { GamificationService } from '../gamification/gamification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ToeicService } from './toeic.service';
import { validateToeicExam } from './toeic.validation';

describe('TOEIC real PostgreSQL race and isolation closure', () => {
  let prisma: PrismaService;
  let service: ToeicService;
  let eventEmitter: { emitAsync: jest.Mock };
  let userId: number;
  let firstQuestionId: number;
  let courseId: number;
  const attemptIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // The local development database has had manual seed inserts. Keep the
    // fixture setup deterministic without changing any application data.
    for (const table of [
      'User',
      'Course',
      'Class',
      'Enrollment',
      'ToeicAttempt',
      'UserToeicReward',
      'BanhTransaction',
      'DailyBanhEarning',
    ]) {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST(COALESCE((SELECT MAX("id") FROM "${table}"), 0) + 1, 1), false)`,
      );
    }
    eventEmitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    service = new ToeicService(
      prisma,
      { generateTts: () => Promise.resolve(Buffer.from('')) } as never,
      eventEmitter as never,
    );

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const user = await prisma.user.create({
      data: { email: `toeic_race_${suffix}@breadtrans.local` },
    });
    userId = user.id;

    const question = await prisma.toeicQuestion.findFirst({
      where: { group: { examId: 1 } },
      orderBy: { questionNumber: 'asc' },
      select: { id: true },
    });
    if (!question) throw new Error('Exam 1 has no question fixture');
    firstQuestionId = question.id;

    const course = await prisma.course.create({
      data: {
        title: `TOEIC isolation ${suffix}`,
        status: CourseStatus.PUBLISHED,
      },
    });
    courseId = course.id;
    const lessonClass = await prisma.class.create({
      data: {
        courseId,
        name: `TOEIC isolation ${suffix}`,
        status: ClassStatus.ONGOING,
      },
    });
    await prisma.enrollment.create({
      data: {
        userId,
        classId: lessonClass.id,
        status: EnrollmentStatus.ACTIVE,
        progress: 37,
      },
    });
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.$disconnect();
  });

  function createExpiredAttempt() {
    return prisma.toeicAttempt
      .create({
        data: {
          userId,
          examId: 1,
          mode: AttemptMode.FULL_TEST,
          status: AttemptStatus.IN_PROGRESS,
          durationSeconds: 60,
          startedAt: new Date(Date.now() - 120_000),
          deadline: new Date(Date.now() - 1_000),
        },
      })
      .then((attempt) => {
        attemptIds.push(attempt.id);
        return attempt;
      });
  }

  function createLiveAttempt() {
    return prisma.toeicAttempt
      .create({
        data: {
          userId,
          examId: 1,
          mode: AttemptMode.FULL_TEST,
          status: AttemptStatus.IN_PROGRESS,
          durationSeconds: 60,
          startedAt: new Date(),
          deadline: new Date(Date.now() + 120_000),
        },
      })
      .then((attempt) => {
        attemptIds.push(attempt.id);
        return attempt;
      });
  }

  it('manual submit racing expiry finalizes once for ten iterations', async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const attempt = await createExpiredAttempt();
      const beforeEvents = eventEmitter.emitAsync.mock.calls.length;
      const outcomes = await Promise.allSettled([
        service.submitAttempt(attempt.id, userId),
        service.getAttemptDetail(attempt.id, userId),
      ]);
      const current = await prisma.toeicAttempt.findUnique({
        where: { id: attempt.id },
        select: { status: true, submittedAt: true, totalScore: true },
      });
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(
        true,
      );
      expect(current?.status).toBe(AttemptStatus.SUBMITTED);
      expect(current?.submittedAt).not.toBeNull();
      expect(current?.totalScore).toBeGreaterThan(0);
      expect(eventEmitter.emitAsync.mock.calls.length - beforeEvents).toBe(1);
    }
  });

  it('save racing submit cannot mutate a submitted result', async () => {
    const attempt = await createLiveAttempt();
    const outcomes = await Promise.allSettled([
      service.saveAnswers(attempt.id, userId, { [firstQuestionId]: 0 }),
      service.submitAttempt(attempt.id, userId),
    ]);
    const current = await prisma.toeicAttempt.findUnique({
      where: { id: attempt.id },
      include: { answers: true },
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(
      true,
    );
    expect(current?.status).toBe(AttemptStatus.SUBMITTED);
    const scoreAtSubmit = current?.totalScore;
    await expect(
      service.saveAnswers(attempt.id, userId, { [firstQuestionId]: 1 }),
    ).rejects.toThrow('đã kết thúc');
    const after = await prisma.toeicAttempt.findUnique({
      where: { id: attempt.id },
      include: { answers: true },
    });
    expect(after?.status).toBe(AttemptStatus.SUBMITTED);
    expect(after?.totalScore).toBe(scoreAtSubmit);
    expect(after?.answers).toEqual(current?.answers);
  });

  it('save after expiry is rejected after one committed finalization', async () => {
    const attempt = await createExpiredAttempt();
    const beforeEvents = eventEmitter.emitAsync.mock.calls.length;
    await expect(
      service.saveAnswers(attempt.id, userId, { [firstQuestionId]: 0 }),
    ).rejects.toThrow('Thời gian làm bài đã kết thúc');
    const current = await prisma.toeicAttempt.findUnique({
      where: { id: attempt.id },
      select: { status: true, submittedAt: true },
    });
    expect(current?.status).toBe(AttemptStatus.SUBMITTED);
    expect(current?.submittedAt).not.toBeNull();
    expect(eventEmitter.emitAsync.mock.calls.length - beforeEvents).toBe(1);
  });

  it('save after submission is rejected and leaves answers unchanged', async () => {
    const attempt = await createLiveAttempt();
    await service.submitAttempt(attempt.id, userId);
    const eventsAfterSubmit = eventEmitter.emitAsync.mock.calls.length;
    await service.getResult(attempt.id, userId);
    await service.getResult(attempt.id, userId);
    expect(eventEmitter.emitAsync.mock.calls.length).toBe(eventsAfterSubmit);
    const before = await prisma.toeicAttemptAnswer.findMany({
      where: { attemptId: attempt.id },
    });
    await expect(
      service.saveAnswers(attempt.id, userId, { [firstQuestionId]: 0 }),
    ).rejects.toThrow('đã kết thúc');
    const after = await prisma.toeicAttemptAnswer.findMany({
      where: { attemptId: attempt.id },
    });
    expect(after).toEqual(before);
  });

  it('duplicate toeic submitted event rewards once', async () => {
    const gamificationService = new GamificationService(
      prisma,
      eventEmitter as never,
      {} as never,
    );
    const listener = new GamificationListener(
      prisma,
      gamificationService,
      eventEmitter as never,
    );
    const before = await prisma.banhTransaction.count({ where: { userId } });
    await Promise.all([
      listener.handleToeicSubmittedEvent({
        userId,
        examId: 1,
        mode: 'FULL_TEST',
        attemptId: attemptIds[0],
      }),
      listener.handleToeicSubmittedEvent({
        userId,
        examId: 1,
        mode: 'FULL_TEST',
        attemptId: attemptIds[0],
      }),
    ]);
    const reward = await prisma.userToeicReward.findUnique({
      where: { userId_examId_mode: { userId, examId: 1, mode: 'FULL_TEST' } },
    });
    expect(reward?.banhGranted).toBe(120);
    expect(
      (await prisma.banhTransaction.count({ where: { userId } })) - before,
    ).toBe(1);
  });

  it('TOEIC completion does not affect normal Listening or Reading progress', async () => {
    const before = await Promise.all([
      prisma.listeningPracticeAttempt.count({ where: { userId } }),
      prisma.submission.count({ where: { userId } }),
      prisma.contentAttempt.count({ where: { userId } }),
    ]);
    const attempt = await createLiveAttempt();
    await service.submitAttempt(attempt.id, userId);
    const after = await Promise.all([
      prisma.listeningPracticeAttempt.count({ where: { userId } }),
      prisma.submission.count({ where: { userId } }),
      prisma.contentAttempt.count({ where: { userId } }),
    ]);
    expect(after).toEqual(before);
  });

  it('TOEIC completion does not affect an unrelated course progress row', async () => {
    const before = await prisma.enrollment.findFirstOrThrow({
      where: { userId, class: { courseId } },
      select: { progress: true },
    });
    const attempt = await createLiveAttempt();
    await service.submitAttempt(attempt.id, userId);
    const after = await prisma.enrollment.findFirstOrThrow({
      where: { userId, class: { courseId } },
      select: { progress: true },
    });
    expect(after.progress).toBe(before.progress);
  });

  it('Exam 1 remains learner-ready with all durable Listening media', async () => {
    const exam = await prisma.toeicExamSet.findUniqueOrThrow({
      where: { id: 1 },
      include: { groups: { include: { questions: true } } },
    });
    const validation = validateToeicExam(exam);
    const listeningGroups = exam.groups.filter((group) => group.part <= 4);
    expect(validation.learnerReady).toBe(true);
    expect(validation.counts.total).toBe(200);
    expect(listeningGroups).toHaveLength(54);
    expect(listeningGroups.every((group) => Boolean(group.audioUrl))).toBe(
      true,
    );
  });
});
