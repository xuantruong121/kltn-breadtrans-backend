import { Test, TestingModule } from '@nestjs/testing';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Role } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { HttpStatus } from '@nestjs/common';

describe('PaymentController', () => {
  let controller: PaymentController;
  let service: any;
  let reflector: Reflector;

  beforeEach(async () => {
    const mockService = {
      getMyPayments: jest.fn(),
      getPaymentDetailById: jest.fn(),
      reportTransfer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: mockService },
        Reflector,
      ],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
    service = module.get<PaymentService>(PaymentService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('has @Roles(Role.STUDENT) on controller level', () => {
    const roles = reflector.get<Role[]>(ROLES_KEY, PaymentController);
    expect(roles).toEqual([Role.STUDENT]);
  });

  describe('route order and methods', () => {
    it('declares getMyPayments before getPaymentById on prototype', () => {
      const proto = Object.getOwnPropertyNames(PaymentController.prototype);
      const indexMe = proto.indexOf('getMyPayments');
      const indexId = proto.indexOf('getPaymentById');
      expect(indexMe).toBeGreaterThan(-1);
      expect(indexId).toBeGreaterThan(-1);
      expect(indexMe).toBeLessThan(indexId);
    });

    it('has @HttpCode(HttpStatus.OK) (200) metadata on reportTransfer', () => {
      const httpCode = Reflect.getMetadata(
        '__httpCode__',
        controller.reportTransfer,
      );
      expect(httpCode).toBe(HttpStatus.OK);
    });
  });

  describe('controller delegations', () => {
    it('delegates getMyPayments to service with authenticated req.user.id', async () => {
      const req = { user: { id: 42, role: Role.STUDENT } };
      service.getMyPayments.mockResolvedValue([]);

      const result = await controller.getMyPayments(req);

      expect(service.getMyPayments).toHaveBeenCalledWith(42);
      expect(result).toEqual([]);
    });

    it('delegates getPaymentById to service with param id and authenticated req.user.id', async () => {
      const req = { user: { id: 42, role: Role.STUDENT } };
      service.getPaymentDetailById.mockResolvedValue({ id: 99 });

      const result = await controller.getPaymentById(99, req);

      expect(service.getPaymentDetailById).toHaveBeenCalledWith(99, 42);
      expect(result).toEqual({ id: 99 });
    });

    it('delegates reportTransfer to service with param id and authenticated req.user.id', async () => {
      const req = { user: { id: 42, role: Role.STUDENT } };
      service.reportTransfer.mockResolvedValue({ id: 99, status: 'REPORTED' });

      const result = await controller.reportTransfer(99, req);

      expect(service.reportTransfer).toHaveBeenCalledWith(99, 42);
      expect(result).toEqual({ id: 99, status: 'REPORTED' });
    });
  });
});
