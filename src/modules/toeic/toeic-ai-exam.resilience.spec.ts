import { AiGenerationJobStatus } from '@prisma/client';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import { pictureCardHiddenReason } from '../content/skill-cms-list';

const validBatch = (provider?: 'CLOUDFLARE') => ({
  groups: [
    {
      questions: [
        {
          text: 'The report _____ on Friday.',
          options: ['arrives', 'arrival', 'arriving', 'arrived'],
          correctIndex: 0,
          explanation: 'Câu cần động từ chia ở hiện tại đơn sau chủ ngữ số ít.',
        },
      ],
    },
  ],
  ...(provider ? { provider } : {}),
});

function build(generate: jest.Mock) {
  const service: any = Object.create(ToeicAiExamService.prototype);
  service.ai = { generateToeicExamBatch: generate };
  return service;
}

const draft = (service: any) =>
  service.draftCheckedBatch(
    { part: 5, difficulty: 'medium', groups: [{ questionCount: 1 }] },
    101,
    [{ questionCount: 1 }],
    [],
    { batchKey: '5:0', groupOrder: 1 },
  );

describe('a batch that comes back wrong', () => {
  it('retries with the reason and keeps the good draft', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce({ groups: [] })
      .mockResolvedValueOnce(validBatch());
    const outcome = await draft(build(generate));

    expect(outcome.batch).toBeDefined();
    expect(generate.mock.calls[1][0].retryNote).toContain('sai cấu trúc');
  });

  it('turns unreadable output into a refusal of that batch alone', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(new SyntaxError('Unexpected token'));
    const outcome = await draft(build(generate));

    expect(generate).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      refusal: 'Unexpected token',
      code: 'CONTENT_CONTRACT_FAILURE',
    });
  });

  it('stops at an outage: three more calls could not help', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('quota'), { status: 429 }));

    await expect(draft(build(generate))).rejects.toThrow('quota');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('marks the groups the stand-in wrote', async () => {
    const generate = jest.fn().mockResolvedValue(validBatch('CLOUDFLARE'));
    const outcome = await draft(build(generate));

    expect(outcome.batch.candidate.groups[0].provider).toBe('CLOUDFLARE');
  });
});

describe('retrying a job', () => {
  it('lets a failed Speaking and Writing draft run again', async () => {
    const service: any = Object.create(ToeicAiExamService.prototype);
    const job = {
      id: 'job',
      createdByAdminId: 1,
      status: AiGenerationJobStatus.FAILED,
      requestSnapshot: { plan: {} },
      resultSnapshot: { failedScope: { kind: 'speaking-writing' } },
      draftSnapshot: null,
    };
    service.prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue(job),
      },
    };
    service.queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue({}),
    };
    service.status = jest.fn().mockResolvedValue({ id: 'job' });

    await expect(service.retry('job', 1)).resolves.toEqual({ id: 'job' });
    expect(service.queue.add).toHaveBeenCalled();
  });
});

describe('why learners do not see a picture', () => {
  const card = {
    publicationStatus: 'PUBLISHED',
    hasPracticeTopic: true,
    imageUrl: 'https://a',
    keywords: ['file', 'shelf'],
  };

  it('is nothing for a card they see', () => {
    expect(pictureCardHiddenReason(card)).toBeNull();
  });

  it('names what is in the way', () => {
    expect(
      pictureCardHiddenReason({ ...card, publicationStatus: 'DRAFT' }),
    ).toContain('xuất bản');
    expect(
      pictureCardHiddenReason({ ...card, hasPracticeTopic: false }),
    ).toContain('chủ đề');
    expect(pictureCardHiddenReason({ ...card, imageUrl: null })).toContain(
      'ảnh',
    );
    expect(pictureCardHiddenReason({ ...card, keywords: ['a'] })).toContain(
      '2 từ khoá',
    );
  });
});
