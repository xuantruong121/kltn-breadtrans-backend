import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
});
