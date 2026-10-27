import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  parseCefrRange,
  practiceRequiresPlus,
} from '../subscription/practice-level';

export type SpeakingContentAccessSubject = {
  id: number;
  isPremiumContent: boolean;
  /** Present on full rows; carries the authored CEFR tag. */
  title?: string;
  /** Present when the row was loaded with its practice set. */
  practiceSet?: { scope?: string | null; level?: string | null } | null;
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

  /**
   * Whether this exercise needs a plan. Standalone practice follows the owner
   * policy (A1/A2 free, B1+ PLUS) from its practice set level, else from the
   * CEFR tag of its title. TOEIC exam tasks and untagged items keep their
   * stored flag.
   */
  isPremium(exercise: SpeakingContentAccessSubject): boolean {
    if (exercise.practiceSet?.scope === 'EXAM_INTERNAL')
      return exercise.isPremiumContent;
    const range =
      parseCefrRange(exercise.practiceSet?.level) ??
      parseCefrRange(exercise.title);
    return range ? practiceRequiresPlus(range) : exercise.isPremiumContent;
  }

  async resolve(
    exercise: SpeakingContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<SpeakingContentAccess> {
    const premium = this.isPremium(exercise);
    if (!premium || role === Role.ADMIN) {
      return {
        isPremiumContent: premium,
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
    const hasPremium = exercises.some((exercise) => this.isPremium(exercise));
    const entitled =
      hasPremium && userId && role !== Role.ADMIN
        ? await this.subscriptionService.hasFeature(userId, this.featureKey)
        : false;
    for (const exercise of exercises) {
      const premium = this.isPremium(exercise);
      result.set(exercise.id, {
        isPremiumContent: premium,
        isLocked: premium && role !== Role.ADMIN && !entitled,
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
