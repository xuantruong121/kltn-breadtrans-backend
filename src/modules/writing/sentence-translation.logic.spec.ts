import {
  closestAnswer,
  diffWords,
  matchTranslation,
  normalizeEnglishSentence,
  translationTaskIssues,
  translationTaskOf,
} from './sentence-translation.logic';

describe('normalizeEnglishSentence', () => {
  it('ignores case, punctuation and curly quotes, and writes contractions out', () => {
    expect(normalizeEnglishSentence('She Doesn’t drink coffee!')).toEqual([
      'she',
      'does',
      'not',
      'drink',
      'coffee',
    ]);
    expect(normalizeEnglishSentence("I'm tired.")).toEqual([
      'i',
      'am',
      'tired',
    ]);
    expect(normalizeEnglishSentence('We cannot go')).toEqual([
      'we',
      'can',
      'not',
      'go',
    ]);
  });

  it('reads "he\'s" as "he has" only before a past participle', () => {
    expect(normalizeEnglishSentence("He's tired")).toEqual([
      'he',
      'is',
      'tired',
    ]);
    expect(normalizeEnglishSentence("He's gone")).toEqual([
      'he',
      'has',
      'gone',
    ]);
  });

  it('matches "she\'s worked" with "she has worked" and "he\'s tired" with "he is tired"', () => {
    expect(
      matchTranslation("She's worked here for three years", [
        'She has worked here for three years.',
      ]).kind,
    ).toBe('EXACT');
    expect(matchTranslation("He's tired", ['He is tired.']).kind).toBe('EXACT');
  });

  it('keeps "its" as a possessive and counts numbers as digits', () => {
    expect(normalizeEnglishSentence('its colour')).toEqual(['its', 'colour']);
    expect(normalizeEnglishSentence('ten years old')).toEqual(
      normalizeEnglishSentence('10 years old'),
    );
  });
});

describe('matchTranslation', () => {
  const accepted = ['My mother is a teacher.', 'My mom is a teacher.'];

  it('matches an accepted answer whatever the case and punctuation', () => {
    expect(matchTranslation('my MOM is a teacher', accepted)).toEqual({
      kind: 'EXACT',
      matched: 'My mom is a teacher.',
    });
  });

  it('treats one slipped letter in a longer word as a typo', () => {
    expect(matchTranslation('My mother is a teachr.', accepted)).toEqual({
      kind: 'TYPO',
      matched: 'My mother is a teacher.',
      typed: 'teachr',
      expected: 'teacher',
    });
    // an adjacent swap is one edit too
    expect(matchTranslation('My mother is a taecher', accepted).kind).toBe(
      'TYPO',
    );
  });

  it('never forgives a grammar change as a typo', () => {
    expect(matchTranslation('My mother is an teacher', accepted).kind).toBe(
      'NONE',
    );
    expect(matchTranslation('My mother are a teacher', accepted).kind).toBe(
      'NONE',
    );
    expect(matchTranslation('My mother is teacher', accepted).kind).toBe(
      'NONE',
    );
    expect(
      matchTranslation('There are three apple on the table', [
        'There are three apples on the table.',
      ]).kind,
    ).toBe('NONE');
    expect(
      matchTranslation('My father work at a hospital', [
        'My father works at a hospital.',
      ]).kind,
    ).toBe('NONE');
  });

  it('allows only one typo', () => {
    expect(matchTranslation('My mothr is a teachr', accepted).kind).toBe(
      'NONE',
    );
  });

  it('accepts a contraction for the full form and the reverse', () => {
    expect(
      matchTranslation('She does not drink coffee', [
        "She doesn't drink coffee.",
      ]).kind,
    ).toBe('EXACT');
    expect(
      matchTranslation("I'll pay by card", ['I will pay by card.']).kind,
    ).toBe('EXACT');
  });

  it('does not match an empty answer', () => {
    expect(matchTranslation('  ?! ', accepted).kind).toBe('NONE');
  });
});

describe('closestAnswer and diffWords', () => {
  it('picks the accepted answer sharing the most words', () => {
    expect(
      closestAnswer('My dad work in a hospital', [
        'My father works at a hospital.',
        'My dad works in a hospital.',
      ]),
    ).toBe('My dad works in a hospital.');
  });

  it('marks the words that differ on both sides', () => {
    const d = diffWords(
      'My dad work in hospital',
      'My dad works in a hospital.',
    );
    expect(d.answer.filter((w) => !w.ok).map((w) => w.text)).toEqual(['work']);
    expect(d.reference.filter((w) => !w.ok).map((w) => w.text)).toEqual([
      'works',
      'a',
    ]);
  });
});

describe('translationTaskOf and translationTaskIssues', () => {
  const good = {
    taskType: 'SENTENCE_TRANSLATION',
    prompt: 'Mẹ tôi là giáo viên.',
    acceptedAnswers: ['My mother is a teacher.', 'My mom is a teacher.'],
    hints: [{ vi: 'giáo viên', en: 'teacher' }],
    grammarTip: 'Nghề nghiệp cần "a".',
  };

  it('reads a translation task and nothing else', () => {
    expect(translationTaskOf(good)?.acceptedAnswers).toHaveLength(2);
    expect(translationTaskOf({ ...good, taskType: 'SENTENCE' })).toBeNull();
    expect(translationTaskOf({ ...good, acceptedAnswers: [] })).toBeNull();
  });

  it('passes a complete task and names what is missing', () => {
    expect(translationTaskIssues(good)).toEqual([]);
    expect(
      translationTaskIssues({
        ...good,
        prompt: 'Me toi la giao vien',
        acceptedAnswers: ['My mother is a teacher.'],
        hints: [],
        grammarTip: '',
      }),
    ).toEqual([
      'prompt is not Vietnamese with diacritics',
      'fewer than 2 accepted answers',
      'no hints',
      'no grammar tip',
    ]);
  });
});
