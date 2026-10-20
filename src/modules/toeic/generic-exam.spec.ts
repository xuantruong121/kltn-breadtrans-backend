import { QuizPublicationStatus } from '@prisma/client';
import { GenericExamService } from './generic-exam.service';

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
