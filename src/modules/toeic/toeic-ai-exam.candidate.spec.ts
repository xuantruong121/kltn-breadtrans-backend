import { ToeicAiExamService } from './toeic-ai-exam.service';

/**
 * Phase E (backend half) — Candidate content must be reviewable by Admin
 * BEFORE Apply, with deterministic (non-AI) flags on real question/task
 * content, never just a count.
 */
describe('ToeicAiExamService.getCandidate — Phase E candidate-first review', () => {
  let service: ToeicAiExamService;
  let prisma: any;

  beforeEach(() => {
    prisma = { aiGenerationJob: { findUnique: jest.fn() } };
    service = Object.create(ToeicAiExamService.prototype);
    (service as any).prisma = prisma;
  });

  it('exposes actual question content, not just a count', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: {
        version: 1,
        lrBatches: [
          {
            part: 2,
            groupOrder: 1,
            questionNumber: 1,
            candidate: {
              groups: [
                {
                  transcript: 'Man: Where is the meeting? Woman: Room 2.',
                  questions: [
                    {
                      text: 'Where is the meeting?',
                      options: ['A', 'B', 'C'],
                      correctIndex: 1,
                      explanation: 'Because...',
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    const result = await service.getCandidate('job-1', 7);
    expect(result.lrGroups).toHaveLength(1);
    expect(result.lrGroups[0].questions[0]).toMatchObject({
      questionNumber: 1,
      text: 'Where is the meeting?',
      options: ['A', 'B', 'C'],
      issues: [],
    });
    expect(result.flaggedCount).toBe(0);
  });

  it('flags a question with an invalid answer key (deterministic, no AI call)', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: {
        version: 1,
        lrBatches: [
          {
            part: 5,
            groupOrder: 1,
            questionNumber: 1,
            candidate: {
              groups: [
                {
                  questions: [
                    {
                      text: 'Sample sentence.',
                      options: ['A', 'B', 'A', 'D'],
                      correctIndex: 9,
                      explanation: 'x',
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    const result = await service.getCandidate('job-1', 7);
    expect(result.lrGroups[0].questions[0].issues).toEqual(
      expect.arrayContaining([
        'Có đáp án trùng lặp',
        'Chưa có đáp án đúng hợp lệ',
      ]),
    );
    expect(result.flaggedCount).toBe(1);
  });

  it('flags a Listening group (Part 1-4) missing transcript/audio', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: {
        version: 1,
        lrBatches: [
          {
            part: 3,
            groupOrder: 1,
            questionNumber: 1,
            candidate: { groups: [{ transcript: '', questions: [] }] },
          },
        ],
      },
    });

    const result = await service.getCandidate('job-1', 7);
    expect(result.lrGroups[0].issues).toContain('Chưa có transcript/audio');
  });

  it('exposes real Speaking/Writing task content with deterministic flags', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: {
        version: 1,
        lrBatches: [],
        speakingWriting: {
          speaking: [{ title: 'Read Aloud', targetText: 'Hello world' }],
          writing: [{ taskKind: 'PICTURE_SENTENCE', prompt: '' }],
        },
      },
    });

    const result = await service.getCandidate('job-1', 7);
    expect(result.speaking[0]).toMatchObject({ taskNumber: 1, issues: [] });
    expect(result.writing[0].issues).toEqual(
      expect.arrayContaining(['Chưa có đề bài', 'Chưa có hình ảnh']),
    );
    expect(result.flaggedCount).toBe(1);
  });

  it('rejects a job that does not belong to the requesting admin', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 99,
      draftSnapshot: {},
    });
    await expect(service.getCandidate('job-1', 7)).rejects.toThrow();
  });
});
