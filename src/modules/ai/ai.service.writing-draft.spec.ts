import { UnprocessableEntityException } from '@nestjs/common';

import { AiService } from './ai.service';

/** "Tạo bằng AI" on the Writing page (owner 2026-11-19). */
describe('AiService.suggestWritingFullDraft', () => {
  const input = {
    topic: 'Công việc văn phòng',
    level: 'INTERMEDIATE',
    kind: 'EMAIL' as const,
    count: 3,
  };
  const build = (answer: unknown) =>
    new AiService({
      suggestWritingFullDraft: jest.fn().mockResolvedValue(answer),
    } as any);

  it('returns only the tasks that pass the checks', async () => {
    const draft = await build({
      title: 'Email công việc',
      description: 'Ba email ngắn.',
      tasks: [
        { taskType: 'REQUEST', prompt: 'Ask for a day off.' },
        { taskType: 'OPINION', prompt: 'Write an essay.' },
      ],
    }).suggestWritingFullDraft(input);
    expect(draft.tasks).toHaveLength(1);
    expect(draft.dropped).toBe(1);
  });

  it('answers 422 when no task passes, so nothing half-made reaches the editor', async () => {
    await expect(
      build({
        tasks: [{ taskType: 'PICTURE_SENTENCE', prompt: 'Describe it.' }],
      }).suggestWritingFullDraft(input),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
