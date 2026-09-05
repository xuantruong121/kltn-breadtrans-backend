import { Test, TestingModule } from '@nestjs/testing';
import { ClassService } from './class.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('ClassService - Cross-Ownership Security Tests', () => {
  let service: ClassService;

  const mockPrisma = {
    class: {
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockEventsGateway = {
    broadcastClassUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
      ],
    }).compile();

    service = module.get<ClassService>(ClassService);
    jest.clearAllMocks();
  });

  describe('Session Cross-Ownership Security (X03, X04)', () => {
    // X03. Teacher A thử tạo Session mới cho Class của Teacher B -> 403 Forbidden
    it('X03. Teacher A thử tạo Session mới cho Class của Teacher B -> 403 Forbidden', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 18,
        teacherId: 42, // Teacher B
        name: 'Class of Teacher B',
      });

      await expect(
        service.createSession(
          18,
          {
            title: 'Unauthorized Session',
            startTime: new Date(),
            endTime: new Date(Date.now() + 3600000),
          },
          41, // Teacher A
          'TEACHER',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // X04. Teacher A thử xóa Session của Class thuộc Teacher B -> 403 Forbidden
    it('X04. Teacher A thử xóa Session của Class thuộc Teacher B -> 403 Forbidden', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 37,
        classId: 18,
        class: {
          id: 18,
          teacherId: 42, // Teacher B
        },
      });

      await expect(
        service.deleteSession(37, 41, 'TEACHER'), // Teacher A
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
