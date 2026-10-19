import { BadRequestException } from '@nestjs/common';
import {
  QuizPublicationStatus,
  ToeicAssessmentComponentKind,
  ToeicAssessmentProductFamily,
} from '@prisma/client';
import { ToeicAssessmentService } from './toeic-assessment.service';

describe('ToeicAssessmentService', () => {
  const service = () => new ToeicAssessmentService({} as any, {} as any);

  it('requires the exact component contract for every product family', () => {
    const instance = service() as any;
    expect(() =>
      instance.assertFamilyComponents(
        ToeicAssessmentProductFamily.TOEIC_4_SKILLS,
        [
          { kind: ToeicAssessmentComponentKind.LISTENING_READING, order: 1 },
          { kind: ToeicAssessmentComponentKind.SPEAKING, order: 2 },
        ],
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      instance.assertFamilyComponents(ToeicAssessmentProductFamily.TOEIC_SW, [
        { kind: ToeicAssessmentComponentKind.SPEAKING, order: 1 },
        { kind: ToeicAssessmentComponentKind.WRITING, order: 2 },
      ]),
    ).not.toThrow();
  });

  it('rejects an ambiguous component with multiple typed sources', () => {
    const instance = service() as any;
    expect(() =>
      instance.assertComponentSourceShape({
        kind: ToeicAssessmentComponentKind.WRITING,
        order: 1,
        writingSetId: 2,
        lrExamSetId: 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('does not treat the current incomplete Speaking source as TOEIC-ready', async () => {
    const instance = new ToeicAssessmentService(
      { speakingPracticeSet: { findUnique: jest.fn() } } as any,
      {} as any,
    ) as any;
    instance.db.speakingPracticeSet.findUnique.mockResolvedValue({
      id: 'toeic-speaking-practice',
      title: 'TOEIC Speaking Practice',
      publicationStatus: QuizPublicationStatus.PUBLISHED,
      exercises: [
        {
          title: 'Read Aloud 1',
          targetText: 'read aloud',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        {
          title: 'Read Aloud 2',
          targetText: 'read aloud',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        {
          title: 'Describe Office Scene',
          targetText: 'describe a scene',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        {
          title: 'Describe Station Scene',
          targetText: 'describe a scene',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        {
          title: 'Information Response',
          targetText: 'information response',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        {
          title: 'Express Opinion',
          targetText: 'express opinion',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
      ],
    });

    const readiness = await instance.componentReadiness({
      kind: ToeicAssessmentComponentKind.SPEAKING,
      speakingPracticeSetId: 'toeic-speaking-practice',
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.coverage.respondToQuestions).toBe(0);
  });

  it('counts TOEIC Speaking coverage only from taskType and stimulus relations', () => {
    const instance = service() as any;
    const stimulus = { kind: 'INFORMATION' };
    const exercises = [
      ...Array.from({ length: 2 }, (_, index) => ({
        title: `arbitrary title ${index}`,
        targetText: 'read',
        taskType: 'READ_ALOUD',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        title: `picture ${index}`,
        targetText: 'describe',
        taskType: 'DESCRIBE_PICTURE',
        imageUrl: `https://cdn.example/${index}.png`,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        title: `question ${index}`,
        targetText: 'question',
        taskType: 'RESPOND_TO_QUESTION',
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        title: `schedule ${index}`,
        targetText: 'schedule',
        taskType: 'RESPOND_USING_INFORMATION',
        stimulusId: 10,
        stimulus,
      })),
      {
        title: 'anything else',
        targetText: 'opinion',
        taskType: 'EXPRESS_OPINION',
      },
    ].map((exercise, index) => ({ ...exercise, order: index + 1 }));

    expect(instance.speakingCoverage(exercises)).toMatchObject({
      total: 11,
      readAloud: 2,
      describePicture: 2,
      respondToQuestions: 3,
      respondUsingInformation: 3,
      expressOpinion: 1,
      authoritativeOrderReady: true,
      slotTaskTypesReady: true,
      describePictureMediaReady: true,
      sharedInformationStimulusReady: true,
    });
  });

  it('rejects gaps or duplicates in the authoritative Speaking order', () => {
    const instance = service() as any;
    const exercises = Array.from({ length: 11 }, (_, index) => ({
      order: index + 1,
      taskType: 'READ_ALOUD',
    }));
    exercises[10].order = 10;

    expect(instance.speakingCoverage(exercises)).toMatchObject({
      authoritativeOrderReady: false,
      slotTaskTypesReady: false,
    });
  });

  it('rejects a non-11-task source and wrong task types at ordered slots', () => {
    const instance = service() as any;
    const tooMany = Array.from({ length: 12 }, (_, index) => ({
      order: index + 1,
      taskType: 'READ_ALOUD',
    }));
    expect(instance.speakingCoverage(tooMany)).toMatchObject({
      authoritativeOrderReady: false,
      slotTaskTypesReady: false,
    });

    const taskTypes = [
      'READ_ALOUD',
      'READ_ALOUD',
      'DESCRIBE_PICTURE',
      'DESCRIBE_PICTURE',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'EXPRESS_OPINION',
    ];
    [taskTypes[0], taskTypes[10]] = [taskTypes[10], taskTypes[0]];
    const wrongSlots = taskTypes.map((taskType, index) => ({
      order: index + 1,
      taskType,
    }));
    expect(instance.speakingCoverage(wrongSlots)).toMatchObject({
      authoritativeOrderReady: true,
      slotTaskTypesReady: false,
    });
  });

  it('keeps Speaking slot semantics independent from titles and categories', () => {
    const instance = service() as any;
    const taskTypes = [
      'READ_ALOUD',
      'READ_ALOUD',
      'DESCRIBE_PICTURE',
      'DESCRIBE_PICTURE',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'EXPRESS_OPINION',
    ];
    const coverage = instance.speakingCoverage(
      taskTypes.map((taskType, index) => ({
        order: index + 1,
        taskType,
        title: `unrelated title ${index}`,
        category: 'UNRELATED_CATEGORY',
        ...(taskType === 'DESCRIBE_PICTURE'
          ? { imageUrl: `https://cdn.example/${index}.png` }
          : {}),
        ...(taskType === 'RESPOND_USING_INFORMATION'
          ? {
              stimulusId: 7,
              stimulus: { kind: 'INFORMATION' },
            }
          : {}),
      })),
    );

    expect(coverage).toMatchObject({
      authoritativeOrderReady: true,
      slotTaskTypesReady: true,
    });
  });

  it('returns independent component summaries without a fabricated combined score', () => {
    const instance = service() as any;
    const result = instance.projectAttempt({
      id: 1,
      assessmentId: 8,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      submittedAt: null,
      completedAt: null,
      assessment: { id: 8, title: 'QA', productFamily: 'TOEIC_4_SKILLS' },
      components: [
        {
          id: 10,
          assessmentComponentId: 20,
          status: 'COMPLETED',
          toeicAttemptId: 42,
          assessmentComponent: { kind: 'LISTENING_READING', order: 1 },
          speakingSubmissions: [],
          writingSubmissions: [],
        },
      ],
    });
    expect(result.result.components).toHaveLength(1);
    expect(result).not.toHaveProperty('officialOverallFourSkillScore');
    expect(result).not.toHaveProperty('combined1390');
  });
});
