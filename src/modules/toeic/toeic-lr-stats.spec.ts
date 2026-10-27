import { buildLrStats, windowStart } from './toeic-lr-stats';

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));

describe('TOEIC L&R learner statistics', () => {
  // Exam 1: Part 1 (q1, q2), Part 5 (q3, q4).
  const questions = [
    { id: 1, examId: 1, part: 1, correctIndex: 0, type: 'Tranh tả người' },
    { id: 2, examId: 1, part: 1, correctIndex: 1, type: 'Tranh tả vật, cảnh' },
    { id: 3, examId: 1, part: 5, correctIndex: 2, type: 'Giới từ' },
    { id: 4, examId: 1, part: 5, correctIndex: 3, type: 'Giới từ' },
  ];
  const attempt = (id: number, submitted: Date, extra = {}) => ({
    id,
    examId: 1,
    examTitle: 'Đề 01',
    mode: 'PRACTICE' as const,
    inAssessment: false,
    startedAt: new Date(submitted.getTime() - 3600_000),
    submittedAt: submitted,
    listeningScore: 100,
    readingScore: 200,
    totalScore: 300,
    ...extra,
  });

  it('counts correct, wrong and unanswered per Part from the stored answers', () => {
    const stats = buildLrStats({
      days: null,
      attempts: [attempt(10, day(20))],
      questions,
      answers: [
        { attemptId: 10, questionId: 1, selectedIndex: 0 }, // right
        { attemptId: 10, questionId: 2, selectedIndex: 0 }, // wrong
        { attemptId: 10, questionId: 3, selectedIndex: 2 }, // right
        // q4 unanswered
      ],
    });
    expect(stats.skills.LISTENING).toMatchObject({
      attempts: 1,
      correct: 1,
      total: 2,
      accuracy: 50,
    });
    expect(stats.skills.LISTENING.parts).toEqual([
      {
        part: 1,
        correct: 1,
        wrong: 1,
        unanswered: 0,
        accuracy: 50,
        types: [
          {
            type: 'Tranh tả người',
            correct: 1,
            wrong: 0,
            unanswered: 0,
            accuracy: 100,
          },
          {
            type: 'Tranh tả vật, cảnh',
            correct: 0,
            wrong: 1,
            unanswered: 0,
            accuracy: 0,
          },
        ],
      },
    ]);
    expect(stats.skills.READING.parts).toEqual([
      {
        part: 5,
        correct: 1,
        wrong: 0,
        unanswered: 1,
        accuracy: 50,
        types: [
          {
            type: 'Giới từ',
            correct: 1,
            wrong: 0,
            unanswered: 1,
            accuracy: 50,
          },
        ],
      },
    ]);
    expect(stats.skills.LISTENING.averageSeconds).toBe(3600);
    expect(stats.overview).toEqual({
      attempts: 1,
      practiceSeconds: 3600,
      averageSeconds: 3600,
    });
    expect(stats.attempts[0]).toMatchObject({
      listeningCorrect: 1,
      listeningTotal: 2,
      readingCorrect: 1,
      readingTotal: 2,
      durationSeconds: 3600,
    });
  });

  it('windows back from the latest submission and orders newest first; trend oldest first', () => {
    const stats = buildLrStats({
      days: 7,
      attempts: [
        attempt(1, day(1), { listeningScore: 50 }),
        attempt(2, day(18), { listeningScore: 150 }),
        attempt(3, day(20), { listeningScore: 250 }),
      ],
      questions,
      answers: [],
    });
    expect(stats.attempts.map((a) => a.id)).toEqual([3, 2]);
    expect(stats.skills.LISTENING.trend.map((t) => t.attemptId)).toEqual([
      2, 3,
    ]);
    expect(stats.skills.LISTENING.averageScore).toBe(200);
    expect(stats.skills.LISTENING.bestScore).toBe(250);
    expect(stats.window.from).toBe(windowStart(day(20), 7)!.toISOString());
  });

  it('empty history gives empty, null-safe stats', () => {
    const stats = buildLrStats({
      days: 30,
      attempts: [],
      questions,
      answers: [],
    });
    expect(stats.overview).toEqual({
      attempts: 0,
      practiceSeconds: 0,
      averageSeconds: null,
    });
    expect(stats.skills.READING).toMatchObject({
      attempts: 0,
      accuracy: null,
      averageScore: null,
      bestScore: null,
    });
  });
});
