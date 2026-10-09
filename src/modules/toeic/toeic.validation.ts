export type ToeicValidationQuestion = {
  id: number;
  questionNumber: number;
  options: unknown;
  correctIndex: number;
};

export type ToeicValidationGroup = {
  id: number;
  part: number;
  groupOrder: number;
  imageUrl?: string | null;
  audioUrl?: string | null;
  passageText?: string | null;
  questions: ToeicValidationQuestion[];
};

export type ToeicValidationExam = {
  id: number;
  type: string;
  durationSeconds: number;
  groups: ToeicValidationGroup[];
};

export type ToeicValidationIssue = {
  code: string;
  message: string;
  groupId?: number;
  questionId?: number;
};

const EXPECTED_PART_COUNTS: Record<number, number> = {
  1: 6,
  2: 25,
  3: 39,
  4: 30,
  5: 30,
  6: 16,
  7: 54,
};

export function validateToeicExam(exam: ToeicValidationExam): {
  learnerReady: boolean;
  issues: ToeicValidationIssue[];
  counts: Record<string, number>;
} {
  const issues: ToeicValidationIssue[] = [];
  const groups = [...(exam.groups ?? [])].sort(
    (a, b) => a.groupOrder - b.groupOrder,
  );
  const questions = groups.flatMap((group) => group.questions ?? []);
  const partCounts: Record<number, number> = {};
  for (const group of groups)
    partCounts[group.part] =
      (partCounts[group.part] ?? 0) + group.questions.length;

  if (exam.type === 'FULL_TEST') {
    const expectedTotal = Object.values(EXPECTED_PART_COUNTS).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (questions.length !== expectedTotal)
      issues.push({
        code: 'TOTAL_COUNT',
        message: `Expected ${expectedTotal} questions, found ${questions.length}`,
      });
    for (const [part, expected] of Object.entries(EXPECTED_PART_COUNTS)) {
      const actual = partCounts[Number(part)] ?? 0;
      if (actual !== expected)
        issues.push({
          code: 'PART_COUNT',
          message: `Part ${part} expected ${expected}, found ${actual}`,
        });
    }
    const numbers = questions.map((question) => question.questionNumber);
    const uniqueNumbers = new Set(numbers);
    if (
      uniqueNumbers.size !== numbers.length ||
      numbers.some(
        (number) => !Number.isInteger(number) || number < 1 || number > 200,
      )
    ) {
      issues.push({
        code: 'QUESTION_ORDER',
        message: 'Full Test question numbers must be unique and cover 1–200',
      });
    } else if (
      [...uniqueNumbers]
        .sort((a, b) => a - b)
        .some((number, index) => number !== index + 1)
    ) {
      issues.push({
        code: 'QUESTION_ORDER',
        message:
          'Full Test question numbers must cover 1–200 in canonical order',
      });
    }
    const groupsFor = (part: number) =>
      groups.filter((group) => group.part === part);
    for (const [part, expectedGroups] of [
      [3, 13],
      [4, 10],
    ] as const) {
      const partGroups = groupsFor(part);
      if (
        partGroups.length !== expectedGroups ||
        partGroups.some((group) => group.questions.length !== 3)
      ) {
        issues.push({
          code: 'GROUP_STRUCTURE',
          message: `Part ${part} must contain ${expectedGroups} groups of three questions`,
        });
      }
    }
    const part7 = groupsFor(7);
    const single = part7.filter(
      (group) => group.questions.length >= 2 && group.questions.length <= 4,
    );
    const multiple = part7.filter((group) => group.questions.length === 5);
    if (
      single.length !== 10 ||
      single.reduce((sum, group) => sum + group.questions.length, 0) !== 29 ||
      multiple.length !== 5
    ) {
      issues.push({
        code: 'PART7_STRUCTURE',
        message:
          'Part 7 must contain 10 single-passage groups (29 questions) and 5 multiple-passage sets (25 questions)',
      });
    }
  }

  for (const group of groups) {
    if (group.part < 1 || group.part > 7)
      issues.push({
        code: 'PART',
        message: `Invalid Part ${group.part}`,
        groupId: group.id,
      });
    if (group.part === 1 && !group.imageUrl)
      issues.push({
        code: 'MISSING_IMAGE',
        message: 'Part 1 group has no image stimulus',
        groupId: group.id,
      });
    if (group.part >= 1 && group.part <= 4 && !group.audioUrl)
      issues.push({
        code: 'MISSING_AUDIO',
        message: 'Listening group has no durable audio asset',
        groupId: group.id,
      });
    if ((group.part === 6 || group.part === 7) && !group.passageText?.trim())
      issues.push({
        code: 'MISSING_PASSAGE',
        message: 'Reading group has no passage',
        groupId: group.id,
      });
    for (const question of group.questions) {
      const options = Array.isArray(question.options) ? question.options : [];
      const expectedOptions = group.part === 2 ? 3 : 4;
      if (
        options.length !== expectedOptions ||
        options.some((option) => typeof option !== 'string' || !option.trim())
      )
        issues.push({
          code: 'OPTIONS',
          message: `Expected ${expectedOptions} non-empty options`,
          groupId: group.id,
          questionId: question.id,
        });
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= options.length
      )
        issues.push({
          code: 'ANSWER_KEY',
          message: 'Question has no valid answer key',
          groupId: group.id,
          questionId: question.id,
        });
    }
  }
  return {
    learnerReady: exam.type === 'FULL_TEST' && issues.length === 0,
    issues,
    counts: {
      total: questions.length,
      listening: questions.filter((question) => {
        const group = groups.find((candidate) =>
          candidate.questions.some((item) => item.id === question.id),
        );
        return !!group && group.part <= 4;
      }).length,
      reading: questions.filter((question) => {
        const group = groups.find((candidate) =>
          candidate.questions.some((item) => item.id === question.id),
        );
        return !!group && group.part >= 5;
      }).length,
      groups: groups.length,
    },
  };
}
