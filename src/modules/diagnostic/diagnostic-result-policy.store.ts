/**
 * Reads an attempt's persisted result policy (the `__resultPolicy` marker in
 * its answers, see diagnostic-observed-policy) for the grading services.
 */
import type { PrismaClient } from '@prisma/client';

import {
  OBSERVED_RESULT_POLICY,
  readResultPolicy,
  RUBRIC_CRITERION_WEIGHTS,
} from './diagnostic-observed-policy';
import { FOUR_SKILL_SCORING_VERSION } from './diagnostic-four-skill';
import type {
  RubricScoringOptions,
  ValidatedRubricGrade,
} from './diagnostic-productive';

/**
 * Weighted rubric scoring for FOUR_SKILL_OBSERVED_V3 attempts only.
 *
 * Speaking is graded when a recording is confirmed, before submission
 * writes the marker. Submission marks every FOUR_SKILL_PLACEMENT_V2 attempt
 * V3, so an attempt still IN_PROGRESS under that pinned version is graded
 * as V3 already. A completed attempt without the marker is historical and
 * keeps the plain mean, also on a retry.
 */
export async function rubricScoringFor(
  prisma: Pick<PrismaClient, 'diagnosticAttempt'>,
  attemptId: number,
): Promise<RubricScoringOptions | undefined> {
  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    select: { answers: true, status: true, scoringVersion: true },
  });
  if (!attempt) return undefined;
  const v3 =
    readResultPolicy(attempt.answers) === OBSERVED_RESULT_POLICY ||
    (attempt.status === 'IN_PROGRESS' &&
      attempt.scoringVersion === FOUR_SKILL_SCORING_VERSION);
  return v3 ? { weighted: true } : undefined;
}

/**
 * What a learner sees of a graded task's weighting: the criterion weights
 * and which criteria could not be assessed. Read from the task's stored
 * metadata only; a task graded before weighting existed gets nulls.
 */
export function taskWeightingView(
  skill: 'SPEAKING' | 'WRITING',
  graded: boolean,
  meta: Record<string, unknown>,
) {
  const version =
    graded && typeof meta.weightingVersion === 'string'
      ? meta.weightingVersion
      : null;
  const unavailable =
    version && Array.isArray(meta.unavailableCriteria)
      ? meta.unavailableCriteria.filter(
          (key): key is string => typeof key === 'string',
        )
      : [];
  return {
    weightingVersion: version,
    criterionWeights: version ? RUBRIC_CRITERION_WEIGHTS[skill] : null,
    unavailableCriteria: unavailable,
    limitedEvidence: unavailable.length > 0,
  };
}

/** The weighting facts stored with a graded task (absent for older attempts). */
export function weightingMetadata(grade: ValidatedRubricGrade) {
  return grade.weightingVersion
    ? {
        weightingVersion: grade.weightingVersion,
        unavailableCriteria: grade.unavailableCriteria ?? [],
        assessedWeight: grade.assessedWeight ?? 1,
        limitedEvidence: (grade.unavailableCriteria ?? []).length > 0,
      }
    : {};
}
