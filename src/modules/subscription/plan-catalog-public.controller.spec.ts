import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlanCatalogPublicController } from './plan-catalog-public.controller';

describe('PlanCatalogPublicController', () => {
  it('is public and delegates to the read-only catalog service', async () => {
    const getCatalog = jest.fn().mockResolvedValue({ plans: [] });
    const controller = new PlanCatalogPublicController({ getCatalog } as never);

    await expect(controller.getCatalog()).resolves.toEqual({ plans: [] });
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PlanCatalogPublicController),
    ).toBeUndefined();
  });
});
