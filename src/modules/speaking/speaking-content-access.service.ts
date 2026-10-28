import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  advancedPracticePlan,
  cefrSpan,
  type CefrRange,
  parseCefrRange,
  planSatisfies,
  type PracticePlan,
  requiredPracticePlan,
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
  /** Lowest plan that opens this exercise (FREE when it is not premium). */
  requiredPlan: PracticePlan;
  /** Authored CEFR level the plan was decided from ("A2", "B1-B2"). */
  cefrLevel: string | null;
};

/** Backend-authoritative access policy for Speaking exercise content. */
@Injectable()
export class SpeakingContentAccessService {
  readonly featureKey = PlanFeatureKey.PREMIUM_SPEAKING_CONTENT;

  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * Lowest plan for this exercise. Standalone practice follows the owner
   * matrix (A1/A2 free, B1+ PRO) from its practice set level, else from the
   * CEFR tag of its title. TOEIC exam tasks and untagged items keep their
   * stored flag, which then needs PRO.
   */
  requiredPlan(exercise: SpeakingContentAccessSubject): PracticePlan {
    const range = this.cefrRange(exercise);
    if (range) return requiredPracticePlan('SPEAKING', range);
    return exercise.isPremiumContent
      ? advancedPracticePlan('SPEAKING')
      : 'FREE';
  }

  /** Practice set level, else the title tag; null for TOEIC exam tasks. */
  cefrRange(exercise: SpeakingContentAccessSubject): CefrRange | null {
    if (exercise.practiceSet?.scope === 'EXAM_INTERNAL') return null;
    return (
      parseCefrRange(exercise.practiceSet?.level) ??
      parseCefrRange(exercise.title)
    );
  }

  isPremium(exercise: SpeakingContentAccessSubject): boolean {
    return this.requiredPlan(exercise) !== 'FREE';
  }

  private access(
    exercise: SpeakingContentAccessSubject,
    planCode: string | null,
    role?: Role,
  ): SpeakingContentAccess {
    const requiredPlan = this.requiredPlan(exercise);
    const premium = requiredPlan !== 'FREE';
    return {
      isPremiumContent: premium,
      isLocked:
        premium &&
        role !== Role.ADMIN &&
        !planSatisfies(planCode, requiredPlan),
      featureKey: this.featureKey,
      requiredPlan,
      cefrLevel: cefrSpan(this.cefrRange(exercise)),
    };
  }

  async resolve(
    exercise: SpeakingContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<SpeakingContentAccess> {
    const planCode =
      this.isPremium(exercise) && role !== Role.ADMIN && userId
        ? await this.subscriptionService.effectivePlanCode(userId)
        : null;
    return this.access(exercise, planCode, role);
  }

  async resolveMany(
    exercises: SpeakingContentAccessSubject[],
    userId?: number,
    role?: Role,
  ): Promise<Map<number, SpeakingContentAccess>> {
    const planCode =
      userId &&
      role !== Role.ADMIN &&
      exercises.some((exercise) => this.isPremium(exercise))
        ? await this.subscriptionService.effectivePlanCode(userId)
        : null;
    return new Map(
      exercises.map((exercise) => [
        exercise.id,
        this.access(exercise, planCode, role),
      ]),
    );
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
      message: `Bài luyện này yêu cầu gói ${access.requiredPlan}.`,
      error: {
        code: 'FEATURE_NOT_INCLUDED',
        featureKey: access.featureKey,
        requiredPlan: access.requiredPlan,
      },
    });
  }
}
