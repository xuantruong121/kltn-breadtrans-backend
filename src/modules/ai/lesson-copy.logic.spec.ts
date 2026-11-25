import { listeningDraftRule } from './lesson-copy.logic';

describe('listeningDraftRule (owner 2026-11-25: the full draft follows the title and the level)', () => {
  it('ties the lesson to the title as its topic, and Vietnamese topics are not translated word for word', () => {
    const rule = listeningDraftRule('B2', 'DIALOGUE');
    expect(rule).toMatch(
      /about the topic in the reference data \(the lesson title\)/,
    );
    expect(rule).toMatch(/never a translation of its words/);
  });

  it('names the chosen level and what it asks of the language and the questions', () => {
    const b2 = listeningDraftRule('B2', 'COMPREHENSION');
    expect(b2).toContain('CEFR level B2');
    expect(b2).toMatch(/phrasal verbs/);
    expect(b2).toMatch(/questions and every option use the same level/);
    expect(listeningDraftRule('A1', 'COMPREHENSION')).toMatch(
      /CEFR level A1: very common words/,
    );
  });

  it('gives a dialogue a length that grows with the level, and no length to other forms', () => {
    expect(listeningDraftRule('A1', 'DIALOGUE')).toMatch(
      /Dialogue: 6 to 8 turns/,
    );
    expect(listeningDraftRule('B2', 'DIALOGUE')).toMatch(
      /Dialogue: 10 to 14 turns/,
    );
    expect(listeningDraftRule('B2', 'COMPREHENSION')).not.toMatch(/Dialogue:/);
  });

  it('falls back to A2 when no level or an unknown one is given', () => {
    expect(listeningDraftRule(undefined, 'DIALOGUE')).toContain(
      'CEFR level A2',
    );
    expect(listeningDraftRule('Z9', 'DIALOGUE')).toContain('CEFR level A2');
  });
});
