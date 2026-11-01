import { BadRequestException } from '@nestjs/common';
import { IssueReportStatus } from '@prisma/client';
import { IssueReportService } from './issue-report.service';

describe('IssueReportService', () => {
  const report = {
    id: 5,
    reportCode: 'BT-5',
    reporterId: 9,
    status: IssueReportStatus.NEW,
    resolutionNote: null,
    assignedAdminId: null,
    resolvedAt: null,
    route: null,
    sourceType: null,
    sourceId: null,
  };
  const build = (current: Record<string, unknown> = report) => {
    const prisma = {
      issueReport: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...current, ...data }),
          ),
      },
      quiz: { findUnique: jest.fn() },
      speakingExercise: { findUnique: jest.fn() },
      vocabWord: { findUnique: jest.fn() },
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue({}),
    };
    return {
      prisma,
      notifications,
      service: new IssueReportService(prisma as never, notifications as never),
    };
  };

  describe('update', () => {
    it.each([
      IssueReportStatus.RESOLVED,
      IssueReportStatus.REJECTED,
      IssueReportStatus.DUPLICATE,
    ])('notifies the reporter once when closed as %s', async (status) => {
      const { service, notifications } = build();

      await service.update(5, 1, { status, resolutionNote: 'Ghi chú xử lý' });

      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 9,
          type: 'ISSUE_REPORT_RESULT',
          body: 'Ghi chú xử lý',
        }),
      );
    });

    it('does not notify again when a closed report is edited', async () => {
      const { service, notifications } = build({
        ...report,
        status: IssueReportStatus.RESOLVED,
        resolutionNote: 'Cũ',
      });

      await service.update(5, 1, {
        status: IssueReportStatus.RESOLVED,
        resolutionNote: 'Mới',
      });

      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('does not notify while the report is only in review', async () => {
      const { service, notifications } = build();

      await service.update(5, 1, { status: IssueReportStatus.IN_REVIEW });

      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('needs a note before closing as duplicate', async () => {
      const { service } = build();

      await expect(
        service.update(5, 1, { status: IssueReportStatus.DUPLICATE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the result when the notification fails', async () => {
      const { service, notifications } = build();
      notifications.createNotification.mockRejectedValue(new Error('down'));

      await expect(
        service.update(5, 1, {
          status: IssueReportStatus.REJECTED,
          resolutionNote: 'Không tái hiện được',
        }),
      ).resolves.toMatchObject({ status: IssueReportStatus.REJECTED });
    });
  });

  describe('get', () => {
    it('links a quiz report to its skill CMS screen', async () => {
      const { service, prisma } = build({
        ...report,
        sourceType: 'QUIZ',
        sourceId: '7',
      });
      prisma.quiz.findUnique.mockResolvedValue({ type: 'BILINGUAL_READING' });

      await expect(service.get(5)).resolves.toMatchObject({
        adminHref: '/admin/reading/7',
      });
    });

    it('links a speaking exercise to the set that holds it', async () => {
      const { service, prisma } = build({
        ...report,
        sourceType: 'SPEAKING_EXERCISE',
        sourceId: '3',
      });
      prisma.speakingExercise.findUnique.mockResolvedValue({
        practiceSetId: 'set-1',
      });

      await expect(service.get(5)).resolves.toMatchObject({
        adminHref: '/admin/speaking/set-1',
      });
    });

    it('links a vocabulary word to its deck', async () => {
      const { service, prisma } = build({
        ...report,
        sourceType: 'VOCAB_WORD',
        sourceId: '3',
      });
      prisma.vocabWord.findUnique.mockResolvedValue({ topicId: 11 });

      await expect(service.get(5)).resolves.toMatchObject({
        adminHref: '/admin/vocab/11',
      });
    });

    it('falls back to the learner route', async () => {
      const { service } = build({ ...report, route: '/reading/2' });

      await expect(service.get(5)).resolves.toMatchObject({
        adminHref: '/admin/reading/2',
      });
    });

    it('has no link when the source is gone or unknown', async () => {
      const { service, prisma } = build({
        ...report,
        sourceType: 'QUIZ',
        sourceId: 'abc',
      });

      await expect(service.get(5)).resolves.toMatchObject({ adminHref: null });
      expect(prisma.quiz.findUnique).not.toHaveBeenCalled();
    });
  });
});
