import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionController } from './subscription.controller';

describe('SubscriptionController', () => {
  it('requires JWT authentication and resolves only the authenticated user', async () => {
    const resolveEffectivePlan = jest.fn().mockResolvedValue({ code: 'FREE' });
    const controller = new SubscriptionController({
      resolveEffectivePlan,
    } as never);

    await controller.getMyEffectivePlan({ user: { id: 42 } });

    expect(resolveEffectivePlan).toHaveBeenCalledWith(42);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SubscriptionController),
    ).toContain(JwtAuthGuard);
  });
});
