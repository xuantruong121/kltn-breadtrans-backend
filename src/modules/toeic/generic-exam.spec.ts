import { QuizPublicationStatus } from '@prisma/client';
import { GenericExamService } from './generic-exam.service';

describe('GenericExamService Writing readiness', () => {
  const service: any = Object.create(GenericExamService.prototype);

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
          index === 0 ? null : 'https://r2/image.jpg',
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
        writingQuiz: publishedWritingSource('https://r2/image.jpg'),
      })),
    };

    expect(service.writingReady(source)).toBe(true);
  });
});
