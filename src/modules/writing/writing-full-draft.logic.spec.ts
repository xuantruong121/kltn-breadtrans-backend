import { cleanWritingFullDraft } from './writing-full-draft.logic';

/** A model answer as Gemini returns it; no network in this spec. */
const translationFixture = {
  title: 'Dịch câu: Ở nhà hàng',
  description: 'Câu ngắn khi gọi món.',
  tasks: [
    {
      prompt: 'Tôi muốn gọi một ly cà phê.',
      acceptedAnswers: [
        'I would like to order a coffee.',
        "I'd like to order a coffee.",
        ' I would like to order a coffee. ',
      ],
      hints: [{ vi: 'gọi món', en: 'order' }],
      grammarTip: 'Dùng "would like to" để lịch sự.',
    },
    // Dropped: the Vietnamese sentence has no diacritics, one answer only.
    {
      prompt: 'Toi muon an pho.',
      acceptedAnswers: ['I want to eat pho.'],
      hints: [{ vi: 'phở', en: 'pho' }],
      grammarTip: 'x',
    },
    // Dropped: no hints and no grammar tip.
    {
      prompt: 'Hóa đơn đây ạ.',
      acceptedAnswers: ['Here is the bill.', 'Here is your bill.'],
      hints: [],
      grammarTip: '',
    },
  ],
};

describe('cleanWritingFullDraft', () => {
  it('keeps a valid translation task, deduplicated, and drops the broken ones', () => {
    const draft = cleanWritingFullDraft(translationFixture, 'TRANSLATION', 5);
    expect(draft.title).toBe('Dịch câu: Ở nhà hàng');
    expect(draft.dropped).toBe(2);
    expect(draft.tasks).toEqual([
      {
        taskType: 'SENTENCE_TRANSLATION',
        prompt: 'Tôi muốn gọi một ly cà phê.',
        acceptedAnswers: [
          'I would like to order a coffee.',
          "I'd like to order a coffee.",
        ],
        hints: [{ vi: 'gọi món', en: 'order' }],
        grammarTip: 'Dùng "would like to" để lịch sự.',
      },
    ]);
  });

  it('keeps email families only, with a sane word range', () => {
    const draft = cleanWritingFullDraft(
      {
        title: 'Email công việc',
        tasks: [
          {
            taskType: 'request',
            prompt: 'Write to your manager asking for a day off.',
            wordRange: [80, 120],
          },
          { taskType: 'OPINION', prompt: 'Write an essay.' },
          { taskType: 'PICTURE_SENTENCE', prompt: 'Describe the photo.' },
          { taskType: 'EMAIL', prompt: '  ', wordRange: [10, 20] },
          {
            taskType: 'THANK_YOU',
            prompt: 'Thank a client.',
            wordRange: [120, 80],
          },
        ],
      },
      'EMAIL',
      10,
    );
    expect(draft.tasks).toEqual([
      {
        taskType: 'REQUEST',
        prompt: 'Write to your manager asking for a day off.',
        wordRange: [80, 120],
      },
      { taskType: 'THANK_YOU', prompt: 'Thank a client.' },
    ]);
    expect(draft.dropped).toBe(3);
  });

  it('reads no more tasks than were asked for, and survives a malformed answer', () => {
    const many = {
      tasks: Array.from({ length: 8 }, (_, i) => ({
        taskType: 'EMAIL',
        prompt: `Task ${i}`,
      })),
    };
    expect(cleanWritingFullDraft(many, 'EMAIL', 3).tasks).toHaveLength(3);
    expect(cleanWritingFullDraft(null, 'EMAIL', 3)).toMatchObject({
      tasks: [],
      dropped: 0,
    });
    expect(
      cleanWritingFullDraft({ tasks: 'nope' }, 'TRANSLATION', 3).tasks,
    ).toEqual([]);
  });
});
