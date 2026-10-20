import { BadRequestException } from '@nestjs/common';
import { QuizPublicationStatus, QuizType } from '@prisma/client';
import { ToeicWritingSetService } from './toeic-writing-set.service';
import { TOEIC_WRITING_SLOT_CONTRACT } from './toeic-writing-set.contract';

const sourceFor = (taskKind: string, id: number) => ({
  id,
  title: `Task ${id}`,
  description: null,
  type:
    taskKind === 'PICTURE_SENTENCE'
      ? QuizType.WRITING_PICTURE
      : QuizType.WRITING_EMAIL,
  publicationStatus: QuizPublicationStatus.PUBLISHED,
  questions: [
    {
      id: id * 10,
      content: {
        taskType:
          taskKind === 'PICTURE_SENTENCE'
            ? 'SENTENCE'
            : taskKind === 'WRITTEN_REQUEST'
              ? 'EMAIL'
              : 'OPINION',
        ...(taskKind === 'PICTURE_SENTENCE' && {
          imageUrl:
            'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/picture.png',
        }),
      },
    },
  ],
});

const set = {
  id: 901,
  title: 'QA TOEIC Writing',
  description: null,
  publicationStatus: QuizPublicationStatus.DRAFT,
  version: 1,
  createdBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: TOEIC_WRITING_SLOT_CONTRACT.map((taskKind, index) => ({
    id: index + 1,
    writingSetId: 901,
    order: index + 1,
    taskKind,
    writingQuizId: index + 10,
    writingQuiz: sourceFor(taskKind, index + 10),
  })),
};

describe('ToeicWritingSetService', () => {
  it('publishes only an exact, compatible 5+2+1 set', async () => {
    const db: any = {
      toeicWritingSet: {
        findUnique: jest.fn().mockResolvedValue(set),
        update: jest
          .fn()
          .mockResolvedValue({ ...set, publicationStatus: 'PUBLISHED' }),
      },
      quiz: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(
            sourceFor(
              set.items.find((item) => item.writingQuizId === where.id)
                ?.taskKind ?? 'OPINION_ESSAY',
              where.id,
            ),
          ),
        ),
      },
    };
    const service = new ToeicWritingSetService(db);

    await expect(service.publish(901)).resolves.toMatchObject({
      publicationStatus: 'PUBLISHED',
    });
    expect(db.toeicWritingSet.update).toHaveBeenCalled();
  });

  it('rejects a structurally incomplete set before publication', async () => {
    const invalid = { ...set, items: set.items.slice(0, 7) };
    const db: any = {
      toeicWritingSet: { findUnique: jest.fn().mockResolvedValue(invalid) },
      quiz: { findUnique: jest.fn() },
    };
    const service = new ToeicWritingSetService(db);

    await expect(service.publish(901)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.quiz.findUnique).not.toHaveBeenCalled();
  });
});
