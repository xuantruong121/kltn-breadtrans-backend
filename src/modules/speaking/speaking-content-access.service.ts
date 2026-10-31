import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, PracticeLevel, Role } from '@prisma/client';
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
import {
  LevelAccessService,
  type UnlockedLevels,
} from '../learning-path/level-access.service';
import { PRACTICE_LEVEL_LABEL } from '../learning-path/placement.logic';
import { UNPLACED_UNLOCKED } from '../learning-path/progression.logic';

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
  /** The item's internal practice level, when it has one. */
  practiceLevel: PracticeLevel | null;
  unlockedLevel: PracticeLevel;
  /** The learner has not opened this item's level. Plan is `isLocked`. */
  isLevelLocked: boolean;
};

/** Backend-authoritative access policy for Speaking exercise content. */
@Injectable()
export class SpeakingContentAccessService {
  readonly featureKey = PlanFeatureKey.PREMIUM_SPEAKING_CONTENT;

  constructor(
    private readonly subscriptionService: SubscriptionService,
    @Optional() private readonly levelAccess?: LevelAccessService,
  ) {}

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
    role: Role | undefined,
    unlocked: UnlockedLevels | null,
    exempt: boolean,
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
      ...this.levelOf(exercise, role, unlocked, exempt),
    };
  }

  private levelOf(
    exercise: SpeakingContentAccessSubject,
    role: Role | undefined,
    unlocked: UnlockedLevels | null,
    exempt: boolean,
  ) {
    if (!this.levelAccess || !unlocked)
      return {
        practiceLevel: null,
        unlockedLevel: UNPLACED_UNLOCKED,
        isLevelLocked: false,
      };
    const level = this.levelAccess.check(
      'SPEAKING',
      this.cefrRange(exercise),
      unlocked,
      role,
    );
    return exempt ? { ...level, isLevelLocked: false } : level;
  }

  /** Exercises the level lock would hold that a course keeps open. */
  private async levelExemptIds(
    exercises: SpeakingContentAccessSubject[],
    unlocked: UnlockedLevels | null,
    role?: Role,
  ) {
    if (!this.levelAccess || !unlocked) return new Set<number>();
    return this.levelAccess.exemptExerciseIds(
      exercises
        .filter((e) => this.levelOf(e, role, unlocked, false).isLevelLocked)
        .map((e) => e.id),
    );
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
    const unlocked = (await this.levelAccess?.unlockedLevels(userId)) ?? null;
    const exempt = await this.levelExemptIds([exercise], unlocked, role);
    return this.access(
      exercise,
      planCode,
      role,
      unlocked,
      exempt.has(exercise.id),
    );
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
    const unlocked = (await this.levelAccess?.unlockedLevels(userId)) ?? null;
    const exempt = await this.levelExemptIds(exercises, unlocked, role);
    return new Map(
      exercises.map((exercise) => [
        exercise.id,
        this.access(
          exercise,
          planCode,
          role,
          unlocked,
          exempt.has(exercise.id),
        ),
      ]),
    );
  }

  async assertAccess(
    exercise: SpeakingContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<void> {
    const access = await this.resolve(exercise, userId, role);
    if (access.isLevelLocked) {
      if (!userId)
        throw new UnauthorizedException('Đăng nhập để truy cập nội dung này');
      throw new ForbiddenException({
        statusCode: 403,
        message: `Bài luyện này thuộc mức ${PRACTICE_LEVEL_LABEL[access.practiceLevel!]}, bạn chưa mở mức này.`,
        error: {
          code: 'LEVEL_LOCKED',
          skill: 'SPEAKING',
          level: access.practiceLevel,
          unlockedLevel: access.unlockedLevel,
          ...(access.isLocked ? { requiredPlan: access.requiredPlan } : {}),
        },
      });
    }
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
