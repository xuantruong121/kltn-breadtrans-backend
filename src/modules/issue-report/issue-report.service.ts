import {
  BadRequestException,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IssueReportStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateIssueReportDto } from './dto/create-issue-report.dto';
import { IssueReportQueryDto } from './dto/issue-report-query.dto';
import { UpdateIssueReportDto } from './dto/update-issue-report.dto';
import {
  adminHrefFromRoute,
  closureNotice,
  isClosedStatus,
  quizAdminHref,
} from './issue-report.logic';

@Injectable()
export class IssueReportService {
  private readonly logger = new Logger(IssueReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private code() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `BT-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private validateRoute(route?: string) {
    if (route && (!route.startsWith('/') || route.startsWith('//'))) {
      throw new BadRequestException('Đường dẫn báo lỗi không hợp lệ.');
    }
  }

  async create(reporterId: number, dto: CreateIssueReportDto) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await this.prisma.issueReport.count({
      where: { reporterId, createdAt: { gte: since } },
    });
    if (recentCount >= 20) {
      throw new HttpException(
        'Bạn đã gửi quá nhiều báo lỗi trong hôm nay. Vui lòng thử lại sau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.validateRoute(dto.route);
    const description = dto.description.trim();
    if (description.length < 20) {
      throw new BadRequestException('Mô tả cần ít nhất 20 ký tự.');
    }

    const serializedContext = dto.context ? JSON.stringify(dto.context) : '';
    if (serializedContext.length > 5000) {
      throw new BadRequestException('Thông tin ngữ cảnh báo lỗi quá lớn.');
    }
    const context = dto.context;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const report = await this.prisma.issueReport.create({
          data: {
            reportCode: this.code(),
            reporterId,
            area: dto.area,
            category: dto.category,
            impact: dto.impact,
            description,
            route: dto.route?.slice(0, 300),
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            questionId: dto.questionId,
            context: context as Prisma.InputJsonValue | undefined,
          },
          select: { reportCode: true, status: true, createdAt: true },
        });
        return {
          message:
            'Đã tiếp nhận báo lỗi. Cảm ơn bạn đã giúp BreadTrans cải thiện.',
          ...report,
        };
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002' ||
          attempt === 2
        ) {
          throw error;
        }
      }
    }
    throw new BadRequestException(
      'Không thể tạo mã báo lỗi. Vui lòng thử lại.',
    );
  }

  async list(query: IssueReportQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.IssueReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.area ? { area: query.area } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                reportCode: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                description: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const [data, total, grouped] = await Promise.all([
      this.prisma.issueReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reporter: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true, avatar: true } },
            },
          },
          assignedAdmin: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true } },
            },
          },
        },
      }),
      this.prisma.issueReport.count({ where }),
      this.prisma.issueReport.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts: Object.fromEntries(
        grouped.map((item) => [item.status, item._count._all]),
      ),
    };
  }

  async get(id: number) {
    const report = await this.prisma.issueReport.findUnique({
      where: { id },
      include: {
        reporter: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
        },
        assignedAdmin: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Không tìm thấy báo lỗi.');
    return { ...report, adminHref: await this.adminHref(report) };
  }

  /** The CMS screen that fixes the reported content, when one can be found. */
  private async adminHref(report: {
    route: string | null;
    sourceType: string | null;
    sourceId: string | null;
  }) {
    const id = Number(report.sourceId);
    if (report.sourceId && Number.isInteger(id) && id > 0) {
      if (report.sourceType === 'QUIZ') {
        const quiz = await this.prisma.quiz.findUnique({
          where: { id },
          select: { type: true },
        });
        if (quiz) return quizAdminHref(quiz.type, id);
      }
      if (report.sourceType === 'SPEAKING_EXERCISE') {
        const exercise = await this.prisma.speakingExercise.findUnique({
          where: { id },
          select: { practiceSetId: true },
        });
        if (exercise?.practiceSetId)
          return `/admin/speaking/${exercise.practiceSetId}`;
      }
      if (report.sourceType === 'VOCAB_WORD') {
        const word = await this.prisma.vocabWord.findUnique({
          where: { id },
          select: { topicId: true },
        });
        if (word) return `/admin/vocab/${word.topicId}`;
      }
    }
    return adminHrefFromRoute(report.route);
  }

  async update(id: number, adminId: number, dto: UpdateIssueReportDto) {
    const current = await this.prisma.issueReport.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Không tìm thấy báo lỗi.');
    if (dto.assignedAdminId) {
      const admin = await this.prisma.user.findFirst({
        where: { id: dto.assignedAdminId, role: Role.ADMIN },
        select: { id: true },
      });
      if (!admin)
        throw new BadRequestException('Quản trị viên được gán không hợp lệ.');
    }
    const status = dto.status ?? current.status;
    const resolutionNote = dto.resolutionNote?.trim() || current.resolutionNote;
    const closing = isClosedStatus(status);
    if (closing && !resolutionNote) {
      throw new BadRequestException(
        'Cần ghi chú xử lý trước khi đóng báo lỗi.',
      );
    }
    const updated = await this.prisma.issueReport.update({
      where: { id },
      data: {
        status,
        resolutionNote,
        assignedAdminId:
          dto.assignedAdminId ?? current.assignedAdminId ?? adminId,
        resolvedAt: closing ? new Date() : current.resolvedAt,
      },
    });
    if (closing && !isClosedStatus(current.status) && resolutionNote) {
      await this.notifyReporter(
        current.reporterId,
        status,
        current.reportCode,
        resolutionNote,
      );
    }
    return updated;
  }

  /** The report is already closed, so a failed notification only gets logged. */
  private async notifyReporter(
    userId: number,
    status: IssueReportStatus,
    reportCode: string,
    note: string,
  ) {
    try {
      await this.notifications.createNotification({
        userId,
        type: 'ISSUE_REPORT_RESULT',
        ...closureNotice(status, reportCode, note),
      });
    } catch (error) {
      this.logger.warn(
        `Could not notify the reporter of ${reportCode}: ${String(error)}`,
      );
    }
  }
}
