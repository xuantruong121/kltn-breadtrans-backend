import { IssueReportStatus, QuizType } from '@prisma/client';

const CLOSED: IssueReportStatus[] = [
  IssueReportStatus.RESOLVED,
  IssueReportStatus.REJECTED,
  IssueReportStatus.DUPLICATE,
];

export const isClosedStatus = (status: IssueReportStatus) =>
  CLOSED.includes(status);

/** The CMS screen that edits a skill practice. Exams have no such screen. */
export function quizAdminHref(type: QuizType, id: number): string | null {
  if (type === QuizType.LISTENING_PRACTICE) return `/admin/listening/${id}`;
  if (type === QuizType.BILINGUAL_READING) return `/admin/reading/${id}`;
  if (type === QuizType.WRITING_EMAIL || type === QuizType.WRITING_PICTURE)
    return `/admin/writing/${id}`;
  return null;
}

/** Reports sent without a source still carry the learner page they came from. */
export function adminHrefFromRoute(route?: string | null): string | null {
  const match = /^\/(listening|reading|writing)\/(\d+)(?:[/?#]|$)/.exec(
    route ?? '',
  );
  return match ? `/admin/${match[1]}/${match[2]}` : null;
}

const CLOSURE_TITLE: Partial<Record<IssueReportStatus, string>> = {
  [IssueReportStatus.RESOLVED]: 'đã được xử lý',
  [IssueReportStatus.REJECTED]: 'chưa được chấp nhận',
  [IssueReportStatus.DUPLICATE]: 'trùng với báo lỗi đã có',
};

export function closureNotice(
  status: IssueReportStatus,
  reportCode: string,
  note: string,
) {
  return {
    title: `Báo lỗi ${reportCode} ${CLOSURE_TITLE[status] ?? 'đã có cập nhật'}`,
    body: note.slice(0, 160),
  };
}
