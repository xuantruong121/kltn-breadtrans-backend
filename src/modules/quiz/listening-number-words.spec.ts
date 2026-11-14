import {
  calculateProgressiveDictationFeedback,
  normalizeListeningAnswer,
} from './quiz.service';
import { normalizeNumberTokens } from './listening-number-words';

// Owner 2026-11-13: "nine to eleven" typed as "9 to 11" must count. The same
// cases run against the frontend copy (dictationNumberWords.test.ts).
const SAME: Array<[string, string]> = [
  ['from nine to eleven', 'from 9 to 11'],
  ['it opens at eight forty-five', 'it opens at 8:45'],
  ['I will arrive at eight thirty', 'I will arrive at 8:30'],
  ['about a ten-minute walk', 'about a 10-minute walk'],
  ['get off after the second stop', 'get off after the 2nd stop'],
  ['the twenty first floor', 'the 21st floor'],
  ['twenty five people', '25 people'],
  ['one hundred and five', '105'],
  ['a hundred students', '100 students'],
  ['one thousand', '1,000'],
  ['two thousand three hundred', '2300'],
  ['platform three at eight fifteen', 'platform 3 at 8:15'],
  ['before two o’clock', 'before 2 o’clock'],
];

const DIFFERENT: Array<[string, string]> = [
  ['nine', '19'],
  ['eight thirty', '830'],
  ['nineteen ninety', '1990'],
];

describe('dictation numbers', () => {
  it.each(SAME)('"%s" and "%s" read the same', (said, typed) => {
    expect(normalizeListeningAnswer(typed)).toBe(
      normalizeListeningAnswer(said),
    );
  });

  it.each(DIFFERENT)('"%s" and "%s" stay different', (said, typed) => {
    expect(normalizeListeningAnswer(typed)).not.toBe(
      normalizeListeningAnswer(said),
    );
  });

  it('joins only runs that read as one number', () => {
    expect(
      normalizeNumberTokens(['eight', 'forty', 'five', 'and', 'one']),
    ).toEqual(['8', '45', 'and', '1']);
    expect(normalizeNumberTokens(['a', 'second'])).toEqual(['a', '2nd']);
    expect(normalizeNumberTokens(['zero', 'one'])).toEqual(['0', '1']);
  });

  it('a whole sentence with digits is correct', () => {
    const f = calculateProgressiveDictationFeedback(
      'I reserved the study room from nine to eleven.',
      'I reserved the study room from 9 to 11',
    );
    expect(f.isCorrect).toBe(true);
  });

  it('the verified prefix runs through a number written in digits', () => {
    const f = calculateProgressiveDictationFeedback(
      'We need twenty five copies for the group.',
      'We need 25 copies for a',
    );
    expect(f.isCorrect).toBe(false);
    expect(f.verifiedPrefix).toBe('We need twenty five copies for');
    expect(f.nextWord).toBe('the');
  });

  it('the word to fix comes without the punctuation around it', () => {
    const f = calculateProgressiveDictationFeedback(
      'Did you bring the reading passage?',
      'Did you bring the reading',
    );
    expect(f.nextWord).toBe('passage');
    expect(f.nextWordMask).toBe('*******?');
  });
});
