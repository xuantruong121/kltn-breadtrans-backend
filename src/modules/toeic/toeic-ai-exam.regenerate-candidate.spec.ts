import { ToeicAiExamService } from './toeic-ai-exam.service';

/**
 * Phase A polish — targeted "Tạo lại nhóm/Part" must regenerate only the
 * bounded unit requested, leave unrelated candidate content untouched, and
 * refuse to regenerate content that has already been Applied to Draft.
 */
describe('ToeicAiExamService — targeted candidate regeneration', () => {
  let service: ToeicAiExamService;
  let prisma: any;
  let ai: any;

  const draftSnapshot = () => ({
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
                  text: 'Old Q1',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 0,
                  explanation: 'x',
                },
              ],
            },
            {
              questions: [
                {
                  text: 'Old Q2',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 1,
                  explanation: 'y',
                },
              ],
            },
          ],
        },
      },
    ],
  });

  beforeEach(() => {
    ai = {
      generateToeicExamBatch: jest.fn().mockResolvedValue({
        groups: [
          {
            questions: [
              {
                text: 'New Q',
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 2,
                explanation: 'new',
              },
            ],
          },
        ],
      }),
    };
    prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          createdByAdminId: 7,
          draftSnapshot: draftSnapshot(),
          approvedSnapshot: null,
          requestSnapshot: {
            kind: 'TOEIC_PRACTICE_EXAM',
            topic: null,
            difficulty: 'medium',
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = Object.create(ToeicAiExamService.prototype);
    (service as any).prisma = prisma;
    (service as any).ai = ai;
    (service as any).assertBatch = jest.fn();
  });

  it('regenerates only the targeted group, leaves the sibling group untouched', async () => {
    await service.regenerateCandidateGroup('job-1', 7, 'LR:P5:G1');

    const saved =
      prisma.aiGenerationJob.update.mock.calls[0][0].data.draftSnapshot;
    const groups = saved.lrBatches[0].candidate.groups;
    expect(groups[0].questions[0].text).toBe('New Q');
    expect(groups[1].questions[0].text).toBe('Old Q2');
  });

  it('refuses to regenerate a candidateKey that has already been applied', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: draftSnapshot(),
      approvedSnapshot: { appliedCandidateKeys: ['LR:P5:G1'] },
      requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM' },
    });

    await expect(
      service.regenerateCandidateGroup('job-1', 7, 'LR:P5:G1'),
    ).rejects.toThrow();
    expect(ai.generateToeicExamBatch).not.toHaveBeenCalled();
  });

  it('Part-level regenerate skips already-applied groups in that Part', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      draftSnapshot: draftSnapshot(),
      approvedSnapshot: { appliedCandidateKeys: ['LR:P5:G1'] },
      requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM', difficulty: 'medium' },
    });

    await service.regenerateCandidatePart('job-1', 7, 5);

    expect(ai.generateToeicExamBatch).toHaveBeenCalledTimes(1);
    const saved =
      prisma.aiGenerationJob.update.mock.calls[0][0].data.draftSnapshot;
    const groups = saved.lrBatches[0].candidate.groups;
    expect(groups[0].questions[0].text).toBe('Old Q1');
    expect(groups[1].questions[0].text).toBe('New Q');
  });
});
