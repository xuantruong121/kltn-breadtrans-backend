import {
  VOCAB_XP_DAILY_CAP,
  VOCAB_XP_PER_WORD,
  vocabWordXp,
  vocabWordXpReason,
} from './vocab-xp.logic';

describe('flashcard XP (owner 2026-11-18)', () => {
  it('pays 2 XP for a word, 150 a day at most', () => {
    expect(VOCAB_XP_PER_WORD).toBe(2);
    expect(VOCAB_XP_DAILY_CAP).toBe(150);
    expect(vocabWordXp(0)).toBe(2);
    expect(vocabWordXp(148)).toBe(2);
    expect(vocabWordXp(149)).toBe(1);
    expect(vocabWordXp(150)).toBe(0);
    expect(vocabWordXp(400)).toBe(0);
  });

  it('names the award after the word, so each word pays once', () => {
    expect(vocabWordXpReason(12)).toBe('Thuộc từ vựng #12');
  });
});
