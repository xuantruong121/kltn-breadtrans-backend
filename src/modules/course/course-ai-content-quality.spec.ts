import { reviewLessonContentCandidate } from './course-ai-content-quality';

describe('reviewLessonContentCandidate', () => {
  it('returns no warnings for a well-formed, objective-aligned candidate', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        {
          type: 'INTRO',
          heading: 'Goal',
          content:
            'Today you will describe daily routines using present simple.',
        },
        {
          type: 'THEORY',
          heading: 'Present simple',
          content:
            'Use the base verb form for habits and routines, and add -s for he, she, or it.',
          bullets: ['Subject + verb for I/you/we/they', 'Add -s for he/she/it'],
        },
        {
          type: 'EXAMPLE',
          heading: 'Everyday routines',
          content: 'Here are routines people describe every day.',
          examples: [
            { text: 'She works at a bank.' },
            { text: 'He wakes up at six.' },
          ],
        },
      ],
      guidedPractice: {
        questions: [{ prompt: 'She __ at a bank.' }],
      },
      finalCheck: {
        questions: [{ prompt: 'He __ up at six.' }],
      },
      objectives: ['Describe daily routines'],
    });
    expect(result.warnings).toEqual([]);
    expect(result.duplicateQuestionCount).toBe(0);
  });

  it('flags a missing heading', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        { type: 'THEORY', heading: '', content: 'Some explanation here.' },
      ],
    });
    expect(result.warnings).toContain('Mục 1 chưa có tiêu đề.');
  });

  it('flags a section with no main content', () => {
    const result = reviewLessonContentCandidate({
      sections: [{ type: 'THEORY', heading: 'Rule', content: '' }],
    });
    expect(result.warnings).toContain('Mục “Rule” chưa có nội dung chính.');
  });

  it('flags thin THEORY content with no bullets to compensate', () => {
    const result = reviewLessonContentCandidate({
      sections: [{ type: 'THEORY', heading: 'Rule', content: 'Use hello.' }],
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Nội dung phần Lý thuyết “Rule” còn khá ngắn. Hãy bổ sung giải thích hoặc ý chính.',
      ]),
    );
  });

  it('does not flag thin THEORY content when bullets provide the key points', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        {
          type: 'THEORY',
          heading: 'Rule',
          content: 'Use hello.',
          bullets: ['Use hello for greetings', 'Use goodbye to leave'],
        },
      ],
    });
    expect(result.warnings).toEqual([]);
  });

  it('flags an EXAMPLE section with no examples', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        { type: 'EXAMPLE', heading: 'Model', content: 'Some intro text here.' },
      ],
    });
    expect(result.warnings).toContain(
      'Mục ví dụ “Model” chưa có ví dụ minh họa.',
    );
  });

  it('flags duplicate examples within a section', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        {
          type: 'EXAMPLE',
          heading: 'Model',
          content: 'Some intro text here.',
          examples: [
            { text: 'She works every day.' },
            { text: 'She works every day.' },
          ],
        },
      ],
    });
    expect(result.warnings).toContain('Mục “Model” có ví dụ trùng lặp.');
  });

  it('flags duplicate section headings', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        { type: 'THEORY', heading: 'Rule', content: 'Explanation one here.' },
        { type: 'THEORY', heading: 'Rule', content: 'Explanation two here.' },
      ],
    });
    expect(result.warnings).toContain('Có hai mục nội dung trùng tiêu đề.');
  });

  it('counts and flags Final Check questions that duplicate Guided Practice', () => {
    const result = reviewLessonContentCandidate({
      guidedPractice: { questions: [{ prompt: 'She __ at a bank.' }] },
      finalCheck: {
        questions: [
          { prompt: 'She __ at a bank.' },
          { prompt: 'He __ at six.' },
        ],
      },
    });
    expect(result.duplicateQuestionCount).toBe(1);
    expect(result.warnings).toContain(
      'Kiểm tra cuối bài có 1 câu trùng với phần Luyện tập.',
    );
  });

  it('flags an objective with no matching keyword anywhere in the content', () => {
    const result = reviewLessonContentCandidate({
      sections: [
        {
          type: 'THEORY',
          heading: 'Greetings',
          content: 'Say hello and goodbye politely.',
        },
      ],
      objectives: ['Order food at a restaurant'],
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Chưa thấy nội dung cho mục tiêu'),
      ]),
    );
  });

  it('is tolerant of empty candidates', () => {
    expect(reviewLessonContentCandidate({})).toEqual({
      warnings: [],
      duplicateQuestionCount: 0,
    });
  });
});
