import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePlanPriceDto } from './dto/plan-catalog-admin.dto';
import { PlanCatalogAdminController } from './plan-catalog-admin.controller';
import { PlanCatalogAdminService } from './plan-catalog-admin.service';
import { Role } from '@prisma/client';

describe('PlanCatalogAdminController', () => {
  it('is protected by JWT and ADMIN role guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PlanCatalogAdminController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata(ROLES_KEY, PlanCatalogAdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('passes authenticated admin attribution to mutations', async () => {
    const createDraft = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new PlanCatalogAdminController({
      createDraft,
    } as unknown as PlanCatalogAdminService);

    await controller.createDraft(
      'PLUS',
      { priceVnd: 1000, durationDays: 30 },
      { user: { id: 42 } },
    );

    expect(createDraft).toHaveBeenCalledWith(
      'PLUS',
      { priceVnd: 1000, durationDays: 30 },
      42,
    );
  });

  it('changes a price for the term in the path, attributed to the admin', async () => {
    const changePrice = jest.fn().mockResolvedValue({ id: 8 });
    const controller = new PlanCatalogAdminController({
      changePrice,
    } as unknown as PlanCatalogAdminService);

    await controller.changePrice(
      'PLUS',
      180,
      { priceVnd: 350000 },
      { user: { id: 42 } },
    );

    expect(changePrice).toHaveBeenCalledWith('PLUS', 180, 350000, 42);
  });

  it('accepts only a whole price from 1 to 100 million', async () => {
    const problems = async (priceVnd: unknown) =>
      (await validate(plainToInstance(ChangePlanPriceDto, { priceVnd })))
        .length;
    expect(await problems(350000)).toBe(0);
    expect(await problems('350000')).toBe(0); // a JSON string is read as a number
    expect(await problems(1)).toBe(0);
    expect(await problems(0)).toBeGreaterThan(0);
    expect(await problems(-5)).toBeGreaterThan(0);
    expect(await problems(1000.5)).toBeGreaterThan(0);
    expect(await problems(100_000_001)).toBeGreaterThan(0);
    expect(await problems(undefined)).toBeGreaterThan(0);
    expect(await problems('abc')).toBeGreaterThan(0);
  });
});
