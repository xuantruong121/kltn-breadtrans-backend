import { BadRequestException } from '@nestjs/common';
import { PromoCodeAdminService } from './promo-code-admin.service';

describe('PromoCodeAdminService.create', () => {
  const make = () => {
    const prisma = {
      promoCode: {
        create: jest.fn().mockResolvedValue({
          id: 1,
          code: 'TET',
          percentOff: 20,
          validFrom: null,
          validTo: null,
          planCodes: [],
          maxRedemptions: null,
          perUserOnce: true,
          source: 'ADMIN',
          user: null,
          active: true,
          note: null,
          redemptions: [],
          createdAt: new Date(),
        }),
      },
    };
    return { prisma, service: new PromoCodeAdminService(prisma as never) };
  };

  it('refuses an expiry date that has already passed', async () => {
    const { prisma, service } = make();
    await expect(
      service.create(
        {
          code: 'OLD1',
          percentOff: 10,
          validTo: new Date(Date.now() - 60_000).toISOString(),
        },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.promoCode.create).not.toHaveBeenCalled();
  });

  it('accepts an expiry date later today', async () => {
    const { prisma, service } = make();
    await service.create(
      {
        code: 'TODAY1',
        percentOff: 10,
        validTo: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      7,
    );
    expect(prisma.promoCode.create).toHaveBeenCalledTimes(1);
  });
});
