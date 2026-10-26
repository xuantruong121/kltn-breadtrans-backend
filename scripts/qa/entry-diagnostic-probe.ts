/**
 * Focused probe: why does a fully-correct submission not score 100, and what
 * does the API actually say when answers are incomplete?
 *
 * Read-only against content; one QA learner, deleted in finally.
 */
import {
  BE,
  createQaLearner,
  destroyQaLearner,
  makeMarker,
  orphanCount,
  prisma,
  type QaLearner,
} from './global-audit-lib';

const marker = makeMarker('diagprobe');

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

void (async () => {
  const ids: number[] = [];
  try {
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });

    // What the learner is actually served (the form), vs what the DB holds.
    const learner = await createQaLearner(marker, 'FREE', '-a');
    ids.push(learner.userId);
    const bearer = await token(learner);
    const current = await api(bearer, '/diagnostic/current');
    const form = unwrap(current.body) as {
      questions?: Array<{ id: number; skill?: string; options?: unknown }>;
      totalQuestions?: number;
    } | null;
    console.log(
      `DB questions=${assessment.questions.length}  form questions=${String(form?.questions?.length ?? 'n/a')}  totalQuestions=${String(form?.totalQuestions ?? 'n/a')}`,
    );
    const dbIds = new Set(assessment.questions.map((q) => q.id));
    const formIds = new Set((form?.questions ?? []).map((q) => q.id));
    console.log(
      `in DB but not in form: ${[...dbIds].filter((id) => !formIds.has(id)).join(',') || 'none'}`,
    );
    console.log(
      `in form but not in DB: ${[...formIds].filter((id) => !dbIds.has(id)).join(',') || 'none'}`,
    );

    // Submit every correct answer by text and read back the per-item verdicts.
    const answers: Record<string, string> = {};
    for (const question of assessment.questions) {
      const options = Array.isArray(question.options)
        ? (question.options as string[])
        : [];
      answers[String(question.id)] = options[question.correctIndex];
    }
    const submitted = await api(
      bearer,
      `/diagnostic/${assessment.id}/attempts`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    );
    const result = unwrap(submitted.body) as {
      percentage?: number;
      correctCount?: number;
      totalCount?: number;
      level?: string;
      questions?: Array<{
        id: number;
        skill?: string;
        isCorrect?: boolean | null;
        question?: string;
      }>;
      skillProfiles?: unknown;
    } | null;
    console.log(
      `\nsubmitted all-correct -> status ${submitted.status} correct=${String(result?.correctCount)}/${String(result?.totalCount)} percentage=${String(result?.percentage)} level=${String(result?.level)}`,
    );
    const wrong = (result?.questions ?? []).filter(
      (item) => item.isCorrect !== true,
    );
    console.log(`items not marked correct: ${wrong.length}`);
    for (const item of wrong) {
      const dbQuestion = assessment.questions.find((q) => q.id === item.id);
      const options = Array.isArray(dbQuestion?.options)
        ? (dbQuestion?.options as string[])
        : [];
      console.log(
        `  id=${String(item.id)} skill=${String(item.skill ?? dbQuestion?.skill)} isCorrect=${String(item.isCorrect)}`,
      );
      console.log(`    prompt: ${(dbQuestion?.question ?? '').slice(0, 90)}`);
      console.log(
        `    correctIndex=${String(dbQuestion?.correctIndex)} sent="${answers[String(item.id)]}" options=${JSON.stringify(options)}`,
      );
    }
    console.log(`skillProfiles: ${JSON.stringify(result?.skillProfiles)}`);

    // Incomplete submissions: capture the exact refusal.
    const learnerB = await createQaLearner(marker, 'FREE', '-b');
    ids.push(learnerB.userId);
    const bearerB = await token(learnerB);
    for (const [label, payload] of [
      ['empty answers', {}],
      [
        'listening+reading only',
        Object.fromEntries(
          assessment.questions
            .filter((q) => q.skill === 'Listening' || q.skill === 'Reading')
            .map((q) => [
              String(q.id),
              (q.options as string[])[q.correctIndex],
            ]),
        ),
      ],
    ] as Array<[string, Record<string, unknown>]>) {
      const response = await api(
        bearerB,
        `/diagnostic/${assessment.id}/attempts`,
        { method: 'POST', body: JSON.stringify({ answers: payload }) },
      );
      console.log(
        `\n${label}: status ${String(response.status)} :: ${JSON.stringify(response.body).slice(0, 300)}`,
      );
    }
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
