import { BadRequestException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';
import { GenericExamService, lrSourceIsLive } from './generic-exam.service';

describe('GenericExamService Writing readiness', () => {
  const service: any = Object.create(GenericExamService.prototype);
  const trustedPictureUrl =
    'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/content/picture.jpg';

  const publishedWritingSource = (imageUrl: string | null) => ({
    publicationStatus: QuizPublicationStatus.PUBLISHED,
    questions: [{ content: { imageUrl } }],
  });

  it('blocks an otherwise published Writing set when a picture slot has no learner-visible image', () => {
    const source = {
      publicationStatus: QuizPublicationStatus.PUBLISHED,
      items: Array.from({ length: 8 }, (_, index) => ({
        taskKind: index < 5 ? 'PICTURE_SENTENCE' : 'WRITTEN_REQUEST',
        writingQuiz: publishedWritingSource(
          index === 0 ? null : trustedPictureUrl,
        ),
      })),
    };

    expect(service.writingReady(source)).toBe(false);
  });

  it('accepts a complete published Writing source with all required picture media', () => {
    const source = {
      publicationStatus: QuizPublicationStatus.PUBLISHED,
      items: Array.from({ length: 8 }, (_, index) => ({
        taskKind: index < 5 ? 'PICTURE_SENTENCE' : 'WRITTEN_REQUEST',
        writingQuiz: publishedWritingSource(trustedPictureUrl),
      })),
    };

    expect(service.writingReady(source)).toBe(true);
  });

  it('projects 19 total questions and 80 min duration for TOEIC_SW variant', () => {
    const exam: any = {
      id: 22,
      title: 'TOEIC 2 Skills: Speaking & Writing',
      variantCode: 'TOEIC_SW',
      familyCode: 'TOEIC',
      templateKey: 'TOEIC_SW_V1',
      publicationStatus: QuizPublicationStatus.PUBLISHED,
      toeicAssessment: {
        components: [
          {
            kind: 'SPEAKING',
            speakingPracticeSet: {
              scope: 'EXAM_INTERNAL',
              publicationStatus: QuizPublicationStatus.PUBLISHED,
              exercises: Array.from({ length: 11 }, (_, i) => ({
                order: i + 1,
                publicationStatus: QuizPublicationStatus.PUBLISHED,
                taskType: [
                  'READ_ALOUD',
                  'READ_ALOUD',
                  'DESCRIBE_PICTURE',
                  'DESCRIBE_PICTURE',
                  'RESPOND_QUESTIONS',
                  'RESPOND_QUESTIONS',
                  'RESPOND_QUESTIONS',
                  'RESPOND_WITH_INFO',
                  'RESPOND_WITH_INFO',
                  'RESPOND_WITH_INFO',
                  'EXPRESS_OPINION',
                ][i],
              })),
            },
          },
          {
            kind: 'WRITING',
            writingSet: {
              publicationStatus: QuizPublicationStatus.PUBLISHED,
              items: Array.from({ length: 8 }, (_, i) => ({
                writingQuiz: {
                  publicationStatus: QuizPublicationStatus.PUBLISHED,
                  questions: [
                    { content: { imageUrl: i < 5 ? 'https://img.png' : null } },
                  ],
                },
              })),
            },
          },
        ],
      },
    };

    const projected = service.project(exam);
    expect(projected.totalQuestions).toBe(19);
    expect(projected.durationSeconds).toBe(4800);
  });
});

describe('GenericExamService internal sources', () => {
  const quiz = (publicationStatus: QuizPublicationStatus) => ({
    publicationStatus,
    questions: [],
  });
  const source = (publicationStatus: QuizPublicationStatus) => ({
    publicationStatus,
    items: Array.from({ length: 8 }, () => ({
      taskKind: 'WRITTEN_REQUEST',
      writingQuiz: quiz(publicationStatus),
    })),
  });

  it('judges a draft exam by its content, not its source status', () => {
    const service: any = Object.create(GenericExamService.prototype);
    expect(
      service.writingReady(source(QuizPublicationStatus.DRAFT), true),
    ).toBe(true);
  });

  it('never counts a draft source once the exam is live', () => {
    const service: any = Object.create(GenericExamService.prototype);
    expect(
      service.writingReady(source(QuizPublicationStatus.DRAFT), false),
    ).toBe(false);
  });

  it('publishes Speaking and Writing with the exam', async () => {
    const service: any = Object.create(GenericExamService.prototype);
    const tx = {
      speakingPracticeSet: { update: jest.fn() },
      speakingExercise: { updateMany: jest.fn() },
      quiz: { updateMany: jest.fn() },
      toeicWritingSet: { update: jest.fn() },
    };

    await service.publishInternalSources(tx, {
      toeicAssessment: {
        components: [
          { kind: 'SPEAKING', speakingPracticeSet: { id: 7 } },
          {
            kind: 'WRITING',
            writingSet: { id: 8, items: [{ writingQuizId: 41 }] },
          },
        ],
      },
    });

    const data = { publicationStatus: QuizPublicationStatus.PUBLISHED };
    expect(tx.speakingPracticeSet.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data,
    });
    expect(tx.speakingExercise.updateMany).toHaveBeenCalledWith({
      where: { practiceSetId: 7 },
      data,
    });
    expect(tx.quiz.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [41] } },
      data,
    });
    expect(tx.toeicWritingSet.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data,
    });
  });
});

describe('GenericExamService.update title', () => {
  it('renames what learners read, not only the exam row', async () => {
    const service: any = Object.create(GenericExamService.prototype);
    const update = () => jest.fn().mockResolvedValue({});
    service.prisma = {
      exam: { update: update() },
      toeicAssessment: { update: update() },
      speakingPracticeSet: { update: update() },
      toeicWritingSet: { update: update() },
    };
    service.project = jest.fn();
    service.findExam = jest.fn().mockResolvedValue({
      toeicAssessment: {
        id: 3,
        components: [
          { kind: 'SPEAKING', speakingPracticeSet: { id: 7 } },
          { kind: 'WRITING', writingSet: { id: 8 } },
        ],
      },
    });

    await service.update(5, { title: 'Đề 02' });

    expect(service.prisma.toeicAssessment.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { title: 'Đề 02' },
    });
    expect(service.prisma.speakingPracticeSet.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { title: 'Đề 02 — Speaking' },
    });
    expect(service.prisma.toeicWritingSet.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { title: 'Đề 02 — Writing' },
    });
  });
});

describe('GenericExamService.getAdmin AI review', () => {
  const build = (status: string) => {
    const service: any = Object.create(GenericExamService.prototype);
    service.findExam = jest.fn().mockResolvedValue({ aiGenerationJobId: 'j' });
    service.project = jest.fn().mockReturnValue({ id: 5 });
    service.withAdminPlayback = jest.fn((value: unknown) => value);
    service.examsSharingLr = jest.fn().mockResolvedValue(0);
    service.prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({ status }),
      },
    };
    return service;
  };

  it('offers the AI draft only while it waits for review', async () => {
    expect((await build('GENERATED').getAdmin(5)).aiReviewPending).toBe(true);
    expect((await build('APPROVED').getAdmin(5)).aiReviewPending).toBe(false);
  });
});

describe('lrSourceIsLive', () => {
  const draft = { id: 3, publicationStatus: QuizPublicationStatus.DRAFT };
  const live = { id: 1, publicationStatus: QuizPublicationStatus.PUBLISHED };

  it('lets a draft exam publish together with its own L&R', () => {
    expect(lrSourceIsLive(draft, 3)).toBe(true);
  });

  it('refuses a borrowed L&R that is still a draft', () => {
    expect(lrSourceIsLive(draft, 9)).toBe(false);
  });

  it('accepts a live source and refuses a missing or retired one', () => {
    expect(lrSourceIsLive(live, 9)).toBe(true);
    expect(lrSourceIsLive(null, 9)).toBe(false);
    expect(
      lrSourceIsLive(
        { id: 3, publicationStatus: QuizPublicationStatus.ARCHIVED },
        3,
      ),
    ).toBe(false);
  });
});

describe('GenericExamService publish readiness guard', () => {
  it('rejects a DRAFT exam when learner readiness is false before any publish write', async () => {
    const service: any = Object.create(GenericExamService.prototype);
    const exam = {
      id: 69,
      templateKey: 'TOEIC_LR_V1',
      variantCode: 'TOEIC_LR',
      publicationStatus: QuizPublicationStatus.DRAFT,
      toeicAssessment: null,
      toeicExamSet: {
        id: 169,
        type: 'FULL_TEST',
        publicationStatus: QuizPublicationStatus.DRAFT,
        groups: [
          {
            id: 1671,
            part: 1,
            groupOrder: 1,
            imageUrl: null,
            audioUrl: 'https://cdn.example.r2.dev/audio.mp3',
            questions: [
              {
                id: 1,
                questionNumber: 1,
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 0,
              },
            ],
          },
        ],
      },
    };
    service.findExam = jest.fn().mockResolvedValue(exam);
    service.prisma = { $transaction: jest.fn() };

    await expect(service.publish(69)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
  });
});
