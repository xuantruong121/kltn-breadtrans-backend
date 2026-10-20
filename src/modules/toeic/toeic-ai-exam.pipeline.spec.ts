import { AiGenerationJobStatus } from '@prisma/client';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../speaking/toeic-speaking-contract';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../writing/toeic-writing-set.contract';

type PlannedGroup = { questionCount: number; kind?: 'SINGLE' | 'MULTIPLE' };

const fullPlan: Record<number, PlannedGroup[]> = {
  1: Array.from({ length: 6 }, () => ({ questionCount: 1 })),
  2: Array.from({ length: 25 }, () => ({ questionCount: 1 })),
  3: Array.from({ length: 13 }, () => ({ questionCount: 3 })),
  4: Array.from({ length: 10 }, () => ({ questionCount: 3 })),
  5: Array.from({ length: 30 }, () => ({ questionCount: 1 })),
  6: Array.from({ length: 4 }, () => ({ questionCount: 4 })),
  7: [
    { questionCount: 2, kind: 'SINGLE' as const },
    ...Array.from({ length: 9 }, () => ({
      questionCount: 3,
      kind: 'SINGLE' as const,
    })),
    ...Array.from({ length: 5 }, () => ({
      questionCount: 5,
      kind: 'MULTIPLE' as const,
    })),
  ],
};

let sequence = 0;
function batchFor(part: number, groups: PlannedGroup[]) {
  return {
    groups: groups.map((plan, groupIndex) => {
      const groupKey = `${part}-${sequence++}-${groupIndex}`;
      return {
        ...(part <= 4
          ? { transcript: `Speaker: Listening transcript ${groupKey}.` }
          : {}),
        ...(part === 1
          ? { imageBrief: `A realistic office scene ${groupKey}.` }
          : {}),
        ...(part >= 6 ? { passageText: `Reading passage ${groupKey}.` } : {}),
        questions: Array.from(
          { length: plan.questionCount },
          (_, questionIndex) => ({
            text: `Question ${groupKey}-${questionIndex + 1}`,
            options: Array.from(
              { length: part === 2 ? 3 : 4 },
              (_, optionIndex) =>
                `Option ${groupKey}-${questionIndex + 1}-${optionIndex + 1}`,
            ),
            correctIndex: 0,
            explanation: `Giải thích hợp lệ và nhất quán cho ${groupKey}-${questionIndex + 1}.`,
          }),
        ),
      };
    }),
  };
}

function speakingWritingDraft() {
  return {
    speaking: TOEIC_SPEAKING_TASK_SEQUENCE.map((taskType, index) => ({
      taskType,
      title: `Speaking ${index + 1}`,
      targetText: `Learner prompt for speaking task ${index + 1}.`,
      ...(index === 2 || index === 3
        ? { imageBrief: `Speaking image ${index + 1}` }
        : {}),
      ...(index >= 7 && index <= 9
        ? {
            informationStimulus:
              'Conference schedule: registration opens at 8 a.m.',
          }
        : {}),
    })),
    writing: TOEIC_WRITING_SLOT_CONTRACT.map((taskKind, index) => ({
      taskKind,
      title: `Writing ${index + 1}`,
      prompt: `Write a complete response for task ${index + 1}.`,
      ...(taskKind === 'PICTURE_SENTENCE'
        ? { imageBrief: `Writing image ${index + 1}` }
        : {}),
    })),
  };
}

function fixture(
  request: any,
  options?: { hasLr?: boolean; failOnCall?: number; malformed?: boolean },
) {
  const updates: any[] = [];
  const runtimeJob: any = {
    id: 'qa-job',
    createdByAdminId: 1,
    status: AiGenerationJobStatus.QUEUED,
    requestSnapshot: request,
    resultSnapshot: { parts: {} },
    draftSnapshot: null,
  };
  const ai = {
    generateToeicExamBatch: jest.fn((input: any) => {
      const call = ai.generateToeicExamBatch.mock.calls.length;
      if (options?.failOnCall === call) throw new Error('Gemini timeout');
      const candidate = batchFor(input.part, input.groups);
      if (options?.malformed)
        candidate.groups[0].questions[0].options = ['only one'];
      return candidate;
    }),
    generateToeicSpeakingWritingDraft: jest
      .fn()
      .mockResolvedValue(speakingWritingDraft()),
  };
  const prisma: any = {
    aiGenerationJob: {
      findUnique: jest.fn().mockImplementation(() => runtimeJob),
      findUniqueOrThrow: jest.fn().mockImplementation(() => ({
        resultSnapshot: runtimeJob.resultSnapshot,
        status: runtimeJob.status,
      })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        updates.push({ data });
        if (data.status) runtimeJob.status = data.status;
        if ('draftSnapshot' in data)
          runtimeJob.draftSnapshot = data.draftSnapshot;
        if (data.resultSnapshot)
          runtimeJob.resultSnapshot = data.resultSnapshot;
        return runtimeJob;
      }),
    },
    exam: {
      findUnique: jest.fn().mockResolvedValue({
        id: 814,
        toeicExamSet:
          options?.hasLr === false ? null : { id: 22, difficulty: 'medium' },
        toeicAssessment:
          request.variantCode === 'TOEIC_LR'
            ? null
            : { id: 15, components: [] },
      }),
    },
    toeicAttempt: { count: jest.fn().mockResolvedValue(0) },
    toeicAssessmentAttempt: { count: jest.fn().mockResolvedValue(0) },
    toeicQuestionGroup: { create: jest.fn() },
  };
  const service: any = Object.create(ToeicAiExamService.prototype);
  service.prisma = prisma;
  service.ai = ai;
  service.queue = {
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockResolvedValue(undefined),
  };
  return { service, ai, prisma, runtimeJob, updates };
}

const requestFor = (
  variantCode: 'TOEIC_LR' | 'TOEIC_SW' | 'TOEIC_4_SKILLS',
  plan: Record<number, PlannedGroup[]>,
) => ({
  kind: 'TOEIC_PRACTICE_EXAM',
  mode: 'FULL_EXAM',
  variantCode,
  difficulty: 'medium',
  plan,
});

describe('ToeicAiExamService controlled template pipeline', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('generates the complete 200-question L&R candidate with canonical group semantics before Apply', async () => {
    const harness = fixture(requestFor('TOEIC_LR', fullPlan));
    await harness.service.process({ data: { jobId: 'qa-job' } });

    const candidate = harness.runtimeJob.draftSnapshot;
    const groups = candidate.lrBatches.flatMap((batch: any) =>
      batch.candidate.groups.map((group: any) => ({
        ...group,
        part: batch.part,
      })),
    );
    const counts = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((part) => [
        part,
        groups
          .filter((group: any) => group.part === part)
          .reduce(
            (total: number, group: any) => total + group.questions.length,
            0,
          ),
      ]),
    );
    expect(candidate.partial).toBe(false);
    expect(counts).toEqual({ 1: 6, 2: 25, 3: 39, 4: 30, 5: 30, 6: 16, 7: 54 });
    expect(
      groups.reduce(
        (total: number, group: any) => total + group.questions.length,
        0,
      ),
    ).toBe(200);
    expect(groups.filter((group: any) => group.part === 3)).toHaveLength(13);
    expect(groups.filter((group: any) => group.part === 4)).toHaveLength(10);
    expect(groups.filter((group: any) => group.part === 6)).toHaveLength(4);
    expect(
      groups
        .filter((group: any) => group.part === 7)
        .map((group: any) => group.questions.length),
    ).toEqual([2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5]);
    expect(harness.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
  });

  it('generates the exact S&W 11 + 8 candidate and keeps Q8–10 on one shared stimulus', async () => {
    const harness = fixture(requestFor('TOEIC_SW', {}), { hasLr: false });
    await harness.service.process({ data: { jobId: 'qa-job' } });

    const draft = harness.runtimeJob.draftSnapshot.speakingWriting;
    expect(draft.speaking.map((item: any) => item.taskType)).toEqual(
      TOEIC_SPEAKING_TASK_SEQUENCE,
    );
    expect(draft.writing.map((item: any) => item.taskKind)).toEqual(
      TOEIC_WRITING_SLOT_CONTRACT,
    );
    expect(
      new Set(
        draft.speaking
          .slice(7, 10)
          .map((item: any) => item.informationStimulus),
      ).size,
    ).toBe(1);
  });

  it('composes a 4-Skills candidate from L&R plus S&W without writing CMS content', async () => {
    const harness = fixture(requestFor('TOEIC_4_SKILLS', fullPlan));
    await harness.service.process({ data: { jobId: 'qa-job' } });

    const candidate = harness.runtimeJob.draftSnapshot;
    const total = candidate.lrBatches
      .flatMap((batch: any) => batch.candidate.groups)
      .reduce((sum: number, group: any) => sum + group.questions.length, 0);
    expect(total).toBe(200);
    expect(candidate.speakingWriting.speaking).toHaveLength(11);
    expect(candidate.speakingWriting.writing).toHaveLength(8);
    expect(harness.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
  });

  it('fails malformed provider output safely without writing a Draft', async () => {
    const harness = fixture(
      requestFor('TOEIC_LR', { 5: [{ questionCount: 1 }] }),
      { malformed: true },
    );
    await expect(
      harness.service.process({ data: { jobId: 'qa-job' } }),
    ).rejects.toThrow('AI trả về phương án không hợp lệ');
    expect(harness.runtimeJob.status).toBe(AiGenerationJobStatus.FAILED);
    expect(harness.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
  });

  it('rejects an exact duplicate returned across otherwise valid batches', async () => {
    const harness = fixture(
      requestFor('TOEIC_LR', {
        5: Array.from({ length: 4 }, () => ({ questionCount: 1 })),
      }),
    );
    let first: any;
    harness.ai.generateToeicExamBatch.mockImplementation((input: any) => {
      if (!first) {
        first = batchFor(input.part, input.groups);
        return first;
      }
      return { groups: [{ questions: [first.groups[0].questions[0]] }] };
    });
    await expect(
      harness.service.process({ data: { jobId: 'qa-job' } }),
    ).rejects.toThrow('AI trả về câu hỏi trùng lặp giữa các batch');
    expect(harness.runtimeJob.status).toBe(AiGenerationJobStatus.FAILED);
    expect(harness.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
  });

  it('keeps validated completed batches and retries only the failed batch scope', async () => {
    const request = requestFor('TOEIC_LR', {
      5: Array.from({ length: 4 }, () => ({ questionCount: 1 })),
    });
    const harness = fixture(request, { failOnCall: 2 });
    await expect(
      harness.service.process({ data: { jobId: 'qa-job' } }),
    ).rejects.toThrow('Gemini timeout');
    expect(harness.runtimeJob.draftSnapshot).toMatchObject({
      partial: true,
      lrBatches: [expect.objectContaining({ batchKey: '5:0' })],
    });
    expect(harness.runtimeJob.resultSnapshot).toMatchObject({
      stage: 'FAILED',
      failedScope: { kind: 'batch', part: 5, offset: 3 },
    });

    await harness.service.retry('qa-job', 1);
    await harness.service.process({ data: { jobId: 'qa-job' } });

    expect(
      harness.ai.generateToeicExamBatch.mock.calls.map(
        (call: any[]) => call[0].groups.length,
      ),
    ).toEqual([3, 1, 1]);
    expect(harness.runtimeJob.status).toBe(AiGenerationJobStatus.GENERATED);
    expect(harness.runtimeJob.draftSnapshot).toMatchObject({
      partial: false,
      lrBatches: [expect.anything(), expect.anything()],
    });
  });

  it('returns the durable existing job for the same generation idempotency key', async () => {
    const existing: any = {
      id: 'same-job',
      status: 'QUEUED',
      requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM' },
      resultSnapshot: {},
    };
    const service: any = Object.create(ToeicAiExamService.prototype);
    service.prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
      exam: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    service.genericExam = { createDraft: jest.fn() };
    service.queue = { add: jest.fn() };
    const result = await service.start(
      { variantCode: 'TOEIC_LR', mode: 'PART', part: 5, difficulty: 'medium' },
      1,
      'same-request',
    );
    expect(result.id).toBe('same-job');
    expect(service.genericExam.createDraft).not.toHaveBeenCalled();
    expect(service.queue.add).not.toHaveBeenCalled();
  });

  it('returns a scoped Part candidate without mutating Draft content and blocks a Published source', async () => {
    const service: any = Object.create(ToeicAiExamService.prototype);
    const findUnique = jest.fn().mockResolvedValue({
      publicationStatus: 'DRAFT',
      toeicExamSet: { id: 22, difficulty: 'medium', _count: { attempts: 0 } },
    });
    service.prisma = {
      exam: { findUnique },
      toeicQuestionGroup: { create: jest.fn() },
    };
    service.ai = {
      generateToeicExamBatch: jest.fn((input: any) =>
        batchFor(input.part, input.groups),
      ),
    };
    const candidate = await service.regeneratePartCandidate(814, 5, 'meetings');
    expect(candidate).toMatchObject({
      mode: 'CANDIDATE_ONLY',
      part: 5,
      requiresConfirmationToApply: true,
    });
    expect(candidate.groups).toHaveLength(30);
    expect(service.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce({
      publicationStatus: 'PUBLISHED',
      toeicExamSet: { id: 22, difficulty: 'medium', _count: { attempts: 0 } },
    });
    await expect(service.regeneratePartCandidate(814, 5)).rejects.toThrow(
      'Chỉ Draft mới có thể tạo lại nội dung AI',
    );
  });
});
