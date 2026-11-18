import { ConflictException } from '@nestjs/common';
import { QuizPublicationStatus, QuizType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { GrammarService } from '../grammar/grammar.service';
import { SkillCmsService } from './skill-cms.service';

/**
 * An admin deletes content while a learner is saving an attempt on it
 * (audit A5, 2026-11-18). Before, the count ran outside any lock: an attempt
 * saved between the count and the delete was removed with the content by
 * the cascade. Now the delete locks the row the attempt points to, then
 * counts again.
 */
describeWithIsolatedDatabase('content delete races a learner attempt', () => {
  let prisma: PrismaService;
  let grammar: GrammarService;
  let skills: SkillCmsService;
  let learnerId: number;
  const admin = { id: 1, role: Role.ADMIN };
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const topicIds: number[] = [];
  const quizIds: number[] = [];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stillPending = async (p: Promise<unknown>) =>
    (await Promise.race([p.then(() => 'settled'), sleep(300)])) !== 'settled';

  /**
   * The first SELECT ... FOR UPDATE the delete sends runs `onLocked` before
   * the delete goes on.
   */
  const pausingAfterLock = (onLocked: () => Promise<void>) => {
    let fired = false;
    const wrapTx = (tx: object) =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (prop === '$queryRaw' && typeof value === 'function')
            return async (...args: unknown[]) => {
              const rows = await (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              );
              if (!fired) {
                fired = true;
                await onLocked();
              }
              return rows;
            };
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    const client = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === '$transaction')
          return (cb: (tx: object) => unknown, options?: object) =>
            target.$transaction(
              (tx) => cb(wrapTx(tx)) as Promise<unknown>,
              options,
            );
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    return { client, fired: () => fired };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    grammar = new GrammarService(
      prisma,
      { emit: jest.fn() } as never,
      {} as never,
    );
    skills = new SkillCmsService(prisma);
    learnerId = (
      await prisma.user.create({
        data: {
          email: `delete_race_${suffix}@breadtrans.local`,
          role: Role.STUDENT,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.grammarAttempt.deleteMany({ where: { userId: learnerId } });
    await prisma.submission.deleteMany({ where: { userId: learnerId } });
    await prisma.grammarTopic.deleteMany({ where: { id: { in: topicIds } } });
    await prisma.quiz.deleteMany({ where: { id: { in: quizIds } } });
    await prisma.user.delete({ where: { id: learnerId } });
    await prisma.$disconnect();
  });

  const newTopic = async () => {
    const topic = await prisma.grammarTopic.create({
      data: { title: `QA delete race ${suffix}` },
    });
    topicIds.push(topic.id);
    return topic.id;
  };

  const newDraftQuiz = async () => {
    const quiz = await prisma.quiz.create({
      data: {
        title: `QA delete race ${suffix}`,
        type: QuizType.BILINGUAL_READING,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
    quizIds.push(quiz.id);
    return quiz.id;
  };

  it('grammar: an attempt saving while the delete starts is kept, and the delete answers 409', async () => {
    const topicId = await newTopic();
    let commit!: () => void;
    let inserted!: () => void;
    const insertedOnce = new Promise<void>((r) => (inserted = r));
    const learner = prisma.$transaction(async (tx) => {
      await tx.grammarAttempt.create({
        data: { userId: learnerId, topicId, score: 1, answers: [] },
      });
      inserted();
      await new Promise<void>((r) => (commit = r));
    });
    await insertedOnce;

    const deleting = grammar.deleteTopic(topicId);
    expect(await stillPending(deleting)).toBe(true);
    commit();
    await learner;

    await expect(deleting).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.grammarTopic.count({ where: { id: topicId } })).toBe(1);
    expect(await prisma.grammarAttempt.count({ where: { topicId } })).toBe(1);
  });

  it('grammar: an attempt arriving while the delete holds the lock waits, then fails', async () => {
    const topicId = await newTopic();
    let attempt!: Promise<unknown>;
    const { client, fired } = pausingAfterLock(async () => {
      attempt = prisma.grammarAttempt.create({
        data: { userId: learnerId, topicId, score: 1, answers: [] },
      });
      attempt.catch(() => undefined);
      expect(await stillPending(attempt)).toBe(true);
    });
    const locked = new GrammarService(
      client as never,
      { emit: jest.fn() } as never,
      {} as never,
    );

    await locked.deleteTopic(topicId);

    expect(fired()).toBe(true);
    await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.grammarTopic.count({ where: { id: topicId } })).toBe(0);
  });

  it('quiz: a submission saving while the delete starts is kept, and the delete answers 409', async () => {
    const quizId = await newDraftQuiz();
    let commit!: () => void;
    let inserted!: () => void;
    const insertedOnce = new Promise<void>((r) => (inserted = r));
    const learner = prisma.$transaction(async (tx) => {
      await tx.submission.create({ data: { quizId, userId: learnerId } });
      inserted();
      await new Promise<void>((r) => (commit = r));
    });
    await insertedOnce;

    const deleting = skills.deleteContent('reading', String(quizId), admin);
    expect(await stillPending(deleting)).toBe(true);
    commit();
    await learner;

    await expect(deleting).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.quiz.count({ where: { id: quizId } })).toBe(1);
    expect(await prisma.submission.count({ where: { quizId } })).toBe(1);
  });

  it('quiz: a submission arriving while the delete holds the lock waits, then fails', async () => {
    const quizId = await newDraftQuiz();
    let submission!: Promise<unknown>;
    const { client, fired } = pausingAfterLock(async () => {
      submission = prisma.submission.create({
        data: { quizId, userId: learnerId },
      });
      submission.catch(() => undefined);
      expect(await stillPending(submission)).toBe(true);
    });

    await new SkillCmsService(client as never).deleteContent(
      'reading',
      String(quizId),
      admin,
    );

    expect(fired()).toBe(true);
    await expect(submission).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.quiz.count({ where: { id: quizId } })).toBe(0);
  });
});
