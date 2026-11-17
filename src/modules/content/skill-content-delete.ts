/**
 * When an admin may delete a whole skill item (owner 2026-11-17, after the
 * admin review found the speaking "Xóa" button calling a route that never
 * existed). Deleting removes learner history with it (submissions cascade),
 * so it is refused as soon as a learner has worked on the item.
 *
 * - Speaking practice set: any status, but no learner recording, and not a set
 *   that belongs to a TOEIC exam.
 * - Listening, Reading, Writing: draft only, no submission, not a task of a
 *   TOEIC writing set.
 *
 * Pure: no Prisma, no I/O.
 */
export type SkillDeleteFacts = {
  domain: 'listening' | 'reading' | 'writing' | 'speaking';
  /** Quiz publication status, or the speaking set's. */
  status: string;
  /** Learner submissions (speaking: recordings) on the item. */
  attempts: number;
  /** Speaking: set scope; quizzes: whether a TOEIC writing set uses it. */
  examInternal: boolean;
};

export function skillDeleteRefusal(facts: SkillDeleteFacts): string | null {
  if (facts.examInternal)
    return facts.domain === 'speaking'
      ? 'Bộ Nói này thuộc một đề thi TOEIC; quản lý nó trong đề thi.'
      : 'Bài này thuộc một đề thi TOEIC; không xoá ở đây.';
  if (facts.attempts > 0)
    return facts.domain === 'speaking'
      ? 'Bộ luyện đã có học viên làm bài, xoá sẽ mất bài làm của họ. Hãy chuyển về bản nháp thay vì xoá.'
      : 'Bài đã có học viên làm, xoá sẽ mất bài làm của họ. Hãy để ở bản nháp thay vì xoá.';
  if (facts.domain !== 'speaking' && facts.status !== 'DRAFT')
    return 'Chỉ xoá được bài đang là bản nháp. Hãy chuyển về bản nháp trước.';
  return null;
}
