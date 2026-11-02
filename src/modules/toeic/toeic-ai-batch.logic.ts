type BatchQuestion = {
  text?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
};
type BatchGroup = {
  passageText?: unknown;
  imageBrief?: unknown;
  questions?: BatchQuestion[];
};
type GeneratedBatch = {
  part: number;
  candidate?: { groups?: BatchGroup[] };
};

/** A new sentence around the same answer still tests the same word. */
function testedSentence(question: BatchQuestion) {
  const text = String(question.text ?? '');
  const answer = Array.isArray(question.options)
    ? question.options[Number(question.correctIndex)]
    : undefined;
  return text && answer ? `${text} (tests: ${String(answer)})` : text;
}

/**
 * Each batch is generated on its own and the model has no memory of the last
 * one, so it is told what the same Part already holds. Without this, Part 5
 * keeps returning the same sentences and fails the duplicate check.
 */
export function questionsToAvoid(
  batches: GeneratedBatch[],
  part: number,
  limit = 60,
) {
  const groups = batches
    .filter((batch) => batch.part === part)
    .flatMap((batch) => batch.candidate?.groups ?? []);
  const texts = groups.flatMap((group) => {
    // Part 6 prompts only say "blank [131]" and Part 1 has none, so what
    // repeats there is the passage or the scene.
    if (part === 6) return [String(group.passageText ?? '').slice(0, 160)];
    if (part === 1) return [String(group.imageBrief ?? '')];
    return (group.questions ?? []).map((question) =>
      part === 5 ? testedSentence(question) : String(question.text ?? ''),
    );
  });
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(-limit);
}

/** Options are sorted so a reshuffled copy still counts as the same question. */
export function questionFingerprint(question: BatchQuestion) {
  const options = Array.isArray(question.options)
    ? question.options.map(String).sort()
    : [];
  return `${String(question.text ?? '')} ${options.join('|')}`
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const LETTERS = 'ABCD';
const OPTION_LABEL = /^\(?([A-D])[).:]\s+(.+)$/s;
const NAMED_OPTION =
  /((?:[Đđ]áp án|[Pp]hương án|[Ll]ựa chọn|[Oo]ption|[Cc]hoice)\s+)(\(?[A-D]\)?(?:\s*(?:,|và|hoặc|and|or)\s*\(?[A-D]\)?)*)(?![\p{L}\p{N}])/gu;
// The model sometimes numbers a blank after it, as "_____ [1]".
const BLANK = /(?:\[\d+\]\s*)?_{3,}(?:\s*\[\d+\])?/g;

/** The UI prints its own A/B/C/D; a label from the model would show twice. */
export function stripOptionLabels(options: string[]) {
  const stripped = options.map((option, index) => {
    const match = OPTION_LABEL.exec(option.trim());
    return match?.[1] === LETTERS[index] ? match[2].trim() : null;
  });
  return stripped.every(Boolean) ? (stripped as string[]) : options;
}

/**
 * The model favours the second option, so the key would be guessable if its
 * order were kept. An explanation that names an option by letter is rewritten
 * to the new letter so it still points at the same answer.
 */
export function shuffleOptions(question: BatchQuestion, random = Math.random) {
  const options = question.options as string[];
  const order = options.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  const moved = (from: number) => order.indexOf(from);
  return {
    ...question,
    options: order.map((from) => options[from]),
    correctIndex: moved(Number(question.correctIndex)),
    explanation: String(question.explanation ?? '')
      .normalize('NFC')
      .replace(NAMED_OPTION, (_, lead: string, letters: string) => {
        const renamed = letters.replace(/[A-D]/g, (letter) => {
          const to = moved(LETTERS.indexOf(letter));
          return to < 0 ? letter : LETTERS[to];
        });
        return `${lead}${renamed}`;
      }),
  };
}

function isSentenceOption(option: string) {
  return option.trim().split(/\s+/).length >= 5;
}

/**
 * Part 6 blanks carry the exam-wide question number, which the model cannot
 * know, so numbering and the fixed prompt are written here.
 */
function numberPassageBlanks(group: BatchGroup, firstQuestionNumber: number) {
  const questions = group.questions ?? [];
  const blanks = String(group.passageText ?? '').match(BLANK) ?? [];
  if (blanks.length !== questions.length) return group;
  let index = 0;
  const passageText = String(group.passageText).replace(BLANK, () => {
    index += 1;
    return `[${firstQuestionNumber + index - 1}] _____`;
  });
  return {
    ...group,
    passageText,
    questions: questions.map((question, position) => {
      const number = firstQuestionNumber + position;
      const options = (question.options ?? []) as string[];
      return {
        ...question,
        text: options.every(isSentenceOption)
          ? `Choose the sentence that best completes blank [${number}].`
          : `Choose the best option for blank [${number}].`,
      };
    }),
  };
}

export function prepareGeneratedBatch<T>(
  part: number,
  candidate: T,
  firstQuestionNumber: number,
  random = Math.random,
): T {
  const groups = (candidate as { groups?: BatchGroup[] })?.groups;
  if (!Array.isArray(groups)) return candidate;
  let questionNumber = firstQuestionNumber;
  const prepared = groups.map((group) => {
    if (!Array.isArray(group.questions)) return group;
    const questions = group.questions.map((question) =>
      Array.isArray(question.options)
        ? shuffleOptions(
            {
              ...question,
              options: stripOptionLabels(question.options.map(String)),
            },
            random,
          )
        : question,
    );
    const first = questionNumber;
    questionNumber += questions.length;
    const next = { ...group, questions };
    return part === 6 ? numberPassageBlanks(next, first) : next;
  });
  return { ...candidate, groups: prepared };
}

/** Explanations are read by Vietnamese learners; unmarked text is unreadable. */
export function isVietnameseExplanation(text: unknown) {
  return /[à-ỹ]/i.test(String(text ?? ''));
}

/** What makes a Reading item unanswerable even when its shape is valid. */
export function readingGroupIssue(part: number, group: BatchGroup) {
  const questions = group.questions ?? [];
  const texts = questions.map((question) => String(question.text ?? '').trim());
  if (part === 5 && texts.some((text) => !/_{3,}/.test(text)))
    return 'Part 5: câu hỏi phải là một câu có chỗ trống';
  if (part === 7 && texts.some((text) => !text))
    return 'Part 7: câu hỏi thiếu nội dung câu hỏi';
  if (part === 6) {
    const blanks = String(group.passageText ?? '').match(/_{3,}/g) ?? [];
    if (blanks.length !== questions.length)
      return `Part 6: đoạn văn có ${blanks.length} chỗ trống cho ${questions.length} câu hỏi`;
  }
  return null;
}
