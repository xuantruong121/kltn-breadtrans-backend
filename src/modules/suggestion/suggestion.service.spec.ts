import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  SuggestionAttachmentType,
  SuggestionCategory,
  SuggestionStatus,
} from '@prisma/client';
import { SuggestionService } from './suggestion.service';

describe('SuggestionService', () => {
  const prisma = {
    suggestion: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const notificationsService = { createNotification: jest.fn() };
  const service = new SuggestionService(prisma as never, notificationsService as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes learner detail reads to the authenticated owner', async () => {
    prisma.suggestion.findFirst.mockResolvedValue(null);

    await expect(service.getMine(41, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.suggestion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, userId: 41 } }),
    );
  });

  it('rejects an untrusted document attachment before persistence', async () => {
    await expect(
      service.create(41, {
        category: SuggestionCategory.FEATURE,
        content: 'Đề xuất cần được kiểm tra an toàn.',
        attachments: [
          {
            type: SuggestionAttachmentType.FILE,
            name: 'unsafe.pdf',
            url: 'https://example.test/unsafe.pdf',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.suggestion.create).not.toHaveBeenCalled();
  });

  it('marks a non-empty admin reply as responded and records its author', async () => {
    prisma.suggestion.findUnique.mockResolvedValue({
      id: 99,
      userId: 41,
      status: SuggestionStatus.PENDING,
    });
    prisma.suggestion.update.mockResolvedValue({ id: 99 });

    await service.updateAdmin(99, 7, { adminResponse: 'Cảm ơn bạn.' });

    expect(prisma.suggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: expect.objectContaining({
          status: SuggestionStatus.RESPONDED,
          adminResponse: 'Cảm ơn bạn.',
          respondedById: 7,
        }),
      }),
    );
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 41, type: 'SUGGESTION_RESPONSE' }),
    );
  });
});
