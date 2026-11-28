import { feedbackSummary } from './feedback-summary';

describe('feedbackSummary', () => {
  const grading = {
    rubricVersion: 'PRACTICE_WRITING_V1',
    score: 7,
    maxScore: 10,
    criteria: [
      {
        key: 'grammar',
        label: 'Ngữ pháp',
        score: 1,
        max: 4,
        comment: 'Lỗi ngữ pháp.',
      },
    ],
    feedback: 'Bài viết của bạn đã hoàn thành tốt yêu cầu miêu tả bức tranh.',
  };

  it('shows the grader sentence of a JSON result, not the JSON', () => {
    expect(feedbackSummary(JSON.stringify(grading))).toBe(
      'Bài viết của bạn đã hoàn thành tốt yêu cầu miêu tả bức tranh.',
    );
  });

  it('reads an object result too', () => {
    expect(feedbackSummary(grading)).toBe(grading.feedback);
  });

  it('keeps a plain text feedback, cut to one short line', () => {
    expect(feedbackSummary('  Tốt\n  lắm  ')).toBe('Tốt lắm');
    const long = feedbackSummary('a '.repeat(200));
    expect(long!.length).toBe(180);
    expect(long!.endsWith('...')).toBe(true);
  });

  it('shows nothing for a result with no sentence or for broken JSON', () => {
    expect(feedbackSummary('{"score":7,"criteria":[]}')).toBeNull();
    expect(
      feedbackSummary('{"rubricVersion":"PRACTICE_WRITING_V1","sco'),
    ).toBeNull();
    expect(feedbackSummary('[1,2]')).toBeNull();
    expect(feedbackSummary('')).toBeNull();
    expect(feedbackSummary(null)).toBeNull();
    expect(feedbackSummary(undefined)).toBeNull();
  });
});
