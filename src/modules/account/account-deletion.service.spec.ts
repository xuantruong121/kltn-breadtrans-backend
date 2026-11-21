import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AccountDeletionService } from './account-deletion.service';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

describe('AccountDeletionService (owner 2026-11-16)', () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const redis = {
    getdel: jest.fn(),
    smembers: jest.fn().mockResolvedValue([]),
    mget: jest.fn().mockResolvedValue([]),
    srem: jest.fn(),
    del: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    set: jest.fn(),
    scan: jest.fn().mockResolvedValue(['0', []]),
    zrange: jest.fn().mockResolvedValue([]),
    multi: jest.fn(() => ({
      del: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
  };
  const email = { sendAccountDeletionScheduled: jest.fn() };
  let service: AccountDeletionService;

  const learner = (over: Record<string, unknown> = {}) => ({
    id: 5,
    email: 'learner@example.com',
    role: 'STUDENT',
    password: 'hash',
    deletionScheduledAt: null,
    anonymizedAt: null,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountDeletionService(
      prisma as never,
      redis as never,
      email as never,
    );
  });

  describe('request', () => {
    it('locks the account for at least 7 full days after the right password', async () => {
      prisma.user.findUnique.mockResolvedValue(learner());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const before = Date.now();
      const { scheduledAt } = await service.request(5, { password: 'pw' });

      const update = prisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 5 });
      expect(update.data.deletionRequestedAt).toBeInstanceOf(Date);
      const days = (new Date(scheduledAt).getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(7);
      expect(days).toBeLessThan(8);
      // 00:00 in Vietnam (17:00Z), the day the 00:02 purge runs (owner 2026-11-21).
      expect(scheduledAt).toMatch(/T17:00:00\.000Z$/);
      expect(email.sendAccountDeletionScheduled).toHaveBeenCalledWith(
        'learner@example.com',
        expect.objectContaining({
          subject: 'Yêu cầu xoá tài khoản BreadTrans đã được ghi nhận',
          html: expect.stringContaining('Huỷ yêu cầu xoá'),
        }),
      );
    });

    it('refuses a wrong password and changes nothing', async () => {
      prisma.user.findUnique.mockResolvedValue(learner());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.request(5, { password: 'bad' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('a Google-only account confirms by typing its e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue(learner({ password: null }));

      await expect(
        service.request(5, { confirmEmail: 'other@example.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();

      await service.request(5, { confirmEmail: ' Learner@Example.com ' });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('an admin cannot delete their own account', async () => {
      prisma.user.findUnique.mockResolvedValue(learner({ role: 'ADMIN' }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.request(5, { password: 'pw' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('a repeated request keeps the first date', async () => {
      const first = new Date('2026-11-20T00:00:00.000Z');
      prisma.user.findUnique.mockResolvedValue(
        learner({ deletionScheduledAt: first }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const { scheduledAt } = await service.request(5, { password: 'pw' });
      expect(scheduledAt).toBe(first.toISOString());
    });

    it('a failed e-mail does not undo the request', async () => {
      prisma.user.findUnique.mockResolvedValue(learner());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      email.sendAccountDeletionScheduled.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.request(5, { password: 'pw' }),
      ).resolves.toHaveProperty('scheduledAt');
    });
  });

  describe('cancel', () => {
    it('clears the schedule with a live token, once', async () => {
      redis.getdel.mockResolvedValue('5');
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.cancel('tok')).resolves.toEqual({ cancelled: true });
      expect(redis.getdel).toHaveBeenCalledWith('account:deletion:cancel:tok');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 5,
          anonymizedAt: null,
          deletionRequestedAt: { not: null },
        },
        data: { deletionRequestedAt: null, deletionScheduledAt: null },
      });
    });

    it('refuses an expired or unknown token', async () => {
      redis.getdel.mockResolvedValue(null);

      await expect(service.cancel('old')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
