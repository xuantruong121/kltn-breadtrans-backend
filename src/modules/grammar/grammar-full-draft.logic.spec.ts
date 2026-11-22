import {
  composeGrammarTheory,
  hasVietnameseDiacritics,
  lacksVietnameseDiacritics,
  questionLacksDiacritics,
  theoryVietnamese,
} from './grammar-full-draft.logic';

const theory = {
  summary: 'Câu điều kiện loại 2 diễn tả giả định không có thật ở hiện tại.',
  usage: ['Nói về điều trái với thực tế hiện tại.', 'Đưa ra lời khuyên.'],
  form: ['Khẳng định: If + S + V2/ed, S + would + V'],
  examples: [
    {
      en: 'If I had more time, I would learn Japanese.',
      vi: 'Nếu có nhiều thời gian hơn, tôi sẽ học tiếng Nhật.',
    },
  ],
  mistakes: ['Dùng "will" ở mệnh đề chính thay vì "would".'],
};

describe('Vietnamese diacritics check (QA 2026-11-22)', () => {
  it('sees marks in composed and decomposed text', () => {
    expect(hasVietnameseDiacritics('Câu điều kiện')).toBe(true);
    expect(hasVietnameseDiacritics('Câu điều kiện'.normalize('NFD'))).toBe(
      true,
    );
    expect(hasVietnameseDiacritics('Hoc va luyen tap')).toBe(false);
  });

  it('refuses unmarked Vietnamese and English, but not short notes', () => {
    expect(
      lacksVietnameseDiacritics(
        'Hoc va luyen tap ve cau dieu kien loai 2 trong giao tiep',
      ),
    ).toBe(true);
    expect(
      lacksVietnameseDiacritics('Use the past simple with yesterday'),
    ).toBe(true);
    expect(lacksVietnameseDiacritics('Dùng quá khứ đơn với "yesterday".')).toBe(
      false,
    );
    expect(lacksVietnameseDiacritics('V-ing form')).toBe(false);
    expect(lacksVietnameseDiacritics(null)).toBe(false);
  });

  it('flags a question whose explanation or notes have no marks', () => {
    expect(
      questionLacksDiacritics({
        explanation: 'Vi day la cau dieu kien loai 2 nen dung would',
      }),
    ).toBe(true);
    expect(
      questionLacksDiacritics({
        explanation: 'Vì đây là câu điều kiện loại 2 nên dùng "would".',
        optionExplanations: [
          '',
          'Sai vi dung thi hien tai don',
          'Sai thì.',
          'Sai.',
        ],
      }),
    ).toBe(true);
    expect(
      questionLacksDiacritics({
        explanation: 'Vì đây là câu điều kiện loại 2 nên dùng "would".',
        optionExplanations: ['', 'Sai thì.', 'Thiếu trợ động từ.', ''],
      }),
    ).toBe(false);
  });
});

describe('composeGrammarTheory', () => {
  it('gives the editor plain text: summary, then the four sections', () => {
    const text = composeGrammarTheory(theory);
    expect(text).toBe(
      [
        'Câu điều kiện loại 2 diễn tả giả định không có thật ở hiện tại.',
        'Cách dùng\n- Nói về điều trái với thực tế hiện tại.\n- Đưa ra lời khuyên.',
        'Cấu trúc\n- Khẳng định: If + S + V2/ed, S + would + V',
        'Ví dụ\n- If I had more time, I would learn Japanese. (Nếu có nhiều thời gian hơn, tôi sẽ học tiếng Nhật.)',
        'Lỗi thường gặp\n- Dùng "will" ở mệnh đề chính thay vì "would".',
      ].join('\n\n'),
    );
    expect(text).not.toMatch(/[#*]/);
  });

  it('refuses a theory with a missing section', () => {
    expect(composeGrammarTheory({ ...theory, mistakes: [] })).toBeNull();
    expect(composeGrammarTheory({ ...theory, summary: ' ' })).toBeNull();
    expect(composeGrammarTheory({})).toBeNull();
  });

  it('reads only the Vietnamese parts for the diacritics check', () => {
    const vietnamese = theoryVietnamese(theory);
    expect(vietnamese).toContain('giả định');
    expect(vietnamese).not.toContain('Japanese');
  });
});
