/**
 * Resolves the learning resources D1 advice may cite against the live
 * catalog, the learner's plan and the learner's opened practice levels. A
 * reference is returned only when the content exists and is published right
 * now; one the learner cannot open (plan or level) is returned as LOCKED with
 * the reason, never shown as open.
 */
import { Injectable, Optional } from '@nestjs/common';
import { QuizType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import { SpeakingContentAccessService } from '../speaking/speaking-content-access.service';
import { PRACTICE_LEVEL_LABEL } from '../learning-path/placement.logic';
import type { PracticeLevel } from '@prisma/client';
import {
  allAdviceResourceRefs,
  type NearLevelResolver,
  type ResolvedResource,
  type ResourceKind,
  type ResourceResolver,
} from './diagnostic-v2-advice';
import { LearningPathService } from '../learning-path/learning-path.service';
import {
  advancedPracticePlan,
  isDictationContent,
  parseCefrRange,
  planSatisfies,
  type PracticePlan,
  type PracticeSkill,
  requiredPracticePlan,
} from '../subscription/practice-level';
import { PLAN_LABEL, planCodeOf } from '../subscription/plan-limits';

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
  bilingualContent: unknown = null,
): PracticePlan {
  const range = parseCefrRange(title);
  if (range)
    return requiredPracticePlan(skill, range, {
      dictation: isDictationContent(bilingualContent),
    });
  return isPremiumContent ? advancedPracticePlan(skill) : 'FREE';
}

/**
 * The reason a learner cannot open an item, as the access services decide it:
 * an unopened level comes first, because the item page refuses it first.
 */
export function adviceLock(access: {
  isLocked: boolean;
  requiredPlan: string;
  isLevelLocked: boolean;
  practiceLevel: PracticeLevel | null;
}): {
  access: 'OPEN' | 'LOCKED';
  requirement: string | null;
  lockedBy: 'LEVEL' | 'PLAN' | null;
} {
  if (access.isLevelLocked && access.practiceLevel)
    return {
      access: 'LOCKED',
      requirement: `Cần mở mức ${PRACTICE_LEVEL_LABEL[access.practiceLevel]}`,
      lockedBy: 'LEVEL',
    };
  if (access.isLocked)
    return {
      access: 'LOCKED',
      requirement: `Cần gói ${PLAN_LABEL[planCodeOf(access.requiredPlan)]}`,
      lockedBy: 'PLAN',
    };
  return { access: 'OPEN', requirement: null, lockedBy: null };
}

const QUIZ_KIND_OF_SKILL: Record<string, ResourceKind> = {
  LISTENING: 'LISTENING_QUIZ',
  READING: 'READING_QUIZ',
  WRITING: 'WRITING_QUIZ',
};

/** A recommendation as an advice link (always OPEN: only open items come here). */
export function recommendationResource(r: {
  contentType: string;
  contentId: number;
  skill: string;
  title: string;
  route: string;
}): ResolvedResource | null {
  if (r.contentType === 'SPEAKING_SET') {
    const query = r.route.split('?')[1] ?? '';
    return {
      kind: 'SPEAKING_EXERCISE',
      id: r.contentId,
      title: r.title,
      route: r.route,
      access: 'OPEN',
      requirement: null,
      lockedBy: null,
      setKey: new URLSearchParams(query).get('set'),
      cefrLevel: null,
    };
  }
  const kind = QUIZ_KIND_OF_SKILL[r.skill];
  if (r.contentType !== 'QUIZ' || !kind) return null;
  return {
    kind,
    id: r.contentId,
    title: r.title,
    route: r.route,
    access: 'OPEN',
    requirement: null,
    lockedBy: null,
  };
}

@Injectable()
export class DiagnosticAdviceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly subscriptionService?: SubscriptionService,
    @Optional() private readonly quizAccess?: QuizContentAccessService,
    @Optional() private readonly speakingAccess?: SpeakingContentAccessService,
    @Optional() private readonly learningPath?: LearningPathService,
  ) {}

  /**
   * Open practice at the learner's own level, per skill, for advice areas
   * whose fixed references the learner cannot open yet. A failure here only
   * means no substitutes: the advice keeps its fixed references.
   */
  async nearLevelFor(userId: number): Promise<NearLevelResolver> {
    if (!this.learningPath) return () => [];
    try {
      const bySkill = await this.learningPath.openBySkill(userId, [
        'LISTENING',
        'READING',
        'SPEAKING',
        'WRITING',
      ]);
      return (skill, kinds) =>
        (bySkill.get(skill as 'LISTENING') ?? [])
          .filter(
            (r) => !kinds?.length || r.kinds.some((k) => kinds.includes(k)),
          )
          .map(recommendationResource)
          .filter((r): r is ResolvedResource => r !== null);
    } catch {
      return () => [];
    }
  }

  async resolverFor(userId: number): Promise<ResourceResolver> {
    const refs = allAdviceResourceRefs();
    const ids = (kind: ResourceKind) =>
      refs.filter((r) => r.kind === kind).map((r) => r.id);
    const quizIds = (
      ['LISTENING_QUIZ', 'READING_QUIZ', 'WRITING_QUIZ'] as const
    ).flatMap(ids);

    const [quizzes, exercises] = await Promise.all([
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
        select: {
          id: true,
          title: true,
          type: true,
          isPremiumContent: true,
          bilingualContent: true,
        },
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
          practiceSet: { select: { level: true, scope: true } },
        },
      }),
    ]);
    // The same decision the item pages make: plan and opened level.
    const [quizAccess, speakingAccess] = await Promise.all([
      this.quizAccess?.resolveMany(quizzes, userId),
      this.speakingAccess?.resolveMany(exercises, userId),
    ]);

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
        const decided = quizAccess?.get(quiz.id);
        let lock: ReturnType<typeof adviceLock>;
        if (decided) lock = adviceLock(decided);
        else {
          const required = practicePlanFor(
            quizKind.skill,
            quiz.title,
            quiz.isPremiumContent,
            quiz.bilingualContent,
          );
          const locked =
            required !== 'FREE' && !planSatisfies(await planCode(), required);
          lock = {
            access: locked ? 'LOCKED' : 'OPEN',
            requirement: locked
              ? `Cần gói ${PLAN_LABEL[planCodeOf(required)]}`
              : null,
            lockedBy: locked ? 'PLAN' : null,
          };
        }
        resolved.set(key, {
          ...ref,
          title: quiz.title,
          route: `${quizKind.route}/${quiz.id}`,
          ...lock,
        });
      } else if (ref.kind === 'SPEAKING_EXERCISE') {
        const exercise = exercises.find((e) => e.id === ref.id);
        if (!exercise) continue;
        const decided = speakingAccess?.get(exercise.id);
        let lock: ReturnType<typeof adviceLock>;
        if (decided) lock = adviceLock(decided);
        else {
          const required = practicePlanFor(
            'SPEAKING',
            exercise.title,
            exercise.isPremiumContent,
          );
          const locked =
            required !== 'FREE' && !planSatisfies(await planCode(), required);
          lock = {
            access: locked ? 'LOCKED' : 'OPEN',
            requirement: locked
              ? `Cần gói ${PLAN_LABEL[planCodeOf(required)]}`
              : null,
            lockedBy: locked ? 'PLAN' : null,
          };
        }
        resolved.set(key, {
          ...ref,
          title: exercise.title,
          route: `/speaking/${exercise.id}`,
          setKey: exercise.practiceSetId,
          cefrLevel: exercise.practiceSet?.level ?? null,
          ...lock,
        });
      }
    }
    return (ref) => resolved.get(`${ref.kind}:${ref.id}`) ?? null;
  }
}
