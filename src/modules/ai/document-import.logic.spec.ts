import {
  DOCUMENT_MAX_DECKS,
  DOCUMENT_MAX_WORDS_PER_DECK,
  deckHeadwords,
  isReadableDocument,
  limitDocumentText,
  normalizeDictationSentences,
  normalizeVocabDecks,
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
});
