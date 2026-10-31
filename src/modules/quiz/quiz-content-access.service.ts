import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PlanFeatureKey, PracticeLevel, QuizType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  advancedPracticePlan,
  cefrSpan,
  type CefrRange,
  isDictationContent,
  parseCefrRange,
  planSatisfies,
  type PracticePlan,
  type PracticeSkill,
  requiredPracticePlan,
} from '../subscription/practice-level';
import {
  LevelAccessService,
  type UnlockedLevels,
} from '../learning-path/level-access.service';
import { PRACTICE_LEVEL_LABEL } from '../learning-path/placement.logic';
import { UNPLACED_UNLOCKED } from '../learning-path/progression.logic';

export type QuizContentAccessSubject = {
  id: number;
  type: QuizType;
  isPremiumContent: boolean;
  courseId: number | null;
  /**
   * Carries the authored CEFR tag of practice items. resolve/resolveMany load
   * it when a caller did not select it, so the plan matrix holds on every
   * route, not only those that read the full row.
   */
  title?: string;
  /**
   * Listening practice keeps its mode here (DICTATION is paid from B1).
   * Loaded like `title`; a Listening item reaching requiredPlan without it
   * counts as dictation.
   */
  bilingualContent?: unknown;
};

export type QuizContentAccess = {
  isPremiumContent: boolean;
  isLocked: boolean;
  featureKey: PlanFeatureKey | null;
  /** Lowest plan that opens this item (FREE when it is not premium). */
  requiredPlan: PracticePlan;
  /** Authored CEFR level the plan was decided from ("B1", "B2-C1"). */
  cefrLevel: string | null;
  /** The item's internal practice level, when it has one. */
  practiceLevel: PracticeLevel | null;
  unlockedLevel: PracticeLevel;
  /** The learner has not opened this item's level. Plan is `isLocked`. */
  isLevelLocked: boolean;
};

/**
 * Single policy boundary for commercial access to Quiz-backed skill content.
 * The required plan comes from the skill and the authored CEFR level
 * (practice-level.ts); the user's plan in effect (expiry included) must reach
 * it. Stored per-version entitlements no longer decide it, so a plan bought
 * under an older policy follows the current one.
 */
@Injectable()
export class QuizContentAccessService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
    @Optional() private readonly levelAccess?: LevelAccessService,
  ) {}

  /** Fills the title and Listening mode of quizzes selected without them. */
  private async withPolicyFields<T extends QuizContentAccessSubject>(
    quizzes: T[],
  ): Promise<T[]> {
    const missing = quizzes.filter(
      (q) =>
        this.skillForQuizType(q.type) !== null &&
        (q.title === undefined ||
          (this.skillForQuizType(q.type) === 'LISTENING' &&
            q.bilingualContent === undefined)),
    );
    if (!missing.length) return quizzes;
    const rows = await this.prisma.quiz.findMany({
      where: { id: { in: missing.map((q) => q.id) } },
      select: { id: true, title: true, bilingualContent: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return quizzes.map((q) =>
      missing.includes(q)
        ? {
            ...q,
            title: q.title ?? byId.get(q.id)?.title,
            bilingualContent:
              q.bilingualContent !== undefined
                ? q.bilingualContent
                : (byId.get(q.id)?.bilingualContent ?? null),
          }
        : q,
    );
  }

  skillForQuizType(type: QuizType): PracticeSkill | null {
    if (type === QuizType.BILINGUAL_READING) return 'READING';
    if (type === QuizType.LISTENING_PRACTICE) return 'LISTENING';
    if (type === QuizType.WRITING_PICTURE || type === QuizType.WRITING_EMAIL)
      return 'WRITING';
    return null;
  }

  featureForQuizType(type: QuizType): PlanFeatureKey | null {
    const skill = this.skillForQuizType(type);
    if (skill === 'READING') return PlanFeatureKey.PREMIUM_READING;
    if (skill === 'LISTENING') return PlanFeatureKey.PREMIUM_LISTENING;
    if (skill === 'WRITING') return PlanFeatureKey.PREMIUM_WRITING_CONTENT;
    return null;
  }

  /**
   * Lowest plan for this quiz. Standalone practice with an authored CEFR tag
   * follows the owner matrix; other quizzes (courses, TOEIC sets, untagged
   * content) keep their stored flag, which then needs the skill's advanced
   * plan. An untagged item is never opened just because its tag is missing.
   */
  requiredPlan(quiz: QuizContentAccessSubject): PracticePlan {
    const skill = this.skillForQuizType(quiz.type);
    if (!skill) return 'FREE';
    const range = this.cefrRange(quiz);
    if (range)
      return requiredPracticePlan(skill, range, {
        dictation:
          skill === 'LISTENING' &&
          (quiz.bilingualContent === undefined ||
            isDictationContent(quiz.bilingualContent)),
      });
    return quiz.isPremiumContent ? advancedPracticePlan(skill) : 'FREE';
  }

  /** CEFR range of standalone skill practice; null for anything else. */
  cefrRange(quiz: QuizContentAccessSubject): CefrRange | null {
    if (!this.skillForQuizType(quiz.type) || quiz.courseId != null) return null;
    return parseCefrRange(quiz.title);
  }

  isPremium(quiz: QuizContentAccessSubject): boolean {
    return this.requiredPlan(quiz) !== 'FREE';
  }

  private access(
    quiz: QuizContentAccessSubject,
    planCode: string | null,
    role: Role | undefined,
    unlocked: UnlockedLevels | null,
    exempt: boolean,
  ): QuizContentAccess {
    const requiredPlan = this.requiredPlan(quiz);
    const featureKey = this.featureForQuizType(quiz.type);
    const premium = requiredPlan !== 'FREE';
    return {
      isPremiumContent: premium,
      isLocked:
        premium &&
        role !== Role.ADMIN &&
        !planSatisfies(planCode, requiredPlan),
      featureKey,
      requiredPlan,
      cefrLevel: cefrSpan(this.cefrRange(quiz)),
      ...this.levelOf(quiz, role, unlocked, exempt),
    };
  }

  private levelOf(
    quiz: QuizContentAccessSubject,
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
      this.skillForQuizType(quiz.type),
      this.cefrRange(quiz),
      unlocked,
      role,
    );
    return exempt ? { ...level, isLevelLocked: false } : level;
  }

  /** Quizzes the level lock would hold that an exam or course keeps open. */
  private async levelExemptIds(
    quizzes: QuizContentAccessSubject[],
    unlocked: UnlockedLevels | null,
    role?: Role,
  ) {
    if (!this.levelAccess || !unlocked) return new Set<number>();
    return this.levelAccess.exemptQuizIds(
      quizzes
        .filter((q) => this.levelOf(q, role, unlocked, false).isLevelLocked)
        .map((q) => q.id),
    );
  }

  async resolve(
    subject: QuizContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<QuizContentAccess> {
    const [quiz] = await this.withPolicyFields([subject]);
    const needsPlan = this.isPremium(quiz) && role !== Role.ADMIN && userId;
    const planCode = needsPlan
      ? await this.subscriptionService.effectivePlanCode(userId)
      : null;
    const unlocked = (await this.levelAccess?.unlockedLevels(userId)) ?? null;
    const exempt = await this.levelExemptIds([quiz], unlocked, role);
    return this.access(quiz, planCode, role, unlocked, exempt.has(quiz.id));
  }

  async resolveMany(
    subjects: QuizContentAccessSubject[],
    userId?: number,
    role?: Role,
  ): Promise<Map<number, QuizContentAccess>> {
    const quizzes = await this.withPolicyFields(subjects);
    const needsPlan =
      userId &&
      role !== Role.ADMIN &&
      quizzes.some((quiz) => this.isPremium(quiz));
    const planCode = needsPlan
      ? await this.subscriptionService.effectivePlanCode(userId)
      : null;
    const unlocked = (await this.levelAccess?.unlockedLevels(userId)) ?? null;
    const exempt = await this.levelExemptIds(quizzes, unlocked, role);
    return new Map(
      quizzes.map((quiz) => [
        quiz.id,
        this.access(quiz, planCode, role, unlocked, exempt.has(quiz.id)),
      ]),
    );
  }

  async assertAccess(
    quiz: QuizContentAccessSubject,
    userId?: number,
    role?: Role,
  ): Promise<void> {
    const access = await this.resolve(quiz, userId, role);
    if (access.isLevelLocked) {
      if (!userId)
        throw new UnauthorizedException('Đăng nhập để truy cập nội dung này');
      throw new ForbiddenException({
        statusCode: 403,
        message: `Bài luyện này thuộc mức ${PRACTICE_LEVEL_LABEL[access.practiceLevel!]}, bạn chưa mở mức này.`,
        error: {
          code: 'LEVEL_LOCKED',
          skill: this.skillForQuizType(quiz.type),
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
