import { ToeicAiExamService } from './toeic-ai-exam.service';

/**
 * Phase E — Admin must be able to edit candidate content BEFORE Apply, but
 * this must only ever touch the job's draftSnapshot, never the real Draft
 * (Exam / ToeicQuestionGroup) tables. EXAM_AI_CANDIDATE_EDIT_MUTATES_DRAFT=false.
 */
describe('ToeicAiExamService.updateCandidate — edits candidate, never Draft', () => {
  let service: ToeicAiExamService;
  let prisma: any;

  const draftSnapshot = {
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
                  text: 'Original stem',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 0,
                  explanation: 'orig',
                },
              ],
            },
          ],
        },
      },
    ],
    speakingWriting: {
      speaking: [{ title: 'Read Aloud', targetText: 'Hello' }],
      writing: [],
    },
  };

  beforeEach(() => {
    prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          createdByAdminId: 7,
          draftSnapshot: JSON.parse(JSON.stringify(draftSnapshot)),
          approvedSnapshot: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      exam: { findUnique: jest.fn() },
      toeicQuestionGroup: { create: jest.fn(), deleteMany: jest.fn() },
    };
    service = Object.create(ToeicAiExamService.prototype);
    (service as any).prisma = prisma;
  });

  it('edits an LR question stem and persists only into draftSnapshot', async () => {
    await service.updateCandidate('job-1', 7, 'LR:P5:G1', {
      questions: [{ questionIndex: 0, text: 'Edited stem', correctIndex: 2 }],
    });

    expect(prisma.exam.findUnique).not.toHaveBeenCalled();
    expect(prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    const savedSnapshot = updateCall.data.draftSnapshot;
    const question =
      savedSnapshot.lrBatches[0].candidate.groups[0].questions[0];
    expect(question.text).toBe('Edited stem');
    expect(question.correctIndex).toBe(2);
  });

  it('edits a Speaking task title', async () => {
    await service.updateCandidate('job-1', 7, 'SPEAKING:TASK1', {
      title: 'New title',
    });
    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    expect(
      updateCall.data.draftSnapshot.speakingWriting.speaking[0].title,
    ).toBe('New title');
  });

  it('rejects an unknown candidateKey', async () => {
    await expect(
      service.updateCandidate('job-1', 7, 'LR:P9:G9', { transcript: 'x' }),
    ).rejects.toThrow();
  });

  it('rejects a job that does not belong to the requesting admin', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 99,
      draftSnapshot,
    });
    await expect(
      service.updateCandidate('job-1', 7, 'LR:P5:G1', { transcript: 'x' }),
    ).rejects.toThrow();
  });
});
