/**
 * Grammar question rules shared by create, update, bulk add and publish,
 * plus the admin topic list filters. No Prisma, no I/O.
 */
import { isAll, ListQuery, matchesSearch } from '../../common/paging/list-page';

export const OPTION_COUNT = 4;

export type GrammarQuestionInput = {
  question?: string | null;
  options?: unknown;
  correctIndex?: number | null;
  optionExplanations?: unknown;
};

/**
 * What is wrong with a question a learner would answer: a prompt, exactly
 * four distinct non-empty options and an answer among them. Empty list =
 * valid. Every question in kltn_db met this when the rule was tightened.
 */
export function questionProblems(input: GrammarQuestionInput): string[] {
  const problems: string[] = [];
  if (!String(input.question ?? '').trim())
    problems.push('Câu hỏi chưa có nội dung');
  const options = Array.isArray(input.options) ? input.options : [];
  if (options.length !== OPTION_COUNT)
    problems.push(
      `Cần đúng ${OPTION_COUNT} đáp án (đang có ${options.length})`,
    );
  const texts = options.map((option) =>
    String(option ?? '')
      .trim()
      .toLocaleLowerCase('vi'),
  );
  if (texts.some((text) => !text)) problems.push('Có đáp án để trống');
  if (new Set(texts.filter(Boolean)).size < texts.filter(Boolean).length)
    problems.push('Có hai đáp án giống nhau');
  const key = Number(input.correctIndex);
  if (!Number.isInteger(key) || key < 0 || key >= options.length)
    problems.push('Chưa chọn đáp án đúng');
  if (
    input.optionExplanations !== undefined &&
    input.optionExplanations !== null &&
    (!Array.isArray(input.optionExplanations) ||
      input.optionExplanations.length > OPTION_COUNT)
  )
    problems.push('Giải thích đáp án sai không hợp lệ');
  return problems;
}

/**
 * Why-wrong notes stored aligned with the options: trimmed, blank -> null,
 * nothing at the correct answer. All empty -> null (no column value).
 */
export function normalizeOptionExplanations(
  raw: unknown,
  correctIndex: number,
): Array<string | null> | null {
  if (!Array.isArray(raw)) return null;
  const notes = Array.from({ length: OPTION_COUNT }, (_, index) => {
    if (index === correctIndex) return null;
    const text = String(raw[index] ?? '').trim();
    return text || null;
  });
  return notes.some(Boolean) ? notes : null;
}

export type GrammarTopicListRow = {
  id: number;
  title: string;
  description?: string | null;
  keyFormula?: string | null;
  level: string;
  publicationStatus: string;
  totalQuestions: number;
  learnerAttemptCount: number;
};

const LEVEL_RANK: Record<string, number> = {
  BEGINNER: 0,
  INTERMEDIATE: 1,
  ADVANCED: 2,
};

/** Admin topic list after search, level and status, newest first. */
export function filterGrammarTopics<T extends GrammarTopicListRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      matchesSearch(query.q, row.title, row.description, row.keyFormula) &&
      (isAll(query.level) || row.level === query.level) &&
      (isAll(query.status) || row.publicationStatus === query.status),
  );
  const order: Record<string, (a: T, b: T) => number> = {
    NEWEST: (a, b) => b.id - a.id,
    TITLE: (a, b) => a.title.localeCompare(b.title, 'vi'),
    LEVEL: (a, b) =>
      (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) || b.id - a.id,
    FEWEST: (a, b) => a.totalQuestions - b.totalQuestions || b.id - a.id,
  };
  return visible.sort(order[query.sort ?? ''] ?? order.NEWEST);
}

export function grammarTopicFacets(rows: GrammarTopicListRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    locked: rows.filter((row) => row.learnerAttemptCount > 0).length,
  };
}
