import {
  isPictureTask,
  pictureActivityTitle,
  pictureRewardRef,
  pictureTaskBanh,
  pictureTaskXp,
  writingItemsDone,
} from './picture-task-reward.logic';
import { quizBanhReward } from '../gamification/quiz-reward.logic';
import { writingCompletionXp } from './writing-exercise-progress';

describe('picture task reward (owner 2026-11-24)', () => {
  it('pays a fifth of a set: at most 20 XP and 2 to 8 Bánh Mì', () => {
    expect(pictureTaskXp(100)).toBe(20);
    expect(pictureTaskXp(60)).toBe(12);
    expect(pictureTaskXp(0)).toBe(0);
    expect(pictureTaskBanh(100)).toBe(8);
    expect(pictureTaskBanh(0)).toBe(2);
    expect(pictureTaskBanh(Number.NaN)).toBe(2);
  });

  it('five pictures at the same score pay about what the set paid', () => {
    for (const percent of [0, 35, 60, 80, 100]) {
      expect(
        Math.abs(5 * pictureTaskXp(percent) - writingCompletionXp(percent)),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(5 * pictureTaskBanh(percent) - quizBanhReward(percent)),
      ).toBeLessThanOrEqual(2);
    }
  });

  it('tells a picture task from the others', () => {
    expect(isPictureTask({ taskType: 'PICTURE_SENTENCE' })).toBe(true);
    expect(isPictureTask({ taskType: 'SENTENCE_TRANSLATION' })).toBe(false);
    expect(isPictureTask({ taskType: 'EMAIL' })).toBe(false);
    expect(isPictureTask(null)).toBe(false);
  });

  it('names one reward per learner and picture, and titles it by its cue words', () => {
    expect(pictureRewardRef(124, 470)).toBe('quiz:124:q:470');
    expect(pictureActivityTitle(['ride', 'street'])).toBe(
      'Viết câu theo tranh: ride, street',
    );
    expect(pictureActivityTitle(undefined)).toBe('Viết câu theo tranh');
  });
});

describe('writingItemsDone', () => {
  const picture = { taskType: 'PICTURE_SENTENCE' };
  const email = { taskType: 'EMAIL' };
  it('counts each graded picture, and every other exercise once', () => {
    expect(
      writingItemsDone([
        {
          quizId: 124,
          firstTaskContent: picture,
          results: [{ questionId: 470, score: 8 }],
        },
        {
          quizId: 124,
          firstTaskContent: picture,
          results: [{ questionId: 470, score: 9 }],
        },
        {
          quizId: 124,
          firstTaskContent: picture,
          results: [{ questionId: 469, score: 6 }],
        },
        {
          quizId: 124,
          firstTaskContent: picture,
          results: [{ questionId: 468, score: null }],
        },
        {
          quizId: 76,
          firstTaskContent: email,
          results: [{ questionId: 300, score: 7 }],
        },
        {
          quizId: 76,
          firstTaskContent: email,
          results: [{ questionId: 301, score: 6 }],
        },
      ]),
    ).toBe(3);
  });
});
