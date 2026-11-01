import {
  buildSkillProfiles,
  buildStrengthsAndWeaknesses,
  getQuestionMeta,
  resolvePlacementLevel,
  resolveEstimatedLevel,
  validateQuestionBank,
} from './diagnostic.logic';

const questions = [
  {
    id: 1,
    skill: 'Reading',
    question: 'A',
    options: ['a', 'b'],
    correctIndex: 0,
    explanation: null,
    order: 1,
  },
  {
    id: 2,
    skill: 'Reading',
    question: 'B',
    options: ['a', 'b'],
    correctIndex: 1,
    explanation: null,
    order: 2,
  },
  {
    id: 3,
    skill: 'Reading',
    question: 'C',
    options: ['a', 'b'],
    correctIndex: 0,
    explanation: null,
    order: 3,
  },
  {
    id: 4,
    skill: 'Grammar',
    question: 'D',
    options: ['a', 'b'],
    correctIndex: 0,
    explanation: null,
    order: 4,
  },
];

describe('diagnostic logic', () => {
  it('uses documented level boundaries', () => {
    expect(resolveEstimatedLevel(44)).toBe('Starter');
    expect(resolveEstimatedLevel(45)).toBe('Foundation');
    expect(resolveEstimatedLevel(74)).toBe('Foundation');
    expect(resolveEstimatedLevel(75)).toBe('Intermediate');
  });

  it('marks low-sample domains as insufficient instead of precise', () => {
    // Shown in authored order, so the display permutation is the identity.
    // An index answer is only gradable through a permutation.
    const identity = Object.fromEntries(
      questions.map((q) => [q.id, q.options.map((_, i) => i)]),
    );
    const profiles = buildSkillProfiles(
      questions,
      { '1': 0, '2': 1, '3': 0, '4': 0 },
      identity,
    );
    expect(
      profiles.find((profile) => profile.skill === 'Grammar')?.percentage,
    ).toBeNull();
    expect(buildStrengthsAndWeaknesses(profiles).weaknesses).toEqual([]);
  });

  it('reports malformed question banks', () => {
    expect(
      validateQuestionBank([{ ...questions[0], correctIndex: 9 }]),
    ).toContain('invalid correct index 1');
  });

  it('rejects an active Listening item without a playable audio URL', () => {
    expect(
      validateQuestionBank([
        {
          ...questions[0],
          skill: 'Listening',
          options: {
            values: ['one', 'two'],
            stableKey: 'listen-a1-01',
            section: 'LISTENING',
            construct: 'short-dialogue',
            intendedLevel: 'A1',
            questionType: 'MCQ',
            audioUrl: null,
          },
        },
      ]),
    ).toContain('missing listening audio 1');
  });

  it('reads v2 metadata without exposing answer-bearing fields', () => {
    const meta = getQuestionMeta({
      ...questions[0],
      options: {
        values: ['one', 'two'],
        stableKey: 'lu-a1-01',
        section: 'LANGUAGE_USE',
        construct: 'word-choice',
        intendedLevel: 'A1',
        questionType: 'MCQ',
      },
    });
    expect(meta).toMatchObject({
      section: 'LANGUAGE_USE',
      intendedLevel: 'A1',
    });
    expect(
      resolvePlacementLevel({ CORE: 72 }, { A1: 80, A2: 70, B1: 40, B2: 10 }),
    ).toBe('A2 – Sơ trung cấp');
  });
});
