import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

/**
 * Refuses a change that would leave no admin: demoting or deleting the
 * account `userId` when it is the last one (audit A9, 2026-11-18). Every
 * such change takes one advisory lock, so two admins demoting each other at
 * the same moment cannot both pass the count. Runs in the caller's
 * transaction, before the write.
 */
export async function assertKeepsAnAdmin(
  tx: Pick<Prisma.TransactionClient, '$executeRaw' | 'user'>,
  userId: number,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-roster'))`;
  const others = await tx.user.count({
    where: { role: Role.ADMIN, id: { not: userId }, anonymizedAt: null },
  });
  if (others < 1)
    throw new BadRequestException(
      'Hệ thống phải còn ít nhất một Admin. Hãy cấp quyền Admin cho tài khoản khác trước.',
    );
}
