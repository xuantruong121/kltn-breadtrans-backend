import { IssueReportStatus, QuizType } from '@prisma/client';
import {
  adminHrefFromRoute,
  closureNotice,
  isClosedStatus,
  quizAdminHref,
} from './issue-report.logic';

describe('issue report logic', () => {
  it('opens the CMS screen that edits each skill practice', () => {
    expect(quizAdminHref(QuizType.LISTENING_PRACTICE, 4)).toBe(
      '/admin/listening/4',
    );
    expect(quizAdminHref(QuizType.BILINGUAL_READING, 4)).toBe(
      '/admin/reading/4',
    );
    expect(quizAdminHref(QuizType.WRITING_EMAIL, 4)).toBe('/admin/writing/4');
    expect(quizAdminHref(QuizType.WRITING_PICTURE, 4)).toBe('/admin/writing/4');
  });

  it('has no CMS screen for exam content', () => {
    expect(quizAdminHref(QuizType.TOEIC, 4)).toBeNull();
  });

  it('reads a skill practice from the learner route', () => {
    expect(adminHrefFromRoute('/reading/12')).toBe('/admin/reading/12');
    expect(adminHrefFromRoute('/listening/3?tab=a')).toBe('/admin/listening/3');
    expect(adminHrefFromRoute('/writing/9/result')).toBe('/admin/writing/9');
  });

  it('ignores routes that do not name a practice', () => {
    expect(adminHrefFromRoute('/reading/submissions/12')).toBeNull();
    expect(adminHrefFromRoute('/dashboard')).toBeNull();
    expect(adminHrefFromRoute(null)).toBeNull();
  });

  it('treats resolved, rejected and duplicate reports as closed', () => {
    expect(isClosedStatus(IssueReportStatus.RESOLVED)).toBe(true);
    expect(isClosedStatus(IssueReportStatus.REJECTED)).toBe(true);
    expect(isClosedStatus(IssueReportStatus.DUPLICATE)).toBe(true);
    expect(isClosedStatus(IssueReportStatus.NEW)).toBe(false);
    expect(isClosedStatus(IssueReportStatus.IN_REVIEW)).toBe(false);
  });

  it('tells the learner the result and the note', () => {
    const notice = closureNotice(
      IssueReportStatus.RESOLVED,
      'BT-1',
      'Đã sửa đáp án câu 2',
    );
    expect(notice.title).toBe('Báo lỗi BT-1 đã được xử lý');
    expect(notice.body).toBe('Đã sửa đáp án câu 2');
  });

  it('keeps the note short enough for a notification', () => {
    const notice = closureNotice(
      IssueReportStatus.REJECTED,
      'BT-1',
      'x'.repeat(400),
    );
    expect(notice.body).toHaveLength(160);
  });
});
