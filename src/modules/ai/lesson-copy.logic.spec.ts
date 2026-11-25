import {
  briefRule,
  draftBrief,
  draftRule,
  levelLanguage,
  listeningDraftRule,
  situationRule,
} from './lesson-copy.logic';

describe('levelLanguage: CEFR codes, Speaking ranges and the three broad levels', () => {
  it('describes a CEFR code, a range from its lower to its higher level, and a broad level', () => {
    expect(levelLanguage('B1')).toMatch(
      /^CEFR level B1: everyday and some work/,
    );
    expect(levelLanguage('A2-B1')).toMatch(
      /^CEFR level A2 to B1: from common everyday words.*, up to everyday and some work/,
    );
    expect(levelLanguage('INTERMEDIATE')).toMatch(/^intermediate level: /);
  });

  it('gives nothing for no level or an unknown one', () => {
    expect(levelLanguage(undefined)).toBeUndefined();
    expect(levelLanguage('Z9')).toBeUndefined();
    expect(levelLanguage('A1-Z9')).toBeUndefined();
  });
});

describe('draftRule (owner 2026-11-25: every area follows the title and the level, like Listening)', () => {
  it('ties each area to its title, with a level line naming the chosen level', () => {
    expect(draftRule('READING', 'B2')).toMatch(
      /the passage and every question are about the topic.*\(the lesson title\)/,
    );
    expect(draftRule('READING', 'B2')).toContain('CEFR level B2');
    expect(draftRule('WRITING', 'A2')).toMatch(/every task is about the topic/);
    expect(draftRule('SPEAKING', 'B1-B2')).toContain('CEFR level B1 to B2');
    expect(draftRule('GRAMMAR', 'BEGINNER')).toMatch(
      /practise exactly that structure, never another one/,
    );
    expect(draftRule('GRAMMAR', 'BEGINNER')).toContain('beginner level');
  });

  it('asks a vocabulary draft for Vietnamese meanings and US phonetics', () => {
    const rule = draftRule('VOCAB', 'ADVANCED');
    expect(rule).toMatch(/"meaning" is its Vietnamese meaning/);
    expect(rule).toMatch(/"ipaUs" is the American IPA/);
  });

  it('adds no level line for an unknown level', () => {
    expect(draftRule('READING', undefined)).not.toMatch(/Level:/);
  });

  it('briefRule speaks of a deck situation or a grammar focus, and is empty without a brief', () => {
    expect(briefRule('VOCAB', 'Họp nhóm')).toMatch(/description of this deck/);
    expect(briefRule('GRAMMAR', 'S + V3')).toMatch(/^Focus: /);
    expect(briefRule('VOCAB', undefined)).toBe('');
  });
});

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

describe('draftBrief and situationRule (owner 2026-11-25: the typed description goes to the AI)', () => {
  it('sends the description as one trimmed line of at most 300 characters', () => {
    expect(draftBrief('  Nghe hội thoại\n ở quầy lễ tân.  ')).toBe(
      'Nghe hội thoại ở quầy lễ tân.',
    );
    expect(draftBrief('x'.repeat(400))).toHaveLength(300);
  });

  it('sends nothing for an empty box, and the prompt then has no situation rule', () => {
    expect(draftBrief('   ')).toBeUndefined();
    expect(draftBrief(undefined)).toBeUndefined();
    expect(situationRule(undefined)).toBe('');
    expect(situationRule('Lễ tân khách sạn')).toMatch(
      /plays out exactly that situation within the topic/,
    );
  });
});
