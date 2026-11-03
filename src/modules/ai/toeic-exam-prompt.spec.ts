import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiService } from './ai.service';
import {
  CloudflareWorkersAiClient,
  cloudflareAnswerText,
  isAiOutage,
} from './cloudflare-workers-ai.client';
import {
  toeicBatchRequest,
  toeicSpeakingWritingRequest,
} from './toeic-exam-prompt';

const base = { difficulty: 'medium' as const };

describe('the request for a TOEIC batch', () => {
  it('says which groups need three speakers, a graphic or several documents', () => {
    const conversations = toeicBatchRequest({
      ...base,
      part: 3,
      groups: [
        { questionCount: 3, threeSpeakers: true },
        { questionCount: 3, graphic: true },
      ],
    }).prompt;
    expect(conversations).toContain('Group 1: 3 questions (three speakers)');
    expect(conversations).toContain('Group 2: 3 questions (with a graphic)');
    expect(conversations).toContain('GRAPHIC: <short title>');
    expect(conversations).toContain('What does the man mean when he says');

    const passages = toeicBatchRequest({
      ...base,
      part: 7,
      groups: [{ questionCount: 5, kind: 'MULTIPLE', documents: 3 }],
    }).prompt;
    expect(passages).toContain('(MULTIPLE, exactly 3 documents)');
    expect(passages).toContain('DOCUMENT 1');
    expect(passages).toContain('closest in meaning');
  });

  it('tells a retry why the last draft was refused', () => {
    const { prompt } = toeicBatchRequest({
      ...base,
      part: 5,
      groups: [{ questionCount: 1 }],
      retryNote: 'Part 5: câu hỏi phải là một câu có chỗ trống',
    });
    expect(prompt).toContain('REJECTED');
    expect(prompt).toContain('Part 5: câu hỏi phải là một câu có chỗ trống');
  });

  it('asks Writing for two keywords, the e-mail itself and a 300-word essay', () => {
    const { prompt, schema } = toeicSpeakingWritingRequest({
      ...base,
      includeSpeaking: true,
      includeWriting: true,
    });
    expect(prompt).toContain('exactly two required English keywords');
    expect(prompt).not.toContain('three required');
    expect(prompt).toContain('wordRange [300,500]');
    expect(prompt).not.toContain('[80,120]');
    expect(JSON.stringify(schema)).toContain('"email"');
  });
});

describe('the Cloudflare stand-in', () => {
  const batch = { groups: [{ questions: [{ text: 'q' }] }] };
  const input = {
    ...base,
    part: 5,
    groups: [{ questionCount: 1 }],
  };
  const build = (error: unknown, configured = true) => {
    const evaluator = {
      generateToeicExamBatch: jest.fn().mockRejectedValue(error),
    };
    const cloudflare = {
      configured: () => configured,
      generateJson: jest.fn().mockResolvedValue(batch),
    };
    return {
      cloudflare,
      service: new AiService(
        evaluator as any,
        undefined,
        cloudflare as unknown as CloudflareWorkersAiClient,
      ),
    };
  };

  it('takes over when Gemini is out of quota, and says so on the batch', async () => {
    const { service, cloudflare } = build(
      Object.assign(new Error('quota'), { status: 429 }),
    );
    await expect(service.generateToeicExamBatch(input)).resolves.toMatchObject({
      provider: 'CLOUDFLARE',
    });
    expect(cloudflare.generateJson).toHaveBeenCalled();
  });

  it('stays out of a wrong answer, which a retry can fix', async () => {
    const { service, cloudflare } = build(new SyntaxError('Unexpected token'));
    await expect(service.generateToeicExamBatch(input)).rejects.toThrow(
      'Unexpected token',
    );
    expect(cloudflare.generateJson).not.toHaveBeenCalled();
  });

  it('does nothing without a token', async () => {
    const { service, cloudflare } = build(
      Object.assign(new Error('quota'), { status: 429 }),
      false,
    );
    await expect(service.generateToeicExamBatch(input)).rejects.toThrow(
      'quota',
    );
    expect(cloudflare.generateJson).not.toHaveBeenCalled();
  });

  it('reads the answer wherever the model puts it', () => {
    expect(cloudflareAnswerText({ response: '{"a":1}' })).toBe('{"a":1}');
    expect(cloudflareAnswerText({ response: { a: 1 } })).toBe('{"a":1}');
    expect(
      cloudflareAnswerText({ choices: [{ message: { content: 'x' } }] }),
    ).toBe('x');
  });

  it('counts a provider failure as an outage, not a bad answer', () => {
    expect(isAiOutage({ status: 503 })).toBe(true);
    expect(isAiOutage({ code: 'CLOUDFLARE_UNAVAILABLE' })).toBe(true);
    expect(isAiOutage(new SyntaxError('Unexpected token'))).toBe(false);
  });
});

describe('every AiService', () => {
  // The exam module gets the copy from SpeakingProcessingModule. Loading that
  // module here would open Redis, so its provider list is read as text.
  it('can reach the stand-in in each module that provides one', () => {
    for (const file of [
      'ai.module.ts',
      '../speaking/speaking-processing.module.ts',
    ]) {
      const providers = readFileSync(join(__dirname, file), 'utf8').split(
        'providers:',
      )[1];
      expect(providers).toContain('AiService,');
      expect(providers).toContain('CloudflareWorkersAiClient,');
    }
  });
});

describe('exam images', () => {
  const build = (geminiFails = false) => {
    const evaluator = {
      generateToeicExamImage: jest.fn().mockResolvedValue({
        buffer: Buffer.from('g'),
        mimeType: 'image/png',
      }),
    };
    const cloudflare = {
      configured: () => true,
      generateImage: geminiFails
        ? jest.fn().mockRejectedValue(new Error('down'))
        : jest.fn().mockResolvedValue({
            buffer: Buffer.from('c'),
            mimeType: 'image/jpeg',
          }),
    };
    return {
      evaluator,
      cloudflare,
      service: new AiService(
        evaluator as any,
        undefined,
        cloudflare as unknown as CloudflareWorkersAiClient,
      ),
    };
  };
  afterEach(() => delete process.env.GEMINI_IMAGE_GENERATION);

  it('uses Cloudflare before the paid Gemini model', async () => {
    process.env.GEMINI_IMAGE_GENERATION = 'enabled';
    const { service, evaluator } = build();
    const image = await service.generateToeicExamImage({ brief: 'x', part: 1 });
    expect(image.mimeType).toBe('image/jpeg');
    expect(evaluator.generateToeicExamImage).not.toHaveBeenCalled();
  });

  it('leaves Gemini off when it is not switched on', async () => {
    const { service, evaluator } = build(true);
    await expect(
      service.generateToeicExamImage({ brief: 'x', part: 1 }),
    ).rejects.toThrow('down');
    expect(evaluator.generateToeicExamImage).not.toHaveBeenCalled();
  });
});
