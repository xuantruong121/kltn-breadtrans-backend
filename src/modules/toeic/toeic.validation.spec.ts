import { validateToeicExam } from './toeic.validation';

function makeExam() {
  const groups = [] as any[];
  let number = 1;
  for (const [part, count] of [
    [1, 6],
    [2, 25],
    [3, 39],
    [4, 30],
    [5, 30],
    [6, 16],
    [7, 54],
  ] as const) {
    const groupCount =
      part === 3
        ? 13
        : part === 4
          ? 10
          : part === 6
            ? 4
            : part === 7
              ? 15
              : count;
    let remaining = count;
    for (let index = 0; index < groupCount; index++) {
      const size =
        part === 3 || part === 4
          ? 3
          : part === 7 && index >= 10
            ? 5
            : part === 7
              ? index === 0
                ? 2
                : 3
              : part === 6
                ? 4
                : 1;
      const questions = Array.from(
        { length: Math.min(size, remaining) },
        () => ({
          id: number,
          questionNumber: number++,
          options: part === 2 ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        }),
      );
      remaining -= questions.length;
      groups.push({
        id: groups.length + 1,
        part,
        groupOrder: groups.length + 1,
        imageUrl: part === 1 ? 'image' : null,
        audioUrl: part <= 4 ? 'audio' : null,
        passageText: part >= 6 ? 'passage' : null,
        questions,
      });
    }
  }
  return { id: 1, type: 'FULL_TEST', durationSeconds: 7200, groups };
}

test('validates the standard 200-question structure and grouping', () => {
  const result = validateToeicExam(makeExam());
  expect(result.learnerReady).toBe(true);
  expect(result.counts).toMatchObject({
    total: 200,
    listening: 100,
    reading: 100,
  });
});

test('rejects missing durable listening media without weakening count checks', () => {
  const exam = makeExam();
  exam.groups.find((group) => group.part === 3).audioUrl = null;
  const result = validateToeicExam(exam);
  expect(result.learnerReady).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'MISSING_AUDIO')).toBe(
    true,
  );
});

test('allows three-option Part 2 responses and rejects wrong option cardinality', () => {
  const exam = makeExam();
  exam.groups.find((group) => group.part === 2).questions[0].options = [
    'a',
    'b',
  ];
  const result = validateToeicExam(exam);
  expect(result.issues.some((issue) => issue.code === 'OPTIONS')).toBe(true);
});
