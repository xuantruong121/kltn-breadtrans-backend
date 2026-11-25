import { AiService } from './ai.service';

/**
 * "Soạn cả bài bằng AI" for "Nghe chép" (QA 2026-11-22): one paragraph plus
 * MCQs could never be published; the draft is now 10-30 English sentences,
 * each its own dictation item.
 */
describe('AiService.suggestListeningFullDraft', () => {
  const sentences = (n: number) =>
    Array.from({ length: n }, (_, i) => `The bus number ${i + 1} is late.`);
  const build = (lines: unknown) => {
    const evaluator = {
      suggestDictationLines: jest.fn().mockResolvedValue({
        title: 'Xe buýt',
        description: 'Nghe và chép lại.',
        sentences: lines,
      }),
      suggestListeningFullDraft: jest.fn().mockResolvedValue({ mode: 'X' }),
    };
    return { evaluator, service: new AiService(evaluator as any) };
  };

  it('drafts dictation as English sentences from the dictation-lines writer', async () => {
    const { evaluator, service } = build([
      ...sentences(22),
      'Xe buýt số 5 đến muộn.',
    ]);
    const draft = await service.suggestListeningFullDraft({
      topic: 'xe buýt',
      level: 'A2',
      mode: 'DICTATION',
      count: 20,
    });
    expect(evaluator.suggestListeningFullDraft).not.toHaveBeenCalled();
    expect(evaluator.suggestDictationLines).toHaveBeenCalledWith({
      topic: 'xe buýt',
      level: 'A2',
      count: 20,
      sourceText: undefined,
    });
    expect(draft.mode).toBe('DICTATION');
    expect(draft.questions).toEqual([]);
    expect(draft.sentences).toHaveLength(20);
    expect(draft.sentences?.some((line) => /đ|ế/.test(line))).toBe(false);
  });

  it('asks for 10 to 30 sentences whatever count arrives', async () => {
    const { evaluator, service } = build(sentences(30));
    await service.suggestListeningFullDraft({
      topic: 't',
      mode: 'DICTATION',
      count: 5,
    });
    await service.suggestListeningFullDraft({
      topic: 't',
      mode: 'DICTATION',
      count: 40,
    });
    expect(
      evaluator.suggestDictationLines.mock.calls.map(([input]) => input.count),
    ).toEqual([10, 30]);
  });

  it('fails with a plain error when no English sentence comes back', async () => {
    const { service } = build(['Xin chào các bạn nhé.']);
    await expect(
      service.suggestListeningFullDraft({
        topic: 't',
        mode: 'DICTATION',
        count: 20,
      }),
    ).rejects.toThrow('AI không trả về câu nghe chép tiếng Anh hợp lệ');
  });

  it('leaves the other forms to the full-draft writer', async () => {
    const { evaluator, service } = build([]);
    await service.suggestListeningFullDraft({
      topic: 't',
      mode: 'DIALOGUE',
      count: 5,
    });
    expect(evaluator.suggestListeningFullDraft).toHaveBeenCalled();
    expect(evaluator.suggestDictationLines).not.toHaveBeenCalled();
  });
});
