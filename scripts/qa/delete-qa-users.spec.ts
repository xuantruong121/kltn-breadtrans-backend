import { PrismaClient } from '@prisma/client';

import { describeWithIsolatedDatabase } from '../../test/safety/isolated';
import { deleteQaUsers } from './delete-qa-users';

/**
 * QA users that earned Bánh Mì or placed an order can no longer be removed
 * with user.delete (Restrict keys, soft-delete rule 2026-11-16). The helper
 * clears their rows first, and leaves every other user alone.
 */
describeWithIsolatedDatabase('deleteQaUsers (harness PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const qaEmail = (n: number) =>
    `qa-users-helper-${stamp}-${n}@breadtrans.local`;
  let bystanderId = 0;

  const makeUser = async (email: string, withRows: boolean) => {
    const user = await prisma.user.create({ data: { email } });
    if (withRows) {
      await prisma.banhTransaction.create({
        data: {
          userId: user.id,
          amount: 5,
          source: 'ADMIN_ADJUSTMENT',
          reference: `qa-users-helper-${stamp}-${user.id}`,
          dateKey: '2026-11-17',
          balanceAfter: 5,
        },
      });
      await prisma.marketOrder.create({
        data: {
          userId: user.id,
          studentName: 'QA',
          items: [],
          totalK: 1,
          totalBanh: 1,
        },
      });
    }
    return user.id;
  };

  beforeAll(async () => {
    await prisma.$connect();
    bystanderId = await makeUser(
      `qa-users-helper-${stamp}-bystander@breadtrans.local`,
      true,
    );
  });

  afterAll(async () => {
    // The bystander is junk of this spec too.
    await deleteQaUsers(prisma, { where: { id: bystanderId } });
    await prisma.$disconnect();
  });

  it('a plain user.delete is refused once the QA user has ledger rows', async () => {
    const id = await makeUser(qaEmail(1), true);
    await expect(prisma.user.delete({ where: { id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await deleteQaUsers(prisma, { where: { id } });
  });

  it('deletes the matching QA users with their ledger and orders', async () => {
    const a = await makeUser(qaEmail(2), true);
    const b = await makeUser(qaEmail(3), false);

    const result = await deleteQaUsers(prisma, {
      where: {
        email: { startsWith: `qa-users-helper-${stamp}-` },
        id: { in: [a, b] },
      },
    });

    expect(result.count).toBe(2);
    expect(await prisma.user.count({ where: { id: { in: [a, b] } } })).toBe(0);
    expect(await prisma.banhTransaction.count({ where: { userId: a } })).toBe(
      0,
    );
    expect(await prisma.marketOrder.count({ where: { userId: a } })).toBe(0);
  });

  it('leaves users outside the filter untouched', async () => {
    expect(await prisma.user.count({ where: { id: bystanderId } })).toBe(1);
    expect(
      await prisma.banhTransaction.count({ where: { userId: bystanderId } }),
    ).toBe(1);
    expect(
      await prisma.marketOrder.count({ where: { userId: bystanderId } }),
    ).toBe(1);
  });

  it('works inside a caller transaction and returns 0 for no match', async () => {
    const id = await makeUser(qaEmail(4), true);
    const result = await prisma.$transaction((tx) =>
      deleteQaUsers(tx, { where: { id } }),
    );
    expect(result.count).toBe(1);
    expect(
      (
        await deleteQaUsers(prisma, {
          where: { email: `none-${stamp}@breadtrans.local` },
        })
      ).count,
    ).toBe(0);
  });
});
