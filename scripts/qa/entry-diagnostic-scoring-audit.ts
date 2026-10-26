/**
 * Entry Diagnostic scoring correctness: deterministic test vectors submitted
 * through the real API, compared against an INDEPENDENT recomputation.
 *
 * The service under test is never allowed to validate itself: the expected
 * values here are computed from the answer key read straight out of the
 * database, using a formula transcribed separately from the implementation.
 *
 * Also covers placement boundaries, unanswered behaviour, double-submit
 * idempotency, and pre-result privacy.
 *
 * Every attempt belongs to a QA learner that is deleted in the finally block.
 * No canonical content is modified.
 */
import {
  BE,
  createQaLearner,
  destroyQaLearner,
  log,
  makeMarker,
  orphanCount,
  prisma,
  type QaLearner,
} from './global-audit-lib';

const marker = makeMarker('diagscore');

/**
 * Independent transcription of the ACTIVE scoring contract, written from the
 * published behaviour rather than by calling the service:
 *   percentage = round(correct / objectiveCount * 100)
 *   level      = percentage >= 75 ? Intermediate
 *              : percentage >= 45 ? Foundation
 *              : Starter
 */
function expectedPercentage(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}
function expectedLevel(percentage: number): string {
  if (percentage >= 75) return 'Intermediate';
  if (percentage >= 45) return 'Foundation';
  return 'Starter';
}

async function token(learner: QaLearner): Promise<string> {
  const response = await fetch(`${BE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: learner.email, password: learner.password }),
  });
  const body = (await response.json()) as {
    data?: { access_token?: string; accessToken?: string };
  };
  const value = body.data?.access_token ?? body.data?.accessToken;
  if (!value) throw new Error(`login failed: ${String(response.status)}`);
  return value;
}

const api = async (bearer: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${BE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};
const unwrap = (payload: unknown) =>
  (payload as { data?: unknown })?.data ?? payload;

type Key = {
  id: number;
  skill: string;
  correctIndex: number;
  options: string[];
};

void (async () => {
  const learnerIds: number[] = [];
  const vectors: Array<Record<string, unknown>> = [];
  try {
    // --- answer key straight from the database (never from the API)
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
    const key: Key[] = assessment.questions.map((question) => ({
      id: question.id,
      skill: question.skill,
      correctIndex: question.correctIndex,
      options: Array.isArray(question.options)
        ? (question.options as string[])
        : [],
    }));
    const total = key.length;
    console.log(
      `assessment #${assessment.id} "${assessment.title}" objectiveItems=${total}`,
    );

    /**
     * Answers are sent as the correct option TEXT (or a deliberately wrong
     * text), which the implementation accepts and which is immune to the
     * per-attempt option shuffling.
     */
    const buildAnswers = (correctCount: number) => {
      const answers: Record<string, string> = {};
      key.forEach((item, index) => {
        if (index < correctCount) {
          answers[String(item.id)] = item.options[item.correctIndex];
        } else {
          const wrong = item.options.find(
            (_, optionIndex) => optionIndex !== item.correctIndex,
          );
          if (wrong) answers[String(item.id)] = wrong;
        }
      });
      return answers;
    };

    // --- test vectors: all-min, all-max, mixed, and every boundary
    const boundaryTargets = new Set<number>([0, total]);
    for (let correct = 0; correct <= total; correct += 1) {
      const percentage = expectedPercentage(correct, total);
      const previous = expectedPercentage(correct - 1, total);
      if (
        correct > 0 &&
        expectedLevel(percentage) !== expectedLevel(previous)
      ) {
        // the item count either side of each placement boundary
        boundaryTargets.add(correct - 1);
        boundaryTargets.add(correct);
      }
    }
    boundaryTargets.add(Math.floor(total / 2));
    const cases = [...boundaryTargets].sort((a, b) => a - b);

    for (const correctCount of cases) {
      const learner = await createQaLearner(
        marker,
        'FREE',
        `-c${correctCount}`,
      );
      learnerIds.push(learner.userId);
      const bearer = await token(learner);

      // Pre-result privacy: before submitting, nothing may expose the key.
      const before = await api(bearer, '/diagnostic/current');
      const beforeText = JSON.stringify(unwrap(before.body) ?? {});
      const leaksKey =
        /"correctIndex"/.test(beforeText) ||
        /"explanation"\s*:\s*"[^"]+"/.test(beforeText);
      const leaksResult =
        /"percentage"\s*:\s*\d/.test(beforeText) &&
        /"level"\s*:\s*"/.test(beforeText);

      const answers = buildAnswers(correctCount);
      const submitted = await api(
        bearer,
        `/diagnostic/${assessment.id}/attempts`,
        {
          method: 'POST',
          body: JSON.stringify({
            answers,
            submissionToken: `${marker}-c${correctCount}`,
          }),
        },
      );
      const result = unwrap(submitted.body) as {
        percentage?: number;
        level?: string;
        correctCount?: number;
        totalCount?: number;
      } | null;

      const expPercentage = expectedPercentage(correctCount, total);
      const expLevel = expectedLevel(expPercentage);
      const actualPercentage = result?.percentage ?? null;
      const actualLevel = result?.level ?? null;

      // Double submit with the same token must not create a second attempt.
      const resubmitted = await api(
        bearer,
        `/diagnostic/${assessment.id}/attempts`,
        {
          method: 'POST',
          body: JSON.stringify({
            answers,
            submissionToken: `${marker}-c${correctCount}`,
          }),
        },
      );
      const attemptRows = await prisma.diagnosticAttempt.count({
        where: { userId: learner.userId, status: 'COMPLETED' },
      });

      const row = {
        case: `correct=${correctCount}/${total}`,
        L: key.filter((k) => k.skill === 'Listening').length,
        R: key.filter((k) => k.skill === 'Reading').length,
        S: key.filter((k) => k.skill === 'Speaking').length,
        W: key.filter((k) => k.skill === 'Writing').length,
        expectedCorrect: correctCount,
        actualCorrect: result?.correctCount ?? null,
        expectedTotal: total,
        actualTotal: result?.totalCount ?? null,
        EXPECTED_SCORE: expPercentage,
        ACTUAL_SCORE: actualPercentage,
        DELTA:
          actualPercentage === null ? null : actualPercentage - expPercentage,
        EXPECTED_LEVEL: expLevel,
        ACTUAL_LEVEL: actualLevel,
        httpStatus: submitted.status,
        resubmitStatus: resubmitted.status,
        completedAttemptRows: attemptRows,
        preResultLeaksAnswerKey: leaksKey,
        preResultLeaksScore: leaksResult,
        PASS:
          submitted.status < 300 &&
          actualPercentage === expPercentage &&
          actualLevel === expLevel &&
          result?.correctCount === correctCount &&
          result?.totalCount === total &&
          attemptRows === 1 &&
          !leaksKey &&
          !leaksResult,
      };
      vectors.push(row);
      await log('diagnostic-scoring', marker, { test: 'score-vector', ...row });
      console.log(
        `  ${row.PASS ? 'PASS' : 'FAIL'} ${row.case.padEnd(12)} score ${String(row.ACTUAL_SCORE).padEnd(4)}(exp ${String(row.EXPECTED_SCORE).padEnd(4)}) level ${String(row.ACTUAL_LEVEL).padEnd(14)}(exp ${expLevel.padEnd(14)}) attempts=${attemptRows} leakKey=${leaksKey} leakScore=${leaksResult}`,
      );
    }

    // --- unanswered / missing-skill behaviour
    const learner = await createQaLearner(marker, 'FREE', '-empty');
    learnerIds.push(learner.userId);
    const bearer = await token(learner);
    const emptySubmit = await api(
      bearer,
      `/diagnostic/${assessment.id}/attempts`,
      { method: 'POST', body: JSON.stringify({ answers: {} }) },
    );
    const emptyResult = unwrap(emptySubmit.body) as {
      percentage?: number;
      level?: string;
      skillProfiles?: Array<{ skill: string; evidence?: string }>;
    } | null;
    const partialSubmit = await api(
      bearer,
      `/diagnostic/${assessment.id}/attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          // Listening + Reading only: Speaking/Writing deliberately absent.
          answers: Object.fromEntries(
            key
              .filter((k) => k.skill === 'Listening' || k.skill === 'Reading')
              .map((k) => [String(k.id), k.options[k.correctIndex]]),
          ),
        }),
      },
    );
    const partialResult = unwrap(partialSubmit.body) as {
      percentage?: number;
      level?: string;
      skillProfiles?: Array<{
        skill: string;
        evidence?: string;
        percentage?: number | null;
      }>;
    } | null;

    const missingSkill = {
      emptyAnswers: {
        status: emptySubmit.status,
        percentage: emptyResult?.percentage ?? null,
        level: emptyResult?.level ?? null,
        expectedPercentage: 0,
        expectedLevel: 'Starter',
        pass:
          emptySubmit.status < 300 &&
          emptyResult?.percentage === 0 &&
          emptyResult?.level === 'Starter',
      },
      listeningAndReadingOnly: {
        status: partialSubmit.status,
        percentage: partialResult?.percentage ?? null,
        level: partialResult?.level ?? null,
        expectedPercentage: expectedPercentage(
          key.filter((k) => k.skill === 'Listening' || k.skill === 'Reading')
            .length,
          total,
        ),
        skillProfiles: partialResult?.skillProfiles ?? null,
        // Speaking/Writing have 2 items each, below MIN_DOMAIN_EVIDENCE=3, so
        // they must report INSUFFICIENT evidence rather than a real score.
        speakingEvidence:
          partialResult?.skillProfiles?.find((p) => p.skill === 'Speaking')
            ?.evidence ?? null,
        writingEvidence:
          partialResult?.skillProfiles?.find((p) => p.skill === 'Writing')
            ?.evidence ?? null,
      },
    };
    await log('diagnostic-scoring', marker, {
      test: 'missing-skill',
      ...missingSkill,
    });
    console.log(
      `\nmissing-skill behaviour: ${JSON.stringify(missingSkill, null, 2)}`,
    );

    const allPass = vectors.every((v) => v.PASS);
    console.log(
      `\nENTRY_DIAGNOSTIC_FINAL_SCORE_RECOMPUTE_PASS=${allPass}\nENTRY_DIAGNOSTIC_PLACEMENT_BOUNDARY_PASS=${allPass}\nvectors=${vectors.length} pass=${vectors.filter((v) => v.PASS).length} fail=${vectors.filter((v) => !v.PASS).length}`,
    );
  } finally {
    for (const id of learnerIds) await destroyQaLearner(id);
    const orphans = await orphanCount(marker);
    console.log(`ENTRY_DIAGNOSTIC_QA_ORPHAN_RECORDS=${orphans}`);
    await log('diagnostic-scoring', marker, {
      test: 'cleanup',
      result: orphans === 0 ? 'PASS' : 'FAIL',
      orphanRecords: orphans,
    });
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
