import { UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import { SpeakingContentAccessService } from './speaking-content-access.service';

describe('SpeakingContentAccessService', () => {
  const subscription = { hasFeature: jest.fn() };
  let service: SpeakingContentAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscription.hasFeature.mockResolvedValue(false);
    service = new SpeakingContentAccessService(
      subscription as unknown as SubscriptionService,
    );
  });

  const premium = { id: 1, isPremiumContent: true };

  it('keeps existing free content accessible without entitlement', async () => {
    await expect(
      service.assertAccess({ id: 2, isPremiumContent: false }, 7),
    ).resolves.toBeUndefined();
    expect(subscription.hasFeature).not.toHaveBeenCalled();
  });

  it('returns locked metadata without leaking content entitlement', async () => {
    await expect(service.resolve(premium, 7)).resolves.toMatchObject({
      isPremiumContent: true,
      isLocked: true,
      featureKey: PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
    });
  });

  it('rejects guests and non-entitled users with the commercial error contract', async () => {
    await expect(service.assertAccess(premium)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.assertAccess(premium, 7)).rejects.toMatchObject({
      response: {
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
        },
      },
    });
  });

  it('requires the exact content feature and not a generic paid plan', async () => {
    subscription.hasFeature.mockResolvedValue(true);
    await expect(service.assertAccess(premium, 7)).resolves.toBeUndefined();
    expect(subscription.hasFeature).toHaveBeenCalledWith(
      7,
      PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
    );
  });

  it('allows Admin preview without commercial entitlement', async () => {
    await expect(
      service.assertAccess(premium, 1, Role.ADMIN),
    ).resolves.toBeUndefined();
    expect(subscription.hasFeature).not.toHaveBeenCalled();
  });

  it('checks a list once and marks each premium item consistently', async () => {
    const result = await service.resolveMany(
      [
        premium,
        { id: 2, isPremiumContent: true },
        { id: 3, isPremiumContent: false },
      ],
      7,
    );
    expect(subscription.hasFeature).toHaveBeenCalledTimes(1);
    expect(result.get(1)?.isLocked).toBe(true);
    expect(result.get(2)?.isLocked).toBe(true);
    expect(result.get(3)?.isLocked).toBe(false);
  });
});
