import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';

export type SpeakingContentAccessSubject = {
  id: number;
  isPremiumContent: boolean;
};

export type SpeakingContentAccess = {
  isPremiumContent: boolean;
  isLocked: boolean;
  featureKey: PlanFeatureKey;
};

/** Backend-authoritative access policy for Speaking exercise content. */
@Injectable()
export class SpeakingContentAccessService {
  readonly featureKey = PlanFeatureKey.PREMIUM_SPEAKING_CONTENT;

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async resolve(
    exercise: SpeakingContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<SpeakingContentAccess> {
    if (!exercise.isPremiumContent || role === Role.ADMIN) {
      return {
        isPremiumContent: exercise.isPremiumContent,
        isLocked: false,
        featureKey: this.featureKey,
      };
    }
    if (!userId) {
      return {
        isPremiumContent: true,
        isLocked: true,
        featureKey: this.featureKey,
      };
    }
    const entitled = await this.subscriptionService.hasFeature(
      userId,
      this.featureKey,
    );
    return {
      isPremiumContent: true,
      isLocked: !entitled,
      featureKey: this.featureKey,
    };
  }

  async resolveMany(
    exercises: SpeakingContentAccessSubject[],
    userId?: number,
    role?: Role,
  ): Promise<Map<number, SpeakingContentAccess>> {
    const result = new Map<number, SpeakingContentAccess>();
    const hasPremium = exercises.some((exercise) => exercise.isPremiumContent);
    const entitled =
      hasPremium && userId && role !== Role.ADMIN
        ? await this.subscriptionService.hasFeature(userId, this.featureKey)
        : false;
    for (const exercise of exercises) {
      result.set(exercise.id, {
        isPremiumContent: exercise.isPremiumContent,
        isLocked: exercise.isPremiumContent && role !== Role.ADMIN && !entitled,
        featureKey: this.featureKey,
      });
    }
    return result;
  }

  async assertAccess(
    exercise: SpeakingContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<void> {
    const access = await this.resolve(exercise, userId, role);
    if (!access.isLocked) return;
    if (!userId) {
      throw new UnauthorizedException('Đăng nhập để truy cập nội dung này');
    }
    throw new ForbiddenException({
      statusCode: 403,
      message: 'Nội dung cao cấp yêu cầu quyền truy cập phù hợp',
      error: {
        code: 'FEATURE_NOT_INCLUDED',
        featureKey: access.featureKey,
      },
    });
  }
}
