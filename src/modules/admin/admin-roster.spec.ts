import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccountPurgeService } from '../account/account-purge.service';
import { AuthSessionStore } from '../auth/session-store';
import { AdminService } from './admin.service';

/** The system keeps at least one admin (audit A9, 2026-11-18). */
describe('admin roster', () => {
  const makePrisma = (currentRole: Role, otherAdmins: number) => {
    const prisma: any = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      user: {
        findUnique: jest.fn((args: any) =>
          Promise.resolve(
            args.select?.role
              ? { role: currentRole }
              : { id: 5, role: Role.STUDENT },
          ),
        ),
        count: jest.fn().mockResolvedValue(otherAdmins),
        update: jest.fn().mockResolvedValue({}),
      },
      profile: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    return prisma;
  };
  const admin = (prisma: unknown, purge: unknown = {}) =>
    new AdminService(
      prisma as never,
      {} as never,
      {} as never,
      purge as never,
      { set: jest.fn(), smembers: jest.fn().mockResolvedValue([]) } as never,
    );

  afterEach(() => jest.restoreAllMocks());

  it('demoting the last admin is refused under the admin-roster lock, nothing written', async () => {
    const prisma = makePrisma(Role.ADMIN, 0);

    await expect(
      admin(prisma).updateUser(5, { role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.count.mock.invocationCallOrder[0],
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('demoting an admin while another remains goes through', async () => {
    const prisma = makePrisma(Role.ADMIN, 1);
    const revoke = jest
      .spyOn(AuthSessionStore.prototype, 'revokeAll')
      .mockResolvedValue(0);

    await admin(prisma).updateUser(5, { role: Role.STUDENT });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { role: Role.STUDENT },
    });
    expect(revoke).toHaveBeenCalledWith(5);
  });

  it('a name or phone edit that resends the same role writes no role and ends no session', async () => {
    const prisma = makePrisma(Role.STUDENT, 1);
    const revoke = jest
      .spyOn(AuthSessionStore.prototype, 'revokeAll')
      .mockResolvedValue(0);

    await admin(prisma).updateUser(5, {
      role: Role.STUDENT,
      fullName: 'Tên mới',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(prisma.profile.upsert).toHaveBeenCalled();
  });

  it('an admin cannot delete the account they are signed in with', async () => {
    const purge = { purgeUser: jest.fn() };

    await expect(
      admin(makePrisma(Role.ADMIN, 3), purge).deleteUser(5, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(purge.purgeUser).not.toHaveBeenCalled();
  });

  it('the purge refuses the last admin before touching anything', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 5,
          role: Role.ADMIN,
          anonymizedAt: null,
          deletionScheduledAt: null,
        },
      ]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      user: { count: jest.fn().mockResolvedValue(0) },
      toeicAssessmentSpeakingSubmission: { deleteMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const purge = new AccountPurgeService(
      prisma as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(purge, 'filesOf').mockResolvedValue([]);

    await expect(purge.purgeUser(5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(
      tx.toeicAssessmentSpeakingSubmission.deleteMany,
    ).not.toHaveBeenCalled();
  });
});
