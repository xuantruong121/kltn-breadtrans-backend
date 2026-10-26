/**
 * Isolates the aggregate/per-skill disagreement in Entry Diagnostic scoring.
 *
 * A fully-correct submission reports correctCount=18/20 while the per-skill
 * profiles sum to 20 correct. This reads the stored attempt row and recomputes
 * every item with the same published predicate, so the two disagreeing paths
 * can be compared item by item.
 *
 * Read-only against content; QA learner deleted in finally.
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
import {
  getAttemptQuestionPermutation,
  getQuestionOptions,
  isDiagnosticAnswerCorrect,
  type DiagnosticQuestionForScoring,
} from '../../src/modules/diagnostic/diagnostic.logic';

const marker = makeMarker('diagagg');

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
  if (!value) throw new Error(`login failed ${String(response.status)}`);
  return value;
}

void (async () => {
  const ids: number[] = [];
  try {
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
    const learner = await createQaLearner(marker, 'FREE', '-agg');
    ids.push(learner.userId);
    const bearer = await token(learner);

    const answers: Record<string, string> = {};
    for (const question of assessment.questions) {
      const options = Array.isArray(question.options)
        ? (question.options as string[])
        : [];
      answers[String(question.id)] = options[question.correctIndex];
    }

    const response = await fetch(`${BE}/diagnostic/${assessment.id}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ answers }),
    });
    const payload = (await response.json()) as {
      data?: {
        correctCount?: number;
        totalCount?: number;
        percentage?: number;
      };
    };
    const reported = payload.data ?? {};

    const stored = await prisma.diagnosticAttempt.findFirstOrThrow({
      where: { userId: learner.userId },
      orderBy: { submittedAt: 'desc' },
    });

    console.log(
      `reported: correct=${String(reported.correctCount)}/${String(reported.totalCount)} percentage=${String(reported.percentage)}`,
    );
    console.log(
      `stored   : correct=${String(stored.correctCount)}/${String(stored.totalCount)} percentage=${String(stored.percentage)} level=${String(stored.level)}`,
    );

    // Recompute each item exactly as the published predicate would, both with
    // and without the per-attempt option permutation.
    const storedAnswers = (stored.answers ?? {}) as Record<string, unknown>;
    let correctWithPerm = 0;
    let correctWithoutPerm = 0;
    const disagreements: Array<Record<string, unknown>> = [];
    for (const question of assessment.questions) {
      const forScoring: DiagnosticQuestionForScoring = {
        id: question.id,
        skill: question.skill,
        question: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        order: question.order,
      };
      const answer = storedAnswers[String(question.id)];
      const perm = getAttemptQuestionPermutation(
        stored.id,
        question.id,
        getQuestionOptions(forScoring).length,
      );
      const withPerm = isDiagnosticAnswerCorrect(forScoring, answer, perm);
      const withoutPerm = isDiagnosticAnswerCorrect(forScoring, answer);
      if (withPerm) correctWithPerm += 1;
      if (withoutPerm) correctWithoutPerm += 1;
      if (withPerm !== withoutPerm) {
        disagreements.push({
          id: question.id,
          skill: question.skill,
          order: question.order,
          withPerm,
          withoutPerm,
          storedAnswer: answer,
          correctIndex: question.correctIndex,
          options: question.options,
        });
      }
    }

    console.log(
      `\nindependent recompute: withPermutation=${correctWithPerm}/20  withoutPermutation=${correctWithoutPerm}/20`,
    );
    console.log(`items where the two paths disagree: ${disagreements.length}`);
    for (const row of disagreements) {
      console.log(`  ${JSON.stringify(row)}`);
    }

    // Which answers were actually persisted? A dropped answer would explain it.
    const answeredKeys = Object.keys(storedAnswers).filter(
      (k) => !k.startsWith('__'),
    );
    const missing = assessment.questions
      .map((q) => String(q.id))
      .filter((id) => !answeredKeys.includes(id));
    console.log(
      `\npersisted answer keys=${answeredKeys.length} (metadata keys: ${
        Object.keys(storedAnswers)
          .filter((k) => k.startsWith('__'))
          .join(',') || 'none'
      })`,
    );
    console.log(
      `question ids with no persisted answer: ${missing.join(',') || 'none'}`,
    );
    for (const id of missing) {
      const q = assessment.questions.find((x) => String(x.id) === id);
      console.log(
        `  dropped id=${id} skill=${String(q?.skill)} order=${String(q?.order)} sent="${answers[id]}"`,
      );
    }

    await log('diagnostic-aggregate', marker, {
      test: 'aggregate-vs-perskill',
      reported,
      stored: {
        correctCount: stored.correctCount,
        totalCount: stored.totalCount,
        percentage: stored.percentage,
      },
      correctWithPerm,
      correctWithoutPerm,
      disagreements,
      droppedAnswerIds: missing,
    });
  } finally {
    for (const id of ids) await destroyQaLearner(id);
    console.log(
      `\nENTRY_DIAGNOSTIC_QA_ORPHAN_RECORDS=${await orphanCount(marker)}`,
    );
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
