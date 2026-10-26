/**
 * Listening and Reading practice workflows over HTTP, on the disposable
 * harness only. Expected scores are computed from the clone's answer keys,
 * independently of the API under test.
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const KEY_FIELDS =
  /"(correctIndex|correct|correctAnswer|answerKey|explanation)"/;

function expectedCorrect(questionId: number, answer: string): boolean {
  const [row] = harnessQuery(
    `select type::text, content::text from "Question" where id = ${questionId}`,
  );
  const content = JSON.parse(row[1]);
  if (Number.isInteger(content.correctIndex))
    return content.options?.[content.correctIndex] === answer;
  if (typeof content.correct === 'string') return content.correct === answer;
  return false;
}

function correctOption(questionId: number): string | null {
  const [row] = harnessQuery(
    `select content::text from "Question" where id = ${questionId}`,
  );
  const content = JSON.parse(row[0]);
  if (Number.isInteger(content.correctIndex))
    return content.options?.[content.correctIndex] ?? null;
  return typeof content.correct === 'string' ? content.correct : null;
}

/** First question answered with its key, the rest with a wrong option. */
function mixedAnswers(questions: any[]) {
  return questions.map((q, i) => {
    const options: string[] = Array.isArray(q.content?.options)
      ? q.content.options
      : [];
    const key = correctOption(q.id);
    const wrong = options.find((o) => o !== key) ?? 'wrong';
    return { questionId: q.id, answer: i === 0 && key ? key : wrong };
  });
}

async function listening() {
  console.log('\n== Listening practice');
  const a = await newStudent('listen-a');
  const b = await newStudent('listen-b');
  const list = await call('GET', '/quizzes/listening-practice', a.token);
  check(
    'catalog loads',
    list.status === 200 && list.data.length > 0,
    `(${list.data?.length})`,
  );
  const free = list.data.find((q: any) => !q.isLocked && !q.isPremiumContent);
  const premium = list.data.find((q: any) => q.isLocked);
  check('catalog marks locked premium items for a free learner', !!premium);

  const quiz = await call('GET', `/quizzes/${free.id}`, a.token);
  check('free quiz opens', quiz.status === 200, `(quiz ${free.id})`);
  check(
    'no answer key or explanation is sent before submission',
    !KEY_FIELDS.test(JSON.stringify(quiz.data.questions)),
  );

  if (premium) {
    const locked = await call('GET', `/quizzes/${premium.id}`, a.token);
    check(
      'a locked premium quiz is refused to a free learner',
      locked.status === 403 || locked.status === 402,
      `(status ${locked.status})`,
    );
  }

  const attempt = await call(
    'POST',
    `/quizzes/${free.id}/listening-attempts`,
    a.token,
  );
  check(
    'listening attempt starts',
    attempt.status < 300,
    `(status ${attempt.status})`,
  );
  const attemptId = attempt.data?.id ?? attempt.data?.attemptId;

  const questions: any[] = quiz.data.questions;
  const incomplete = await call('POST', `/quizzes/${free.id}/submit`, a.token, {
    answers: [{ questionId: questions[0].id, answer: 'x' }].slice(
      0,
      questions.length > 1 ? 1 : 0,
    ),
    attemptId,
  });
  check(
    'an incomplete submission is refused',
    incomplete.status === 400,
    `(status ${incomplete.status})`,
  );

  const duplicate = await call('POST', `/quizzes/${free.id}/submit`, a.token, {
    answers: questions.map(() => ({
      questionId: questions[0].id,
      answer: 'A',
    })),
    attemptId,
  });
  check(
    'a submission repeating one question is refused',
    duplicate.status === 400,
    `(status ${duplicate.status})`,
  );

  const answers = mixedAnswers(questions);
  const expected = answers.filter((x) =>
    expectedCorrect(x.questionId, x.answer),
  ).length;
  const submit = await call('POST', `/quizzes/${free.id}/submit`, a.token, {
    answers,
    attemptId,
  });
  check(
    'submission is accepted',
    submit.status < 300,
    `(status ${submit.status})`,
  );
  check(
    'score equals the count computed from the answer keys (expected > 0)',
    expected > 0 && submit.data?.score === expected,
    `(api ${submit.data?.score}, expected ${expected} of ${questions.length})`,
  );

  const again = await call('POST', `/quizzes/${free.id}/submit`, a.token, {
    answers,
    attemptId,
  });
  check(
    'the completed attempt cannot be submitted again',
    again.status === 403,
    `(status ${again.status})`,
  );

  const analytics = await call(
    'GET',
    `/quizzes/submissions/${submit.data.id}/analytics`,
    a.token,
  );
  check('owner can read the submission analytics', analytics.status === 200);
  const foreign = await call(
    'GET',
    `/quizzes/submissions/${submit.data.id}/analytics`,
    b.token,
  );
  check(
    'another learner cannot read it',
    foreign.status === 403 || foreign.status === 404,
    `(status ${foreign.status})`,
  );

  const toeic = harnessQuery(
    `select id from "Quiz" where type::text = 'TOEIC' limit 1`,
  )[0]?.[0];
  if (toeic) {
    const abuse = await call('POST', `/quizzes/${toeic}/submit`, a.token, {
      answers: Array.from({ length: 30 }, () => ({
        questionId: 1,
        answer: 'A',
      })),
    });
    check(
      'a TOEIC quiz cannot be scored through the practice submit endpoint',
      abuse.status >= 400,
      `(status ${abuse.status})`,
    );
  }
}

async function reading() {
  console.log('\n== Reading practice');
  const a = await newStudent('read-a');
  const rows = harnessQuery(
    `select id from "Quiz" where type::text = 'BILINGUAL_READING' and "isPremiumContent" = false and "publicationStatus"::text = 'PUBLISHED' order by id limit 1`,
  );
  const id = Number(rows[0]?.[0]);
  check(
    'a free published reading quiz exists in the clone',
    Number.isInteger(id),
    `(quiz ${id})`,
  );
  const quiz = await call('GET', `/quizzes/${id}`, a.token);
  check('reading quiz opens', quiz.status === 200);
  check(
    'no answer key or explanation is sent before submission',
    !KEY_FIELDS.test(JSON.stringify(quiz.data.questions)),
  );
  const questions: any[] = quiz.data.questions;
  const answers = questions.map((q) => ({
    questionId: q.id,
    answer: Array.isArray(q.content?.options) ? q.content.options[0] : 'A',
  }));
  const clientAttemptId = randomUUID();
  const first = await call('POST', `/quizzes/${id}/submit`, a.token, {
    answers,
    clientAttemptId,
  });
  check(
    'reading submission accepted',
    first.status < 300,
    `(status ${first.status} ${JSON.stringify(first.message)})`,
  );
  const replay = await call('POST', `/quizzes/${id}/submit`, a.token, {
    answers,
    clientAttemptId,
  });
  check(
    'a replay with the same attempt key returns the same submission',
    replay.status < 300 && replay.data?.id === first.data?.id,
    `(${first.data?.id} vs ${replay.data?.id})`,
  );
  const count = harnessQuery(
    `select count(*) from "Submission" s join "User" u on u.id = s."userId" where u.email = '${a.email}' and s."quizId" = ${id}`,
  )[0][0];
  check(
    'exactly one submission row exists after the replay',
    count === '1',
    `(${count})`,
  );
  const changed = await call('POST', `/quizzes/${id}/submit`, a.token, {
    answers: answers.map((x, i) => (i === 0 ? { ...x, answer: 'changed' } : x)),
    clientAttemptId,
  });
  check(
    'reusing an attempt key with different answers is refused',
    changed.status >= 400,
    `(status ${changed.status})`,
  );
}

async function main() {
  await listening();
  await reading();
  console.log(`\nPRACTICE_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
