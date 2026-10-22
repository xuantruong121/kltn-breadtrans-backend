import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, QuizType, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';

export type QuizContentAccessSubject = {
  id: number;
  type: QuizType;
  isPremiumContent: boolean;
  courseId: number | null;
};

export type QuizContentAccess = {
  isPremiumContent: boolean;
  isLocked: boolean;
  featureKey: PlanFeatureKey | null;
};

/**
 * Single policy boundary for commercial access to Quiz-backed skill content.
 * Premium Quiz content is governed only by the user's active plan entitlement.
 */
@Injectable()
export class QuizContentAccessService {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  featureForQuizType(type: QuizType): PlanFeatureKey | null {
    if (type === QuizType.BILINGUAL_READING) {
      return PlanFeatureKey.PREMIUM_READING;
    }
    if (type === QuizType.LISTENING_PRACTICE) {
      return PlanFeatureKey.PREMIUM_LISTENING;
    }
    if (type === QuizType.WRITING_PICTURE || type === QuizType.WRITING_EMAIL) {
      return PlanFeatureKey.PREMIUM_WRITING_CONTENT;
    }
    return null;
  }

  async resolve(
    quiz: QuizContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<QuizContentAccess> {
    const featureKey = this.featureForQuizType(quiz.type);
    if (!quiz.isPremiumContent || !featureKey || role === Role.ADMIN) {
      return {
        isPremiumContent: quiz.isPremiumContent,
        isLocked: false,
        featureKey,
      };
    }

    if (!userId) {
      return { isPremiumContent: true, isLocked: true, featureKey };
    }

    const entitled = await this.subscriptionService.hasFeature(
      userId,
      featureKey,
    );

    return {
      isPremiumContent: true,
      isLocked: !entitled,
      featureKey,
    };
  }

  async resolveMany(
    quizzes: QuizContentAccessSubject[],
    userId?: number,
    role?: Role,
  ): Promise<Map<number, QuizContentAccess>> {
    const result = new Map<number, QuizContentAccess>();
    const eligible = quizzes.filter(
      (quiz) =>
        quiz.isPremiumContent &&
        this.featureForQuizType(quiz.type) !== null &&
        role !== Role.ADMIN,
    );

    if (eligible.length === 0 || !userId) {
      for (const quiz of quizzes) {
        const featureKey = this.featureForQuizType(quiz.type);
        result.set(quiz.id, {
          isPremiumContent: quiz.isPremiumContent,
          isLocked: Boolean(
            quiz.isPremiumContent && featureKey && role !== Role.ADMIN,
          ),
          featureKey,
        });
      }
      return result;
    }

    const featureKeys = [
      ...new Set(
        eligible
          .map((quiz) => this.featureForQuizType(quiz.type))
          .filter((key): key is PlanFeatureKey => key !== null),
      ),
    ];
    const entitledFeatures = new Set<PlanFeatureKey>();
    for (const featureKey of featureKeys) {
      if (await this.subscriptionService.hasFeature(userId, featureKey)) {
        entitledFeatures.add(featureKey);
      }
    }

    for (const quiz of quizzes) {
      const featureKey = this.featureForQuizType(quiz.type);
      if (!quiz.isPremiumContent || !featureKey || role === Role.ADMIN) {
        result.set(quiz.id, {
          isPremiumContent: quiz.isPremiumContent,
          isLocked: false,
          featureKey,
        });
        continue;
      }
      result.set(quiz.id, {
        isPremiumContent: true,
        isLocked: !entitledFeatures.has(featureKey),
        featureKey,
      });
    }
    return result;
  }

  async assertAccess(
    quiz: QuizContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<void> {
    const access = await this.resolve(quiz, userId, role);
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
