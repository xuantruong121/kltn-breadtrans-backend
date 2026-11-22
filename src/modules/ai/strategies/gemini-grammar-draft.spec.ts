import { GeminiEvaluatorStrategy } from './gemini-evaluator.strategy';
import { GrammarDraftRejected } from '../../grammar/grammar-full-draft.logic';

/** The grammar full draft with the model mocked: no network, no key. */
function strategyAnswering(answer: unknown) {
  const strategy = new GeminiEvaluatorStrategy() as any;
  strategy.hasKeys = () => true;
  strategy.recordUsage = jest.fn();
  const generateContent = jest.fn().mockResolvedValue({
    response: { text: () => JSON.stringify(answer) },
  });
  strategy.executeWithRotation = (run: (model: unknown) => unknown) =>
    run({ generateContent });
  return { strategy, generateContent };
}

const theory = {
  summary: 'Câu điều kiện loại 2 diễn tả giả định không có thật ở hiện tại.',
  usage: ['Nói về điều trái với thực tế hiện tại.'],
  form: ['Khẳng định: If + S + V2/ed, S + would + V'],
  examples: [
    {
      en: 'If I had more time, I would learn Japanese.',
      vi: 'Nếu có nhiều thời gian hơn, tôi sẽ học tiếng Nhật.',
    },
  ],
  mistakes: ['Dùng "will" ở mệnh đề chính thay vì "would".'],
};

const question = (explanation: string) => ({
  question: 'If I ____ rich, I would travel.',
  options: ['am', 'were', 'will be', 'have been'],
  correctIndex: 1,
  explanation,
  optionExplanations: ['Sai thì.', '', 'Sai thì.', 'Sai thì.'],
});

const input = {
  topicTitle: 'Câu điều kiện loại 2',
  level: 'INTERMEDIATE',
  count: 2,
};

describe('Grammar full draft (QA 2026-11-22: Vietnamese without diacritics)', () => {
  it('asks for full diacritics and a theory in parts, and composes it', async () => {
    const { strategy, generateContent } = strategyAnswering({
      title: 'Câu điều kiện loại 2',
      level: 'INTERMEDIATE',
      keyFormula: 'If + S + V2/ed, S + would + V',
      theory,
      questions: [
        question('Giả định trái thực tế ở hiện tại nên dùng "were".'),
        question('Vi gia dinh trai thuc te o hien tai nen dung were'),
      ],
    });
    const draft = await strategy.suggestGrammarFullDraft(input);

    const request = generateContent.mock.calls[0][0];
    const prompt = request.contents[0].parts[0].text as string;
    expect(prompt).toMatch(/full diacritics/);
    expect(prompt).toMatch(/mistakes/);
    expect(
      request.generationConfig.responseSchema.properties.theory.required,
    ).toEqual(['summary', 'usage', 'form', 'examples', 'mistakes']);

    expect(draft.description.split('\n')[0]).toBe(theory.summary);
    expect(draft.description).toContain('Cách dùng\n- ');
    expect(draft.description).toContain('Lỗi thường gặp\n- ');
    // The unaccented question is dropped; the accented one stays.
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].explanation).toContain('Giả định');
  });

  it('refuses a theory written without diacritics', async () => {
    const { strategy } = strategyAnswering({
      title: 'Cau dieu kien loai 2',
      level: 'INTERMEDIATE',
      keyFormula: 'If + S + V2/ed, S + would + V',
      theory: {
        ...theory,
        summary: 'Hoc va luyen tap ve cau dieu kien loai 2',
        usage: ['Noi ve dieu trai voi thuc te hien tai'],
        mistakes: ['Dung will thay vi would'],
        examples: [{ en: 'If I were you, I would go.', vi: 'Neu toi la ban' }],
      },
      questions: [question('Giả định trái thực tế nên dùng "were".')],
    });
    await expect(strategy.suggestGrammarFullDraft(input)).rejects.toThrow(
      GrammarDraftRejected,
    );
  });

  it('refuses a one-line theory without its sections', async () => {
    const { strategy } = strategyAnswering({
      title: 'Câu điều kiện loại 2',
      level: 'INTERMEDIATE',
      keyFormula: 'If + S + V2/ed, S + would + V',
      theory: { summary: theory.summary, usage: [], form: [], examples: [] },
      questions: [question('Giả định trái thực tế nên dùng "were".')],
    });
    await expect(strategy.suggestGrammarFullDraft(input)).rejects.toThrow(
      /lý thuyết/,
    );
  });

  it('says why when every question came back without diacritics', async () => {
    const { strategy } = strategyAnswering({
      title: 'Câu điều kiện loại 2',
      level: 'INTERMEDIATE',
      keyFormula: 'If + S + V2/ed, S + would + V',
      theory,
      questions: [question('Vi gia dinh trai thuc te nen dung were')],
    });
    await expect(strategy.suggestGrammarFullDraft(input)).rejects.toThrow(
      /không dấu/,
    );
  });
});
