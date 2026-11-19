import { quizBanhReward, rewardPercent } from './quiz-reward.logic';

describe('Bánh mì for a first practice submission (owner 2026-11-18)', () => {
  it.each([
    [100, 40],
    [92, 37],
    [30, 12],
    [13, 10],
    [0, 10],
  ])('%d %% pays %d Bánh mì, 10 to 40', (percent, banh) => {
    expect(quizBanhReward(percent)).toBe(banh);
  });

  it('reads the percent of the answer, not the number of right answers', () => {
    // Listening 5/5: score counts right answers, scorePercent is the percent.
    expect(rewardPercent({ score: 5, scorePercent: 100 })).toBe(100);
    expect(quizBanhReward(rewardPercent({ score: 5, scorePercent: 100 }))).toBe(
      40,
    );
  });

  it('falls back to score when no percent came with the event', () => {
    expect(rewardPercent({ score: 70 })).toBe(70);
    expect(rewardPercent({ score: 70, scorePercent: null })).toBe(70);
    expect(rewardPercent({ score: 70, scorePercent: Number.NaN })).toBe(70);
  });
});
