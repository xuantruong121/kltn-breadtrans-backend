import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  PlanFeatureKey,
  QuizType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
 * Course enrollment is checked before commercial entitlement so purchased
 * course access survives PLUS expiry.
 */
@Injectable()
export class QuizContentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

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

    const [courseAccess, entitled] = await Promise.all([
      this.hasCourseAccess(userId, quiz.courseId),
      this.subscriptionService.hasFeature(userId, featureKey),
    ]);

    return {
      isPremiumContent: true,
      isLocked: !(courseAccess || entitled),
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

    const courseIds = [
      ...new Set(
        eligible
          .map((quiz) => quiz.courseId)
          .filter((courseId): courseId is number => courseId !== null),
      ),
    ];
    const enrolledCourseIds = await this.getEnrolledCourseIds(
      userId,
      courseIds,
    );

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
      const isCourseAuthorized =
        quiz.courseId !== null && enrolledCourseIds.has(quiz.courseId);
      result.set(quiz.id, {
        isPremiumContent: true,
        isLocked: !(isCourseAuthorized || entitledFeatures.has(featureKey)),
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

  private async hasCourseAccess(
    userId: number,
    courseId: number | null,
  ): Promise<boolean> {
    if (courseId === null) return false;
    const enrolled = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
        class: { courseId },
      },
      select: { id: true },
    });
    return Boolean(enrolled);
  }

  private async getEnrolledCourseIds(
    userId: number,
    courseIds: number[],
  ): Promise<Set<number>> {
    if (courseIds.length === 0) return new Set();
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        userId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
        class: { courseId: { in: courseIds } },
      },
      select: { class: { select: { courseId: true } } },
    });
    return new Set(enrollments.map((enrollment) => enrollment.class.courseId));
  }
}
