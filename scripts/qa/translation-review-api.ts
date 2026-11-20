/**
 * Translation review inside the Writing CMS, over HTTP on the disposable
 * harness only (:3101), owner 2026-11-19/20. The clone has no AI-checked
 * translations, so synthetic checks are written to the harness database:
 * - summary.total equals the list's total, byQuiz equals each filtered list;
 * - approving one translation lowers the total and its exercise by 1.
 */
import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const DB = process.env.HARNESS_DB ?? 'dev_qa';

function seedCheck(
  userId: number,
  quizId: string,
  questionId: string,
  answer: string,
) {
  const feedback = JSON.stringify({
    rubricVersion: 'SENTENCE_TRANSLATION_V1',
    translation: {
      source: 'AI',
      verdict: 'CORRECT',
      answer,
      explanation: 'QA harness.',
    },
  });
  harnessExec(
    `with s as (
       insert into "Submission" ("quizId", "userId", "submittedAt", "aiFeedback")
       values (${quizId}, ${userId}, now(), $j$${feedback}$j$) returning id)
     insert into "Result" ("submissionId", "questionId", "answer")
     select id, ${questionId}, '{}'::jsonb from s`,
    DB,
  );
}

async function main() {
  console.log('\n== Translation review in the Writing CMS');
  const admin = await newAdmin('trv');
  const learner = await newStudent('trv-learner');

  const sentences = harnessQuery(
    `select distinct on (q."quizId") q."quizId", q.id from "Question" q
     where q.content->>'taskType' = 'SENTENCE_TRANSLATION'
     order by q."quizId", q.id limit 2`,
    DB,
  );
  if (sentences.length < 2) {
    console.log('NOT_RUN  fewer than two "Dịch câu" exercises in this clone');
    process.exit(0);
  }
  const [[quizA, questionA], [quizB, questionB]] = sentences;
  seedCheck(
    learner.userId,
    quizA,
    questionA,
    'The harness checks this first sentence today.',
  );
  seedCheck(
    learner.userId,
    quizA,
    questionA,
    'The harness checks this second sentence today.',
  );
  seedCheck(
    learner.userId,
    quizB,
    questionB,
    'The harness checks a sentence for another exercise.',
  );

  const summary = async () =>
    (await call('GET', '/admin/translation-answers/summary', admin.token))
      .data as {
      total: number;
      byQuiz: Record<string, number>;
    };
  const before = await summary();
  check(
    'summary counts the seeded translations',
    before.total >= 3 && before.byQuiz[quizA] >= 2 && before.byQuiz[quizB] >= 1,
    `(${JSON.stringify(before)})`,
  );

  const all = await call(
    'GET',
    '/admin/translation-answers?limit=100',
    admin.token,
  );
  check(
    'summary total equals the list total',
    all.data?.total === before.total,
    `(${all.data?.total} vs ${before.total})`,
  );

  const onlyA = await call(
    'GET',
    `/admin/translation-answers?limit=100&quizId=${quizA}`,
    admin.token,
  );
  const rowsA = (onlyA.data?.data ?? []) as Array<{
    quizId: number;
    questionId: number;
    answer: string;
  }>;
  check(
    'quizId keeps one exercise',
    rowsA.length > 0 && rowsA.every((row) => String(row.quizId) === quizA),
    `(${rowsA.length} rows)`,
  );
  check(
    'its count equals summary.byQuiz',
    onlyA.data?.total === before.byQuiz[quizA],
    `(${onlyA.data?.total} vs ${before.byQuiz[quizA]})`,
  );

  const approved = await call(
    'POST',
    '/admin/translation-answers/approve',
    admin.token,
    {
      questionId: rowsA[0].questionId,
      answer: rowsA[0].answer,
    },
  );
  check(
    'approving answers',
    approved.status < 300,
    `(status ${approved.status})`,
  );
  const after = await summary();
  check(
    'approving lowers the total by 1',
    after.total === before.total - 1,
    `(${before.total} -> ${after.total})`,
  );
  check(
    'and that exercise by 1',
    (after.byQuiz[quizA] ?? 0) === before.byQuiz[quizA] - 1,
    `(${before.byQuiz[quizA]} -> ${after.byQuiz[quizA] ?? 0})`,
  );

  const student = await call(
    'GET',
    '/admin/translation-answers/summary',
    learner.token,
  );
  check(
    'a learner cannot read the summary',
    student.status === 403,
    `(status ${student.status})`,
  );

  console.log(`\ntranslation-review failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
