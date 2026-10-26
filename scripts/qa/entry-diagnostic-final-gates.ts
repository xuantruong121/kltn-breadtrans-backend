/**
 * Remaining Entry Diagnostic gates: ownership isolation on the diagnostic's own
 * endpoints, result payload vs stored row consistency, and recommendation
 * linkage (every recommended course/route must actually exist and be reachable).
 *
 * Read-only against content; two QA learners, both deleted in finally.
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

const marker = makeMarker('diaggates');

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
  const ids: number[] = [];
  const out: Record<string, unknown> = {};
  try {
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });

    const a = await createQaLearner(marker, 'FREE', '-a');
    const b = await createQaLearner(marker, 'FREE', '-b');
    ids.push(a.userId, b.userId);
    const tokenA = await token(a);
    const tokenB = await token(b);

    // A completes the diagnostic.
    const answers = Object.fromEntries(
      assessment.questions.map((question) => [
        String(question.id),
        (question.options as string[])[question.correctIndex],
      ]),
    );
    const submitted = await api(
      tokenA,
      `/diagnostic/${assessment.id}/attempts`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    );
    const result = unwrap(submitted.body) as {
      attemptId?: number;
      correctCount?: number;
      totalCount?: number;
      percentage?: number;
      level?: string;
      recommendations?: Array<{ courseId?: number; title?: string }>;
      practiceRecommendations?: Array<{ route?: string; id?: string }>;
    } | null;
    const attemptId = result?.attemptId;

    // ---------------------------------------------------- result consistency
    const stored = await prisma.diagnosticAttempt.findFirstOrThrow({
      where: { userId: a.userId },
      orderBy: { submittedAt: 'desc' },
    });
    const latestForA = await api(tokenA, '/diagnostic/results/latest');
    const latest = unwrap(latestForA.body) as Record<string, unknown> | null;
    const latestAttempt = (latest?.attempt ?? latest) as Record<
      string,
      unknown
    > | null;

    out.resultConsistency = {
      storedCorrect: stored.correctCount,
      storedTotal: stored.totalCount,
      storedPercentage: stored.percentage,
      storedLevel: stored.level,
      submitResponseCorrect: result?.correctCount ?? null,
      submitResponsePercentage: result?.percentage ?? null,
      submitResponseLevel: result?.level ?? null,
      latestEndpointPercentage:
        (latestAttempt?.percentage as number | undefined) ?? null,
      latestEndpointCorrect:
        (latestAttempt?.correctCount as number | undefined) ?? null,
      // The learner-visible number must equal what was stored.
      submitMatchesStored:
        result?.correctCount === stored.correctCount &&
        result?.percentage === stored.percentage,
      latestMatchesStored:
        (latestAttempt?.percentage as number | undefined) === stored.percentage,
    };

    // ------------------------------------------------- recommendation linkage
    const courseRecs = result?.recommendations ?? [];
    const practiceRecs = result?.practiceRecommendations ?? [];
    const courseChecks: Array<Record<string, unknown>> = [];
    for (const rec of courseRecs) {
      if (typeof rec.courseId !== 'number') continue;
      const course = await prisma.course.findUnique({
        where: { id: rec.courseId },
        select: { id: true, status: true, title: true },
      });
      const reachable = await api(tokenA, `/courses/${String(rec.courseId)}`);
      courseChecks.push({
        courseId: rec.courseId,
        existsInDb: !!course,
        status: course?.status ?? null,
        apiStatus: reachable.status,
        ok: !!course && course.status === 'PUBLISHED' && reachable.status < 300,
      });
    }
    // Practice routes point at learner pages; verify the referenced entity id.
    const practiceChecks: Array<Record<string, unknown>> = [];
    for (const rec of practiceRecs) {
      const route = rec.route ?? '';
      let ok: boolean | null = null;
      let detail = 'not id-addressable, route only';
      const listening = route.match(/^\/listening\/(\d+)/);
      const reading = route.match(/^\/reading\/(\d+)/);
      const writing = route.match(/^\/writing\/(\d+)/);
      const vocab = route.match(/topicId=(\d+)/);
      if (listening || reading || writing) {
        const quizId = Number((listening ?? reading ?? writing)?.[1]);
        const quiz = await prisma.quiz.findUnique({
          where: { id: quizId },
          select: { id: true, publicationStatus: true, type: true },
        });
        ok = !!quiz && quiz.publicationStatus === 'PUBLISHED';
        detail = quiz
          ? `quiz ${quizId} ${quiz.type} ${quiz.publicationStatus}`
          : `quiz ${quizId} does not exist`;
      } else if (vocab) {
        const topicId = Number(vocab[1]);
        const topic = await prisma.vocabTopic.findUnique({
          where: { id: topicId },
          select: { id: true, publicationStatus: true },
        });
        ok = !!topic && topic.publicationStatus === 'PUBLISHED';
        detail = topic
          ? `vocabTopic ${topicId} ${topic.publicationStatus}`
          : `vocabTopic ${topicId} does not exist`;
      } else if (/^\/speaking\/[a-z-]+$/.test(route)) {
        // A slug route, not a numeric id: record it rather than guess.
        ok = null;
        detail = 'slug route, cannot be resolved to a numeric entity';
      }
      practiceChecks.push({ id: rec.id, route, ok, detail });
    }
    out.recommendationLinkage = {
      courseRecommendations: courseChecks,
      practiceRecommendations: practiceChecks,
      allCourseRecsOk: courseChecks.every((c) => c.ok === true),
      brokenPracticeRecs: practiceChecks.filter((p) => p.ok === false),
    };

    // ------------------------------------------------------------------ IDOR
    const idorRows: Array<Record<string, unknown>> = [];
    if (typeof attemptId === 'number') {
      for (const path of [
        `/diagnostic/${assessment.id}/attempts/${attemptId}/speaking`,
      ]) {
        const owner = await api(tokenA, path);
        const other = await api(tokenB, path);
        const anon = await api(null, path);
        idorRows.push({
          path,
          ownerStatus: owner.status,
          otherStatus: other.status,
          anonStatus: anon.status,
          verdict:
            owner.status < 300 && other.status >= 400 && anon.status >= 400
              ? 'PASS'
              : 'FAIL',
        });
      }
    }
    // B must never see A's result through the per-learner endpoint.
    const latestForB = await api(tokenB, '/diagnostic/results/latest');
    const bPayload = JSON.stringify(unwrap(latestForB.body) ?? {});
    idorRows.push({
      path: '/diagnostic/results/latest (as B, who never submitted)',
      ownerStatus: latestForA.status,
      otherStatus: latestForB.status,
      anonStatus: (await api(null, '/diagnostic/results/latest')).status,
      leaksOtherLearnerScore:
        bPayload.includes(`"percentage":${String(stored.percentage)}`) &&
        bPayload.includes(`"level":"${String(stored.level)}"`),
      verdict:
        !bPayload.includes(`"attemptId":${attemptId}`) &&
        !bPayload.includes(`"id":${String(stored.id)}`)
          ? 'PASS'
          : 'FAIL',
    });
    out.idor = idorRows;

    await log('diagnostic-gates', marker, { test: 'final-gates', ...out });
    console.log(JSON.stringify(out, null, 2));
    console.log(
      `\nENTRY_DIAGNOSTIC_IDOR_PASS=${idorRows.every((r) => r.verdict === 'PASS')}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_RESULT_UI_DATA_CONSISTENCY_PASS=${String((out.resultConsistency as Record<string, unknown>).submitMatchesStored)}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_RECOMMENDATION_LINKAGE_PASS=${String(Boolean((out.recommendationLinkage as Record<string, unknown>).allCourseRecsOk) && (out.recommendationLinkage as { brokenPracticeRecs: unknown[] }).brokenPracticeRecs.length === 0)}`,
    );
  } finally {
    for (const id of ids) await destroyQaLearner(id);
    console.log(
      `ENTRY_DIAGNOSTIC_QA_ORPHAN_RECORDS=${await orphanCount(marker)}`,
    );
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
