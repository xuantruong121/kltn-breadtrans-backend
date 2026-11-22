import { QuizPublicationStatus, QuizType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { ContentFilesService } from '../upload/content-files.service';
import { SkillCmsService } from './skill-cms.service';

/**
 * Deleting skill content deletes its own R2 files (bug 2026-11-22: quiz 103's
 * audio stayed public after the quiz was deleted). The keys are read before
 * the cascade removes their rows; only keys under the item's own prefix go,
 * and never one that a remaining row still uses. R2 and Redis are fakes: no
 * real object is touched.
 */
describeWithIsolatedDatabase('content delete removes its own R2 files', () => {
  const base = 'https://pub-qa.r2.dev';
  const admin = { id: 1, role: Role.ADMIN };
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let prisma: PrismaService;
  let r2: { getPublicUrl: () => string; deleteFile: jest.Mock };
  let skills: SkillCmsService;
  const quizIds: number[] = [];
  const setIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    r2 = {
      getPublicUrl: () => base,
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const redis = {
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    };
    skills = new SkillCmsService(
      prisma,
      undefined,
      undefined,
      undefined,
      undefined,
      new ContentFilesService(prisma, r2 as never, redis as never),
    );
  });

  afterAll(async () => {
    await prisma.speakingExercise.deleteMany({
      where: { practiceSetId: { in: setIds } },
    });
    await prisma.speakingPracticeSet.deleteMany({
      where: { id: { in: setIds } },
    });
    await prisma.quiz.deleteMany({ where: { id: { in: quizIds } } });
    await prisma.$disconnect();
  });

  const deletedKeys = () =>
    r2.deleteFile.mock.calls.map(([key]) => key as string).sort();

  const newListeningQuiz = async (questions: number) => {
    const quiz = await prisma.quiz.create({
      data: {
        title: `QA delete files ${suffix}`,
        type: QuizType.LISTENING_PRACTICE,
        publicationStatus: QuizPublicationStatus.DRAFT,
        questions: {
          create: Array.from({ length: questions }, (_, order) => ({
            type: 'MULTIPLE_CHOICE',
            content: {},
            order,
          })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    quizIds.push(quiz.id);
    return { quizId: quiz.id, questionIds: quiz.questions.map((q) => q.id) };
  };

  const clip = (questionId: number, version: number, key: string) =>
    prisma.quizAudioAsset.create({
      data: {
        questionId,
        version,
        key,
        url: `${base}/${key}`,
        mimeType: 'audio/mpeg',
        isActive: false,
      },
    });

  const artifact = (quizId: number, key: string) =>
    prisma.listeningAudioArtifact.create({
      data: {
        quizId,
        version: 1,
        synthesisHash: `qa-${suffix}-${quizId}`,
        contentHash: `qa-${suffix}-${quizId}`,
        provider: 'AZURE_SPEECH_SDK',
        locale: 'en-US',
        accent: 'US',
        voiceRegistryVersion: 'qa',
        outputFormat: 'mp3',
        r2Key: key,
      },
    });

  it('a listening quiz: every clip version and its artifact, nothing shared or outside its prefix', async () => {
    const {
      quizId,
      questionIds: [q1, q2],
    } = await newListeningQuiz(2);
    const other = await newListeningQuiz(1);
    const own = [
      `catalog/listening/practice/audio/quiz-${quizId}/question-${q1}/v1/a.mp3`,
      `catalog/listening/practice/dialogue/quiz-${quizId}/question-${q1}/v2/b.mp3`,
      `catalog/listening/practice/quiz-${quizId}/audio/v1/full.mp3`,
    ];
    const shared = `catalog/listening/practice/audio/quiz-${quizId}/question-${q2}/v1/shared.mp3`;
    const outside = `catalog/listening/practice/images/qa-${suffix}.webp`;
    await clip(q1, 1, own[0]);
    await clip(q1, 2, own[1]);
    await artifact(quizId, own[2]);
    await clip(q2, 1, shared);
    await clip(q2, 2, outside);
    // Another quiz still points at one of the keys.
    await clip(other.questionIds[0], 1, shared);

    await expect(
      skills.deleteContent('listening', String(quizId), admin),
    ).resolves.toEqual({ id: quizId, deleted: true });

    expect(deletedKeys()).toEqual([...own].sort());
    expect(await prisma.quiz.count({ where: { id: quizId } })).toBe(0);
    expect(
      await prisma.quizAudioAsset.count({
        where: { question: { quizId: other.quizId } },
      }),
    ).toBe(1);
  });

  it("a listening question: its own clips only, not the quiz's artifact or another question's clip", async () => {
    const {
      quizId,
      questionIds: [q1, q2],
    } = await newListeningQuiz(2);
    const mine = `catalog/listening/practice/audio/quiz-${quizId}/question-${q1}/v1/a.mp3`;
    await clip(q1, 1, mine);
    await clip(
      q2,
      1,
      `catalog/listening/practice/audio/quiz-${quizId}/question-${q2}/v1/b.mp3`,
    );
    await artifact(
      quizId,
      `catalog/listening/practice/quiz-${quizId}/audio/v1/full.mp3`,
    );

    await skills.deleteQuestion('listening', String(quizId), String(q1), admin);

    expect(deletedKeys()).toEqual([mine]);
    expect(
      await prisma.quizAudioAsset.count({ where: { questionId: q2 } }),
    ).toBe(1);
    expect(
      await prisma.listeningAudioArtifact.count({ where: { quizId } }),
    ).toBe(1);
  });

  it('a speaking set: its own reference audio, not a typed URL nor audio an exam copy still uses', async () => {
    const setId = `qa-files-${suffix}`;
    const copyId = `qa-files-${suffix}-copy`;
    setIds.push(setId, copyId);
    for (const id of [setId, copyId])
      await prisma.speakingPracticeSet.create({
        data: { id, title: 'QA delete files', description: '', level: 'A1' },
      });
    const exercise = (practiceSetId: string, order: number) =>
      prisma.speakingExercise.create({
        data: { title: 'QA', targetText: 'Hello.', practiceSetId, order },
      });
    const [own, sharedOwner, typed] = await Promise.all([
      exercise(setId, 1),
      exercise(setId, 2),
      exercise(setId, 3),
    ]);
    const copy = await exercise(copyId, 1);
    const ownKey = `catalog/speaking/reference/${own.id}.r1.mp3`;
    const sharedUrl = `${base}/catalog/speaking/reference/${sharedOwner.id}.r1.mp3`;
    await prisma.speakingExercise.update({
      where: { id: own.id },
      data: { audioUrl: `${base}/${ownKey}` },
    });
    await prisma.speakingExercise.update({
      where: { id: sharedOwner.id },
      data: { audioUrl: sharedUrl },
    });
    await prisma.speakingExercise.update({
      where: { id: typed.id },
      data: { audioUrl: 'https://example.com/typed.mp3' },
    });
    // The exam duplicate copies audioUrl as it is.
    await prisma.speakingExercise.update({
      where: { id: copy.id },
      data: { audioUrl: sharedUrl },
    });

    await skills.deleteContent('speaking', setId, admin);

    expect(deletedKeys()).toEqual([ownKey]);
    expect(
      await prisma.speakingExercise.count({ where: { practiceSetId: setId } }),
    ).toBe(0);
  });
});
