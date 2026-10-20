import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SuggestionAttachmentType,
  SuggestionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSuggestionDto,
  SuggestionAttachmentDto,
} from './dto/create-suggestion.dto';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { UpdateSuggestionDto } from './dto/update-suggestion.dto';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import { NotificationsService } from '../notifications/notifications.service';

const SAFE_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt']);

@Injectable()
export class SuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private isTrustedStoredFile(urlValue: string) {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      return false;
    }
    if (
      url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
    )
      return false;
    const configuredHosts = [
      process.env.R2_PUBLIC_URL,
      process.env.LOCAL_S3_PUBLIC_URL,
    ].flatMap((value) => {
      try {
        return value ? [new URL(value).host.toLowerCase()] : [];
      } catch {
        return [];
      }
    });
    return (
      url.host.toLowerCase().endsWith('.r2.dev') ||
      configuredHosts.includes(url.host.toLowerCase())
    );
  }

  private validateAttachments(attachments: SuggestionAttachmentDto[] = []) {
    if (attachments.length > 5)
      throw new BadRequestException('Tối đa 5 tệp đính kèm.');
    for (const attachment of attachments) {
      if (attachment.type === SuggestionAttachmentType.LINK) continue;
      if (attachment.type === SuggestionAttachmentType.IMAGE) {
        if (!isAcceptedContentImageReference(attachment.url)) {
          throw new BadRequestException(
            'Ảnh đính kèm phải là PNG, JPG hoặc WEBP đã tải lên hệ thống.',
          );
        }
        continue;
      }
      const extension = new URL(attachment.url).pathname
        .split('.')
        .pop()
        ?.toLowerCase();
      if (
        !extension ||
        !SAFE_DOCUMENT_EXTENSIONS.has(extension) ||
        !this.isTrustedStoredFile(attachment.url)
      ) {
        throw new BadRequestException(
          'Tệp đính kèm chỉ hỗ trợ PDF, DOC, DOCX hoặc TXT đã tải lên hệ thống.',
        );
      }
    }
  }

  private learnerSelect() {
    return {
      id: true,
      category: true,
      content: true,
      status: true,
      adminResponse: true,
      respondedAt: true,
      createdAt: true,
      updatedAt: true,
      attachments: {
        select: {
          id: true,
          type: true,
          name: true,
          url: true,
          createdAt: true,
        },
      },
    } satisfies Prisma.SuggestionSelect;
  }

  async create(userId: number, dto: CreateSuggestionDto) {
    const content = dto.content.trim();
    if (content.length < 10)
      throw new BadRequestException('Nội dung cần ít nhất 10 ký tự.');
    this.validateAttachments(dto.attachments);
    return this.prisma.suggestion.create({
      data: {
        userId,
        category: dto.category,
        content,
        attachments: dto.attachments?.length
          ? {
              create: dto.attachments.map((item) => ({
                type: item.type,
                name: item.name.trim(),
                url: item.url.trim(),
              })),
            }
          : undefined,
      },
      select: this.learnerSelect(),
    });
  }

  async listMine(userId: number, query: SuggestionQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where: Prisma.SuggestionWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.suggestion.findMany({
        where,
        select: this.learnerSelect(),
        orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.suggestion.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getMine(userId: number, id: number) {
    const suggestion = await this.prisma.suggestion.findFirst({
      where: { id, userId },
      select: this.learnerSelect(),
    });
    if (!suggestion) throw new NotFoundException('Không tìm thấy đề xuất.');
    return suggestion;
  }

  async listAdmin(query: SuggestionQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.SuggestionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                content: { contains: query.search.trim(), mode: 'insensitive' },
              },
              {
                user: {
                  email: { contains: query.search.trim(), mode: 'insensitive' },
                },
              },
              {
                user: {
                  profile: {
                    fullName: {
                      contains: query.search.trim(),
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.suggestion.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true, avatar: true } },
            },
          },
          attachments: true,
        },
        orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.suggestion.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAdmin(id: number) {
    const suggestion = await this.prisma.suggestion.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
        },
        respondedBy: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        attachments: true,
      },
    });
    if (!suggestion) throw new NotFoundException('Không tìm thấy đề xuất.');
    return suggestion;
  }

  async updateAdmin(id: number, adminId: number, dto: UpdateSuggestionDto) {
    const current = await this.prisma.suggestion.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Không tìm thấy đề xuất.');
    const response = dto.adminResponse?.trim();
    const hasResponse = response !== undefined && response.length > 0;
    const status =
      dto.status ?? (hasResponse ? SuggestionStatus.RESPONDED : current.status);
    const updated = await this.prisma.suggestion.update({
      where: { id },
      data: {
        status,
        ...(response !== undefined
          ? {
              adminResponse: response || null,
              respondedAt: response ? new Date() : null,
              respondedById: response ? adminId : null,
            }
          : {}),
      },
      include: { attachments: true },
    });

    if (hasResponse && response !== current.adminResponse) {
      await this.notificationsService.createNotification({
        userId: current.userId,
        type: 'SUGGESTION_RESPONSE',
        title: 'Quản trị viên đã phản hồi đề xuất của bạn',
        body: response.slice(0, 160),
        url: '/hub?suggestion=1',
      });
    }

    return updated;
  }
}
