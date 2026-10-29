/**
 * Resolves the learning resources D1 advice may cite against the live
 * catalog and the learner's plan. A reference is returned only when the
 * content exists and is published right now; one that is premium or a course
 * the learner's plan does not cover is returned as LOCKED with the existing
 * requirement, never silently opened. Nothing here enrols the learner.
 */
import { Injectable, Optional } from '@nestjs/common';
import { PlanFeatureKey, QuizType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  allAdviceResourceRefs,
  type ResolvedResource,
  type ResourceKind,
  type ResourceResolver,
} from './diagnostic-v2-advice';
import {
  advancedPracticePlan,
  parseCefrRange,
  planSatisfies,
  type PracticePlan,
  type PracticeSkill,
  requiredPracticePlan,
} from '../subscription/practice-level';

const QUIZ_KINDS: Partial<
  Record<
    ResourceKind,
    { types: QuizType[]; route: string; skill: PracticeSkill }
  >
> = {
  LISTENING_QUIZ: {
    types: [QuizType.LISTENING_PRACTICE],
    route: '/listening',
    skill: 'LISTENING',
  },
  READING_QUIZ: {
    types: [QuizType.BILINGUAL_READING],
    route: '/reading',
    skill: 'READING',
  },
  WRITING_QUIZ: {
    types: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE],
    route: '/writing',
    skill: 'WRITING',
  },
};

/** Same matrix as the content access services (practice-level.ts). */
function practicePlanFor(
  skill: PracticeSkill,
  title: string,
  isPremiumContent: boolean,
): PracticePlan {
  const range = parseCefrRange(title);
  if (range) return requiredPracticePlan(skill, range);
  return isPremiumContent ? advancedPracticePlan(skill) : 'FREE';
}
const COURSE_REQUIREMENT = 'Cần gói PRO';

@Injectable()
export class DiagnosticAdviceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly subscriptionService?: SubscriptionService,
  ) {}

  async resolverFor(userId: number): Promise<ResourceResolver> {
    const refs = allAdviceResourceRefs();
    const ids = (kind: ResourceKind) =>
      refs.filter((r) => r.kind === kind).map((r) => r.id);
    const quizIds = (
      ['LISTENING_QUIZ', 'READING_QUIZ', 'WRITING_QUIZ'] as const
    ).flatMap(ids);

    const [quizzes, exercises, courses] = await Promise.all([
      this.prisma.quiz.findMany({
        where: {
          id: { in: quizIds },
          publicationStatus: 'PUBLISHED',
          // A Writing task inside a TOEIC exam set answers 404 outside that
          // exam (assertExamInternalWritingAccess), so it is never a link.
          toeicWritingSetItems: {
            none: { writingSet: { assessmentComponents: { some: {} } } },
          },
        },
        select: { id: true, title: true, type: true, isPremiumContent: true },
      }),
      this.prisma.speakingExercise.findMany({
        where: {
          id: { in: ids('SPEAKING_EXERCISE') },
          publicationStatus: 'PUBLISHED',
          // Only exercises the learner-facing Speaking list serves.
          OR: [
            { practiceSetId: null },
            {
              practiceSet: {
                scope: 'SKILL_PRACTICE',
                publicationStatus: 'PUBLISHED',
              },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          isPremiumContent: true,
          practiceSetId: true,
          practiceSet: { select: { level: true } },
        },
      }),
      this.prisma.course.findMany({
        where: { id: { in: ids('COURSE') }, status: 'PUBLISHED' },
        select: { id: true, title: true },
      }),
    ]);

    const features = new Map<PlanFeatureKey, boolean>();
    const has = async (feature: PlanFeatureKey) => {
      if (!features.has(feature))
        features.set(
          feature,
          this.subscriptionService
            ? await this.subscriptionService.hasFeature(userId, feature)
            : false,
        );
      return features.get(feature) as boolean;
    };

    let code: string | null | undefined;
    const planCode = async () => {
      if (code === undefined)
        code = this.subscriptionService
          ? await this.subscriptionService.effectivePlanCode(userId)
          : null;
      return code;
    };

    const resolved = new Map<string, ResolvedResource>();
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`;
      const quizKind = QUIZ_KINDS[ref.kind];
      if (quizKind) {
        const quiz = quizzes.find(
          (q) => q.id === ref.id && quizKind.types.includes(q.type),
        );
        if (!quiz) continue;
        const required = practicePlanFor(
          quizKind.skill,
          quiz.title,
          quiz.isPremiumContent,
        );
        const locked =
          required !== 'FREE' && !planSatisfies(await planCode(), required);
        resolved.set(key, {
          ...ref,
          title: quiz.title,
          route: `${quizKind.route}/${quiz.id}`,
          access: locked ? 'LOCKED' : 'OPEN',
          requirement: locked ? `Cần gói ${required}` : null,
        });
      } else if (ref.kind === 'SPEAKING_EXERCISE') {
        const exercise = exercises.find((e) => e.id === ref.id);
        if (!exercise) continue;
        const required = practicePlanFor(
          'SPEAKING',
          exercise.title,
          exercise.isPremiumContent,
        );
        const locked =
          required !== 'FREE' && !planSatisfies(await planCode(), required);
        resolved.set(key, {
          ...ref,
          title: exercise.title,
          route: `/speaking/${exercise.id}`,
          setKey: exercise.practiceSetId,
          cefrLevel: exercise.practiceSet?.level ?? null,
          access: locked ? 'LOCKED' : 'OPEN',
          requirement: locked ? `Cần gói ${required}` : null,
        });
      } else if (ref.kind === 'COURSE') {
        const course = courses.find((c) => c.id === ref.id);
        if (!course) continue;
        const locked = !(await has(PlanFeatureKey.COURSE_LIBRARY_ACCESS));
        resolved.set(key, {
          ...ref,
          title: course.title,
          route: `/courses/${course.id}`,
          access: locked ? 'LOCKED' : 'OPEN',
          requirement: locked ? COURSE_REQUIREMENT : null,
        });
      }
    }
    return (ref) => resolved.get(`${ref.kind}:${ref.id}`) ?? null;
  }
}
