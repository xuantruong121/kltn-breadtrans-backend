import {
  matchTranslation,
  normalizeEnglishSentence,
  translationTaskIssues,
} from '../../src/modules/writing/sentence-translation.logic';
import { parseCefrRange } from '../../src/modules/subscription/practice-level';
import {
  SENTENCE_TRANSLATION_EXERCISES,
  translationTaskContent,
} from './sentence-translation-practice';

const all = SENTENCE_TRANSLATION_EXERCISES.flatMap((exercise) =>
  exercise.sentences.map((sentence) => ({ exercise, sentence })),
);

describe('sentence translation content', () => {
  it('has 4 A1 and 4 A2 exercises of 6 sentences each, tagged in the title', () => {
    expect(SENTENCE_TRANSLATION_EXERCISES).toHaveLength(8);
    for (const level of ['A1', 'A2'] as const)
      expect(
        SENTENCE_TRANSLATION_EXERCISES.filter((e) => e.level === level),
      ).toHaveLength(4);
    for (const e of SENTENCE_TRANSLATION_EXERCISES) {
      expect(e.sentences).toHaveLength(6);
      expect(parseCefrRange(e.title)).toEqual({ min: e.level, max: e.level });
    }
    expect(
      new Set(SENTENCE_TRANSLATION_EXERCISES.map((e) => e.title)).size,
    ).toBe(8);
  });

  it.each(
    all.map(({ exercise, sentence }) => [
      exercise.title,
      sentence.vi,
      exercise,
      sentence,
    ]),
  )(
    '%s: "%s" passes the authoring checks',
    (_title, _vi, exercise, sentence) => {
      expect(
        translationTaskIssues(translationTaskContent(exercise, sentence)),
      ).toEqual([]);
      expect(sentence.tip.length).toBeGreaterThan(20);
      // A1 sentences stay short.
      if (exercise.level === 'A1')
        for (const a of sentence.accepted)
          expect(normalizeEnglishSentence(a).length).toBeLessThanOrEqual(10);
    },
  );

  it('no accepted answer of one sentence is accepted for another', () => {
    for (const a of all)
      for (const b of all) {
        if (a === b) continue;
        for (const answer of a.sentence.accepted)
          expect(matchTranslation(answer, b.sentence.accepted).kind).toBe(
            'NONE',
          );
      }
  });

  it('each sentence lists distinct accepted answers', () => {
    for (const { sentence } of all) {
      const keys = sentence.accepted.map((a) =>
        normalizeEnglishSentence(a).join(' '),
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
