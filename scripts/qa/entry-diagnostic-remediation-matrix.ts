/**
 * Post-remediation score evidence for the Entry Diagnostic.
 *
 * For every deterministic vector it compares four values that must agree:
 *   independent expectation (from the database answer key)
 *   the stored DiagnosticAttempt row
 *   the POST completion response
 *   the GET /diagnostic/results/latest response
 *
 * Also re-checks finalization idempotency, pre-result privacy, and that a
 * rename of the assessment title cannot change a learner's score.
 *
 * Canonical content is never modified: the title rename is applied to a QA-only
 * copy of the assessment, which is deleted with the QA learners.
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

const marker = makeMarker('diagremed');

/** Independent transcription of the contract; never calls the scorer. */
const expectedPercentage = (correct: number, total: number) =>
  total === 0 ? 0 : Math.round((correct / total) * 100);
const expectedLevel = (percentage: number) =>
  percentage >= 75
    ? 'Intermediate'
    : percentage >= 45
      ? 'Foundation'
      : 'Starter';

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
  if (!value) throw new Error(`login failed ${response.status}`);
  return value;
}

const api = async (bearer: string | null, path: string, init?: RequestInit) => {
  const response = await fetch(`${BE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
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

void (async () => {
  const learnerIds: number[] = [];
  let qaAssessmentId: number | undefined;
  const rows: Array<Record<string, unknown>> = [];
  try {
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
    const key = assessment.questions.map((question) => ({
      id: question.id,
      skill: question.skill,
      correctIndex: question.correctIndex,
      options: Array.isArray(question.options)
        ? (question.options as string[])
        : [],
    }));
    const total = key.length;

    /**
     * The two Speaking-labelled MCQs sit at the end of the form, so answering
     * the LAST n items correctly is what exercises the old defect.
     */
    const buildAnswers = (correct: number, fromEnd = false) => {
      const answers: Record<string, string> = {};
      key.forEach((item, index) => {
        const isCorrect = fromEnd ? index >= total - correct : index < correct;
        answers[String(item.id)] = isCorrect
          ? item.options[item.correctIndex]
          : (item.options.find((_, i) => i !== item.correctIndex) ?? '');
      });
      return answers;
    };

    const vectors: Array<{
      correct: number;
      fromEnd?: boolean;
      label: string;
    }> = [
      { correct: 0, label: '0/20 all-min' },
      { correct: 8, label: '8/20 boundary-' },
      { correct: 9, label: '9/20 boundary+' },
      { correct: 14, label: '14/20 boundary-' },
      { correct: 15, label: '15/20 boundary+' },
      { correct: 18, label: '18/20' },
      { correct: 19, label: '19/20' },
      { correct: 20, label: '20/20 all-max' },
      {
        correct: 2,
        fromEnd: true,
        label: '2/20 Speaking-labelled MCQs only',
      },
      { correct: 15, fromEnd: true, label: '15/20 including both Speaking' },
    ];

    console.log(
      'CASE                                EXP  DB   POST GET  | LEVEL exp/db/post/get                      | PASS',
    );
    for (const vector of vectors) {
      const learner = await createQaLearner(
        marker,
        'FREE',
        `-v${vector.correct}${vector.fromEnd ? 'e' : ''}`,
      );
      learnerIds.push(learner.userId);
      const bearer = await token(learner);

      // pre-result privacy, before anything is submitted
      const before = await api(bearer, '/diagnostic/current');
      const beforeText = JSON.stringify(unwrap(before.body) ?? {});
      const leaksKey =
        /"correctIndex"/.test(beforeText) ||
        /"explanation"\s*:\s*"[^"]+"/.test(beforeText);
      const leaksScore =
        /"percentage"\s*:\s*\d/.test(beforeText) &&
        /"level"\s*:\s*"/.test(beforeText);

      const answers = buildAnswers(vector.correct, vector.fromEnd);
      const submissionToken = `${marker}-${vector.correct}${vector.fromEnd ? 'e' : ''}`;
      const posted = await api(
        bearer,
        `/diagnostic/${assessment.id}/attempts`,
        { method: 'POST', body: JSON.stringify({ answers, submissionToken }) },
      );
      const postResult = unwrap(posted.body) as {
        correctCount?: number;
        totalCount?: number;
        percentage?: number;
        level?: string;
      } | null;

      // double submit with the same token must not create a second attempt
      await api(bearer, `/diagnostic/${assessment.id}/attempts`, {
        method: 'POST',
        body: JSON.stringify({ answers, submissionToken }),
      });

      const stored = await prisma.diagnosticAttempt.findFirstOrThrow({
        where: { userId: learner.userId },
        orderBy: { submittedAt: 'desc' },
      });
      const completedRows = await prisma.diagnosticAttempt.count({
        where: { userId: learner.userId, status: 'COMPLETED' },
      });

      // GET latest, twice, to catch drift between reads
      const got1 = await api(bearer, '/diagnostic/results/latest');
      const got2 = await api(bearer, '/diagnostic/results/latest');
      const g1 = unwrap(got1.body) as Record<string, unknown> | null;
      const g2 = unwrap(got2.body) as Record<string, unknown> | null;
      const getAttempt = (g1?.attempt ?? g1) as Record<string, unknown> | null;
      const getAttempt2 = (g2?.attempt ?? g2) as Record<string, unknown> | null;

      const expPercentage = expectedPercentage(vector.correct, total);
      const expLevel = expectedLevel(expPercentage);

      const row = {
        CASE: vector.label,
        EXPECTED_CORRECT: vector.correct,
        DB_CORRECT: stored.correctCount,
        POST_CORRECT: postResult?.correctCount ?? null,
        GET_CORRECT: (getAttempt?.correctCount as number | undefined) ?? null,
        EXPECTED_PERCENTAGE: expPercentage,
        DB_PERCENTAGE: stored.percentage,
        POST_PERCENTAGE: postResult?.percentage ?? null,
        GET_PERCENTAGE: (getAttempt?.percentage as number | undefined) ?? null,
        EXPECTED_LEVEL: expLevel,
        DB_LEVEL: stored.level,
        POST_LEVEL: postResult?.level ?? null,
        GET_LEVEL: (getAttempt?.level as string | undefined) ?? null,
        completedAttemptRows: completedRows,
        getStableAcrossReads:
          JSON.stringify(getAttempt) === JSON.stringify(getAttempt2),
        preResultLeaksKey: leaksKey,
        preResultLeaksScore: leaksScore,
        PASS: false,
      };
      row.PASS =
        posted.status < 300 &&
        row.DB_CORRECT === vector.correct &&
        row.POST_CORRECT === vector.correct &&
        row.GET_CORRECT === vector.correct &&
        row.DB_PERCENTAGE === expPercentage &&
        row.POST_PERCENTAGE === expPercentage &&
        row.GET_PERCENTAGE === expPercentage &&
        row.DB_LEVEL === expLevel &&
        row.POST_LEVEL === expLevel &&
        row.GET_LEVEL === expLevel &&
        completedRows === 1 &&
        row.getStableAcrossReads &&
        !leaksKey &&
        !leaksScore;

      rows.push(row);
      await log('diagnostic-remediation', marker, {
        test: 'score-matrix',
        ...row,
      });
      console.log(
        `${row.CASE.padEnd(35)} ${String(row.EXPECTED_PERCENTAGE).padEnd(4)} ${String(row.DB_PERCENTAGE).padEnd(4)} ${String(row.POST_PERCENTAGE).padEnd(4)} ${String(row.GET_PERCENTAGE).padEnd(4)} | ${String(row.EXPECTED_LEVEL).padEnd(12)}/${String(row.DB_LEVEL).padEnd(12)}/${String(row.POST_LEVEL).padEnd(12)}/${String(row.GET_LEVEL).padEnd(12)} | ${row.PASS ? 'PASS' : 'FAIL'}`,
      );
    }

    // ------------------------------------------------- title independence
    // A QA-owned copy of the form, renamed to contain "v2". Under the old
    // implementation this alone switched the scoring algorithm.
    const qaAssessment = await prisma.diagnosticAssessment.create({
      data: {
        title: `${marker} Diagnostic v2 renamed`,
        description: 'QA-owned copy for the rename regression',
        isActive: false,
        questions: {
          create: assessment.questions.map((question) => ({
            skill: question.skill,
            question: question.question,
            options: question.options ?? [],
            correctIndex: question.correctIndex,
            explanation: question.explanation,
            order: question.order,
          })),
        },
      },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
    qaAssessmentId = qaAssessment.id;

    const renameLearner = await createQaLearner(marker, 'FREE', '-rename');
    learnerIds.push(renameLearner.userId);
    const renameBearer = await token(renameLearner);
    const renameAnswers = Object.fromEntries(
      qaAssessment.questions.map((question) => [
        String(question.id),
        (question.options as string[])[question.correctIndex],
      ]),
    );
    const renamedSubmit = await api(
      renameBearer,
      `/diagnostic/${qaAssessment.id}/attempts`,
      { method: 'POST', body: JSON.stringify({ answers: renameAnswers }) },
    );
    const renamedResult = unwrap(renamedSubmit.body) as {
      percentage?: number;
      level?: string;
      correctCount?: number;
    } | null;
    const titleIndependent = {
      qaAssessmentTitle: qaAssessment.title,
      status: renamedSubmit.status,
      correctCount: renamedResult?.correctCount ?? null,
      percentage: renamedResult?.percentage ?? null,
      level: renamedResult?.level ?? null,
      expectedPercentage: 100,
      expectedLevel: 'Intermediate',
      // Under the old title heuristic this would have scored via the v2 path
      // and returned a CEFR band such as 'Pre-A1 – Cần củng cố nền tảng'.
      noCefrBandLeaked: !/A1|A2|B1|B2|Pre-A1/.test(renamedResult?.level ?? ''),
      PASS:
        renamedSubmit.status < 300 &&
        renamedResult?.percentage === 100 &&
        renamedResult?.level === 'Intermediate',
    };
    await log('diagnostic-remediation', marker, {
      test: 'title-independent-scoring',
      ...titleIndependent,
    });
    console.log(
      `\ntitle rename regression: ${JSON.stringify(titleIndependent, null, 2)}`,
    );

    const allPass = rows.every((r) => r.PASS);
    console.log(
      `\nvectors=${rows.length} pass=${rows.filter((r) => r.PASS).length} fail=${rows.filter((r) => !r.PASS).length}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_STORED_RESULT_CONSISTENCY_PASS=${rows.every((r) => r.DB_PERCENTAGE === r.EXPECTED_PERCENTAGE)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_POST_RESULT_CONSISTENCY_PASS=${rows.every((r) => r.POST_PERCENTAGE === r.EXPECTED_PERCENTAGE)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_GET_RESULT_CONSISTENCY_PASS=${rows.every((r) => r.GET_PERCENTAGE === r.EXPECTED_PERCENTAGE)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_FINALIZATION_IDEMPOTENCY_PASS=${rows.every((r) => r.completedAttemptRows === 1 && r.getStableAcrossReads)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_PRE_RESULT_PRIVACY_PASS=${rows.every((r) => !r.preResultLeaksKey && !r.preResultLeaksScore)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_TITLE_INDEPENDENT_SCORING_PASS=${titleIndependent.PASS}`,
    );
    console.log(`ENTRY_DIAGNOSTIC_P1_MATRIX_PASS=${allPass}`);
  } finally {
    for (const id of learnerIds) await destroyQaLearner(id);
    if (qaAssessmentId) {
      // QA-owned copy only; the canonical assessment is never touched.
      await prisma.diagnosticAssessment
        .delete({ where: { id: qaAssessmentId } })
        .catch(() => undefined);
    }
    const orphans = await orphanCount(marker);
    const orphanAssessments = await prisma.diagnosticAssessment.count({
      where: { title: { startsWith: marker } },
    });
    console.log(
      `ENTRY_DIAGNOSTIC_QA_ORPHAN_RECORDS=${orphans + orphanAssessments}`,
    );
    const canonical = await prisma.diagnosticAssessment.count();
    const canonicalQuestions = await prisma.diagnosticQuestion.count();
    console.log(
      `canonical after cleanup: assessments=${canonical} questions=${canonicalQuestions}`,
    );
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
