import {
  DICTATION_MAX_SENTENCES,
  DICTATION_MIN_SENTENCES,
  DOCUMENT_MAX_DECKS,
  DOCUMENT_MAX_WORDS_PER_DECK,
  deckHeadwords,
  dictationAvoidList,
  dictationDraftCount,
  dictationFullDraft,
  isEnglishSentence,
  isReadableDocument,
  limitDocumentText,
  normalizeDictationSentences,
  normalizeVocabDecks,
  withoutAvoided,
} from './document-import.logic';

describe('document import logic', () => {
  it('reads PDF, DOCX and TXT only', () => {
    expect(isReadableDocument('giao-trinh.PDF')).toBe(true);
    expect(isReadableDocument('bai.docx')).toBe(true);
    expect(isReadableDocument('ghi-chu.txt')).toBe(true);
    expect(isReadableDocument('cu.doc')).toBe(false);
    expect(isReadableDocument('anh.png')).toBe(false);
  });

  it('reports how much of a long document is used', () => {
    expect(limitDocumentText('  abcdef  ', 4)).toEqual({
      text: 'abcd',
      totalChars: 6,
      truncated: true,
    });
    expect(limitDocumentText('abc', 4).truncated).toBe(false);
  });

  it('treats a PDF with only page markers as empty', () => {
    expect(limitDocumentText('\n\n-- 1 of 1 --\n\n').text).toBe('');
  });

  describe('normalizeVocabDecks', () => {
    const word = (name: string, meaning = 'nghĩa') => ({ word: name, meaning });

    it('keeps a word in the first deck only', () => {
      const decks = normalizeVocabDecks([
        { title: 'A', words: [word('invoice')] },
        { title: 'B', words: [word(' Invoice '), word('budget')] },
      ]);
      expect(decks[0].words.map((row) => row.word)).toEqual(['invoice']);
      expect(decks[1].words.map((row) => row.word)).toEqual(['budget']);
    });

    it('drops words without a meaning and empty decks', () => {
      const decks = normalizeVocabDecks([
        { title: 'A', words: [word('x', ' ')] },
        { title: '', words: [word('y')] },
        { title: 'C', words: [word('z')] },
      ]);
      expect(decks.map((deck) => deck.title)).toEqual(['C']);
    });

    it('marks words the dictionary already has', () => {
      const [deck] = normalizeVocabDecks(
        [{ title: 'A', words: [word('Budget'), word('fresh')] }],
        new Set(['budget']),
      );
      expect(deck.words.map((row) => row.known)).toEqual([true, false]);
    });

    it('caps decks and words', () => {
      const many = Array.from({ length: 50 }, (_, i) => word(`w${i}`));
      const decks = normalizeVocabDecks(
        Array.from({ length: 9 }, (_, i) => ({
          title: `D${i}`,
          words: i === 0 ? many : [word(`only${i}`)],
        })),
      );
      expect(decks).toHaveLength(DOCUMENT_MAX_DECKS);
      expect(decks[0].words).toHaveLength(DOCUMENT_MAX_WORDS_PER_DECK);
    });
  });

  it('collects unique headwords for the dictionary lookup', () => {
    expect(
      deckHeadwords([
        { title: 'A', words: [{ word: 'Budget' }, { word: ' budget ' }] },
      ]),
    ).toEqual(['budget']);
  });

  it('keeps dictation lines that are real, unique sentences', () => {
    expect(
      normalizeDictationSentences([
        '1. The train leaves at nine.',
        'The train leaves at nine.',
        'Yes.',
        ' She works in the office. ',
      ]),
    ).toEqual(['The train leaves at nine.', 'She works in the office.']);
  });

  // QA 2026-11-22: a Vietnamese topic came back as Vietnamese sentences.
  it('drops dictation lines that are not English', () => {
    expect(
      normalizeDictationSentences([
        'Tôi muốn đặt lịch hẹn vào thứ Hai.',
        'Toi muon dat lich hen vao thu Hai đi.',
        'We met at the café near the station.',
        '我们明天在车站见面吧。',
        'I’d like to book a table for “two” at 7 p.m. — thanks.',
        'The ticket costs £12 and €15 at the door.',
        '   ',
        42,
      ]),
    ).toEqual([
      'I’d like to book a table for “two” at 7 p.m. — thanks.',
      'The ticket costs £12 and €15 at the door.',
    ]);
    expect(isEnglishSentence('Hẹn gặp lại bạn')).toBe(false);
    expect(isEnglishSentence('See you later, my friend.')).toBe(true);
    expect(normalizeDictationSentences(undefined)).toEqual([]);
  });

  it('keeps a dictation draft between 10 and 30 sentences', () => {
    expect(dictationDraftCount(5)).toBe(DICTATION_MIN_SENTENCES);
    expect(dictationDraftCount(25)).toBe(25);
    expect(dictationDraftCount(99)).toBe(DICTATION_MAX_SENTENCES);
    expect(dictationDraftCount(undefined)).toBe(10);
    expect(DICTATION_MIN_SENTENCES).toBe(10);
  });

  describe('dictationFullDraft', () => {
    const english = (n: number) =>
      Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} is here.`);

    it('makes one English sentence per item and no MCQs', () => {
      const draft = dictationFullDraft(
        {
          title: 'Đặt lịch hẹn',
          description: 'Nghe và chép lại.',
          sentences: [...english(21), 'Câu tiếng Việt không được giữ lại.'],
        },
        { topic: 'đặt lịch hẹn', level: 'A2', count: 20 },
      );
      expect(draft).toMatchObject({
        title: 'Đặt lịch hẹn',
        level: 'A2',
        mode: 'DICTATION',
        questions: [],
      });
      expect(draft.sentences).toHaveLength(20);
      expect(draft.sentences.every((line) => isEnglishSentence(line))).toBe(
        true,
      );
    });

    it('fails, so the controller answers 502, when no English sentence is left', () => {
      expect(() =>
        dictationFullDraft(
          { title: 'x', sentences: ['Xin chào các bạn nhé.'] },
          { topic: 'x' },
        ),
      ).toThrow('AI không trả về câu nghe chép tiếng Anh hợp lệ');
      expect(() =>
        dictationFullDraft({ sentences: 'not a list' }, { topic: 'x' }),
      ).toThrow();
    });

    it('falls back to the topic for a missing title', () => {
      expect(
        dictationFullDraft({ sentences: english(1) }, { topic: 'Weekend' })
          .title,
      ).toBe('Weekend');
    });
  });
});

describe('replacement dictation sentences (owner 2026-11-25)', () => {
  it('sends the sentences already in the lesson as one clean list', () => {
    expect(
      dictationAvoidList([
        '  We eat dinner at six.  ',
        'we eat dinner at six',
        '',
        7,
        'Call your brother.',
      ]),
    ).toEqual(['We eat dinner at six.', 'Call your brother.']);
    expect(dictationAvoidList(undefined)).toEqual([]);
    expect(
      dictationAvoidList(Array.from({ length: 50 }, (_, i) => `Line ${i}.`)),
    ).toHaveLength(40);
  });

  it('never offers a sentence the lesson already has, whatever its case or end mark', () => {
    expect(
      withoutAvoided(
        ['We eat dinner at six!', 'My aunt grows tomatoes in her garden.'],
        ['we eat dinner at six.'],
      ),
    ).toEqual(['My aunt grows tomatoes in her garden.']);
  });
});
