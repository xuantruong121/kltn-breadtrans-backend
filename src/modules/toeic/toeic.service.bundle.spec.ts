import { ToeicService } from './toeic.service';

describe('ToeicService four-skill bundle compatibility', () => {
  it('loads the canonical TOEIC_4_SKILLS metadata format', async () => {
    const prisma: any = {
      quiz: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 22,
            title: 'TOEIC 4 kỹ năng',
            description: 'Bundle',
            bilingualContent: {
              examFormat: 'TOEIC_4_SKILLS',
              isBundle: true,
              listeningReadingExamSetId: 1,
              speakingWritingQuizId: 20,
            },
          })
          .mockResolvedValueOnce({
            id: 20,
            title: 'TOEIC Speaking and Writing',
            description: 'Tasks',
            questions: [],
          }),
      },
    };
    const service = new ToeicService(prisma, {} as any);
    jest
      .spyOn(service, 'getExamDetails')
      .mockResolvedValue({ id: 1, title: 'TOEIC L&R' } as any);

    await expect(service.getBundle(22)).resolves.toMatchObject({
      id: 22,
      listeningReading: { id: 1 },
      speakingWriting: { id: 20, questions: [] },
    });
  });
});
