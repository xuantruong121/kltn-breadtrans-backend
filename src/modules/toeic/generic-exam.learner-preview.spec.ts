import { GenericExamService } from './generic-exam.service';

/**
 * Phase G — Admin "Xem như học viên" preview DTO must strictly exclude
 * answer keys / grading internals, and must be read-only (no ExamAttempt /
 * ToeicAssessmentAttempt write call anywhere in its path).
 */
describe('GenericExamService.getLearnerPreview', () => {
  let service: GenericExamService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      exam: {
        findUnique: jest.fn().mockResolvedValue({
          id: 42,
          title: 'Practice Test A',
          toeicExamSet: {
            groups: [
              {
                part: 5,
                groupOrder: 1,
                imageUrl: null,
                passageText: null,
                audioUrl: null,
                questions: [
                  {
                    id: 1,
                    questionNumber: 1,
                    text: 'Sample stem',
                    options: ['A', 'B', 'C', 'D'],
                    correctIndex: 2,
                    explanation: 'Because of grammar rule X',
                  },
                ],
              },
            ],
          },
          toeicAssessment: {
            components: [
              {
                writingSet: {
                  items: [
                    {
                      id: 9,
                      order: 1,
                      taskKind: 'PICTURE_SENTENCE',
                      writingQuiz: {
                        questions: [
                          {
                            content: {
                              prompt: 'Describe the picture',
                              taskType: 'PICTURE_SENTENCE',
                              imageUrl: 'https://img',
                              keywords: ['bus', 'street'],
                              wordRange: { min: 5, max: 20 },
                              aiMedia: { provider: 'secret-internal' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        }),
      },
      toeicAttempt: { create: jest.fn() },
      toeicAssessmentAttempt: { create: jest.fn() },
    };
    service = Object.create(GenericExamService.prototype);
    (service as any).prisma = prisma;
  });

  it('never exposes correctIndex/explanation for L&R questions', async () => {
    const result = await service.getLearnerPreview(42);
    const question = result.lr!.groups[0].questions[0];
    expect(question).not.toHaveProperty('correctIndex');
    expect(question).not.toHaveProperty('explanation');
    expect(question.text).toBe('Sample stem');
  });

  it('strips AI-internal provenance from writing task content', async () => {
    const result = await service.getLearnerPreview(42);
    const task = result.writing![0];
    expect(task).not.toHaveProperty('aiMedia');
    expect(task.prompt).toBe('Describe the picture');
  });

  it('marks the DTO as preview and never creates an attempt', async () => {
    const result = await service.getLearnerPreview(42);
    expect(result.preview).toBe(true);
    expect(prisma.toeicAttempt.create).not.toHaveBeenCalled();
    expect(prisma.toeicAssessmentAttempt.create).not.toHaveBeenCalled();
  });
});

describe('GenericExamService.getLearnerPreview audio Parts', () => {
  it('hides Part 1 and 2 wording and gives a playable source', async () => {
    const service: any = Object.create(GenericExamService.prototype);
    service.prisma = {
      exam: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          title: 'Đề 02',
          toeicExamSet: {
            id: 3,
            groups: [
              {
                id: 8,
                part: 2,
                groupOrder: 7,
                imageUrl: null,
                passageText: 'AUDIO PROMPT: secret',
                audioUrl: 'https://cdn.test/a.mp3',
                questions: [
                  {
                    id: 1,
                    questionNumber: 7,
                    text: 'Choose the best response.',
                    options: ['Yes.', 'No.', 'Maybe.'],
                    correctIndex: 1,
                  },
                ],
              },
            ],
          },
          toeicAssessment: null,
        }),
      },
    };

    const preview = await service.getLearnerPreview(5);

    const group = preview.lr.groups[0];
    expect(group).toMatchObject({
      id: 8,
      passageText: null,
      audioSrc: 'https://cdn.test/a.mp3',
    });
    expect(group.questions[0]).toEqual({
      id: 1,
      questionNumber: 7,
      text: null,
      options: ['', '', ''],
    });
  });
});
