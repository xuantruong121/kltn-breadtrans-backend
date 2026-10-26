/**
 * TOEIC Listening & Reading practice test over HTTP, disposable harness only.
 * Expected counts come from the clone's keys; the conversion is the service's
 * documented linear rule (correct x 5, clamped to 5..495 per section).
 */
import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const scale = (correct: number) => Math.min(495, Math.max(5, correct * 5));

async function main() {
  console.log('\n== TOEIC L&R');
  const a = await newStudent('toeic-a');
  const b = await newStudent('toeic-b');
  const exams = await call('GET', '/toeic/exams', a.token);
  const exam = exams.data.find((e: any) => e.learnerReady);
  check('a learner-ready published exam is listed', !!exam, `(${exam?.id})`);
  check(
    'the listing states it is not an official ETS test',
    /không phải đề thi chính thức/i.test(exam?.description ?? ''),
  );

  const attempt = await call(
    'POST',
    `/toeic/exams/${exam.id}/attempts`,
    a.token,
    {},
  );
  check(
    'attempt created in PENDING_START',
    attempt.status < 300 && attempt.data.status === 'PENDING_START',
  );
  const id = attempt.data.id;
  const early = await call('PATCH', `/toeic/attempts/${id}/answers`, a.token, {
    answers: { 1: 0 },
  });
  check(
    'answers are refused before the attempt begins',
    early.status >= 400,
    `(status ${early.status})`,
  );
  const begin = await call('POST', `/toeic/attempts/${id}/begin`, a.token, {});
  check(
    'begin sets a server deadline',
    begin.status < 300 && !!begin.data.deadline,
  );

  const view = await call('GET', `/toeic/attempts/${id}`, a.token);
  const groups: any[] = view.data.exam.groups;
  const questions = groups.flatMap((g) =>
    g.questions.map((q: any) => ({ ...q, part: g.part })),
  );
  check(
    'the attempt serves 200 questions',
    questions.length === 200,
    `(${questions.length})`,
  );
  check(
    'no answer key or explanation is served during the test',
    !/"(correctIndex|explanation)"/.test(JSON.stringify(groups)),
  );

  const keys = new Map(
    harnessQuery(
      `select q.id, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = ${exam.id}`,
    ).map(([qid, k]) => [Number(qid), Number(k)]),
  );
  // Every third question right, the rest deliberately wrong.
  const answers: Record<string, number> = {};
  let lCorrect = 0;
  let rCorrect = 0;
  questions.forEach((q, i) => {
    const key = keys.get(q.id)!;
    const right = i % 3 === 0;
    answers[String(q.id)] = right ? key : (key + 1) % q.options.length;
    if (right) q.part <= 4 ? lCorrect++ : rCorrect++;
  });

  const foreignSave = await call(
    'PATCH',
    `/toeic/attempts/${id}/answers`,
    b.token,
    { answers },
  );
  check(
    'another learner cannot write into this attempt',
    foreignSave.status === 403 || foreignSave.status === 404,
    `(status ${foreignSave.status})`,
  );
  const bogus = await call('PATCH', `/toeic/attempts/${id}/answers`, a.token, {
    answers: { 999999: 0 },
  });
  check(
    'an answer for a question outside the exam is refused',
    bogus.status >= 400,
    `(status ${bogus.status})`,
  );
  const save = await call('PATCH', `/toeic/attempts/${id}/answers`, a.token, {
    answers,
  });
  check('answers saved', save.status < 300, `(status ${save.status})`);

  const foreignSubmit = await call(
    'POST',
    `/toeic/attempts/${id}/submit`,
    b.token,
    {},
  );
  check(
    'another learner cannot submit it',
    foreignSubmit.status === 403 || foreignSubmit.status === 404,
    `(status ${foreignSubmit.status})`,
  );
  const submit = await call(
    'POST',
    `/toeic/attempts/${id}/submit`,
    a.token,
    {},
  );
  check(
    'submission accepted',
    submit.status < 300 && submit.data.status === 'SUBMITTED',
  );
  check(
    'section counts equal the keys',
    submit.data.listeningCorrect === lCorrect &&
      submit.data.readingCorrect === rCorrect,
    `(api L${submit.data.listeningCorrect}/R${submit.data.readingCorrect}, expected L${lCorrect}/R${rCorrect})`,
  );
  check(
    'scaled scores follow the documented rule',
    submit.data.listeningScore === scale(lCorrect) &&
      submit.data.readingScore === scale(rCorrect) &&
      submit.data.totalScore === scale(lCorrect) + scale(rCorrect),
    `(${submit.data.listeningScore}+${submit.data.readingScore}=${submit.data.totalScore})`,
  );

  const again = await call('POST', `/toeic/attempts/${id}/submit`, a.token, {});
  const rows = harnessQuery(
    `select count(*) from "ToeicAttemptAnswer" where "attemptId" = ${id}`,
  )[0][0];
  check(
    'a second submit does not change the result',
    again.status >= 400 || again.data?.totalScore === submit.data.totalScore,
    `(status ${again.status})`,
  );
  check('one stored answer per question', rows === '200', `(${rows})`);
  const lateSave = await call(
    'PATCH',
    `/toeic/attempts/${id}/answers`,
    a.token,
    { answers: { [questions[0].id]: 0 } },
  );
  check(
    'answers cannot change after submission',
    lateSave.status >= 400,
    `(status ${lateSave.status})`,
  );

  const review = await call('GET', `/toeic/attempts/${id}/review`, a.token);
  check(
    'review is available to the owner after submission',
    review.status === 200,
  );
  const foreignReview = await call(
    'GET',
    `/toeic/attempts/${id}/review`,
    b.token,
  );
  check(
    'review is not available to another learner',
    foreignReview.status === 403 || foreignReview.status === 404,
    `(status ${foreignReview.status})`,
  );
  const history = await call('GET', '/toeic/history', a.token);
  const list: any[] = Array.isArray(history.data)
    ? history.data
    : (history.data?.items ?? []);
  check(
    'history lists the attempt',
    list.some((h) => h.id === id),
  );

  console.log(`\nTOEIC_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
