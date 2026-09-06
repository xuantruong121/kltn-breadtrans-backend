import { Test, TestingModule } from '@nestjs/testing';
import { PaymentAdminController } from './payment-admin.controller';
import { PaymentService } from './payment.service';
import { PaymentStatus, Role } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AdminPaymentFilterDto,
  RejectPaymentDto,
} from './dto/payment-admin.dto';

type MockPaymentService = {
  getAdminPayments: jest.Mock<any, any>;
  getAdminPaymentDetail: jest.Mock<any, any>;
  rejectPayment: jest.Mock<any, any>;
};

describe('PaymentAdminController', () => {
  let controller: PaymentAdminController;
  let service: MockPaymentService;
  let reflector: Reflector;

  beforeEach(async () => {
    const mockService: MockPaymentService = {
      getAdminPayments: jest.fn(),
      getAdminPaymentDetail: jest.fn(),
      rejectPayment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentAdminController],
      providers: [
        { provide: PaymentService, useValue: mockService },
        Reflector,
      ],
    }).compile();

    controller = module.get<PaymentAdminController>(PaymentAdminController);
    service = module.get<PaymentService>(
      PaymentService,
    ) as unknown as MockPaymentService;
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Security and Guard Metadata', () => {
    it('has @Roles(Role.ADMIN) on controller level', () => {
      const roles = reflector.get<Role[]>(ROLES_KEY, PaymentAdminController);
      expect(roles).toEqual([Role.ADMIN]);
    });

    it('has JwtAuthGuard and RolesGuard attached to controller', () => {
      const guards = Reflect.getMetadata('__guards__', PaymentAdminController);
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
    });

    it('has @HttpCode(HttpStatus.OK) (200) metadata on rejectPayment', () => {
      const httpCode = Reflect.getMetadata(
        '__httpCode__',
        controller.rejectPayment,
      );
      expect(httpCode).toBe(HttpStatus.OK);
    });
  });

  describe('Controller Delegations', () => {
    it('delegates getAdminPayments to service with query filters', async () => {
      const query: AdminPaymentFilterDto = {
        status: PaymentStatus.REPORTED,
        search: 'BT-123',
        page: 2,
        limit: 20,
      };
      const mockResult = {
        items: [],
        pagination: { page: 2, limit: 20, totalItems: 0, totalPages: 1 },
      };
      service.getAdminPayments.mockResolvedValue(mockResult);

      const result = await controller.getAdminPayments(query);

      expect(service.getAdminPayments).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockResult);
    });

    it('delegates getAdminPaymentDetail to service with payment id', async () => {
      const paymentId = 15;
      const mockDetail = { id: 15, transferCode: 'BT-15' };
      service.getAdminPaymentDetail.mockResolvedValue(mockDetail);

      const result = await controller.getAdminPaymentDetail(paymentId);

      expect(service.getAdminPaymentDetail).toHaveBeenCalledWith(paymentId);
      expect(result).toEqual(mockDetail);
    });

    it('delegates rejectPayment to service using param id, req.user.id, and dto', async () => {
      const paymentId = 88;
      const req = { user: { id: 9, role: Role.ADMIN } };
      const dto: RejectPaymentDto = {
        reason: 'Sai số tiền chuyển khoản, yêu cầu nộp lại đúng số dư',
      };
      const mockRejected = {
        id: paymentId,
        status: PaymentStatus.REJECTED,
        reviewedById: 9,
        adminNote: dto.reason,
      };
      service.rejectPayment.mockResolvedValue(mockRejected);

      const result = await controller.rejectPayment(paymentId, req, dto);

      expect(service.rejectPayment).toHaveBeenCalledWith(
        paymentId,
        req.user.id,
        dto,
      );
      expect(result).toEqual(mockRejected);
    });
  });
});
