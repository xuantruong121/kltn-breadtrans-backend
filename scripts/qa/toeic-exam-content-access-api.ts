/**
 * TOEIC exam content access matrix on the disposable harness (:3101, clone
 * DB, mock providers). Synthetic learners only. Checks that exam content and
 * answer keys reach a learner only through their own attempt, that practice
 * routes still work, and that admins keep the authoring content.
 *
 * Usage: HARNESS_DB=<clone> npx ts-node --transpile-only scripts/qa/toeic-exam-content-access-api.ts
 */
import { call, check, failureCount, newAdmin, newStudent } from './harness-api';

const KEY = /"correctIndex"\s*:\s*\d|"explanation"\s*:\s*"[^"]/;
const QUESTION = /"options"\s*:\s*\[\s*"/;
const has = (data: unknown, re: RegExp) => re.test(JSON.stringify(data ?? ''));

async function main() {
  const a = await newStudent('toeic-a');
  const b = await newStudent('toeic-b');
  const admin = await newAdmin('toeic-admin');

  // Catalog: metadata only, for everyone.
  const list = await call('GET', '/exams');
  check(
    'A guest /exams 200, no answer key, no questions',
    list.status === 200 && !has(list.data, KEY) && !has(list.data, QUESTION),
    `status ${list.status}`,
  );
  check(
    'A guest /exams keeps catalog fields',
    Array.isArray(list.data) &&
      list.data.length > 0 &&
      list.data.every((p: any) => p.title && p.variantCode && 'runtimeId' in p),
  );
  const ids: number[] = (list.data ?? []).map((p: any) => p.id);
  for (const id of ids) {
    const d = await call('GET', `/exams/${id}`, a.token);
    check(
      `B learner /exams/${id} 200 without answer key or questions`,
      d.status === 200 && !has(d.data, KEY) && !has(d.data, QUESTION),
      `status ${d.status}`,
    );
  }
  const adminDetail = await call('GET', `/admin/exams/${ids[0]}`, admin.token);
  check(
    'M admin authoring detail keeps content',
    adminDetail.status === 200 &&
      (has(adminDetail.data, KEY) || ids.length === 0),
    `status ${adminDetail.status}`,
  );

  // Exam-internal Writing tasks through the generic quiz route.
  for (const q of [29, 34, 36]) {
    check(
      `A guest /quizzes/${q} refused`,
      (await call('GET', `/quizzes/${q}`)).status === 404,
    );
    check(
      `B learner /quizzes/${q} refused`,
      (await call('GET', `/quizzes/${q}`, a.token)).status === 404,
    );
    check(
      `M admin /quizzes/${q} allowed`,
      (await call('GET', `/quizzes/${q}`, admin.token)).status === 200,
    );
  }
  check(
    'B learner /writing/quizzes/29 without attempt refused',
    (await call('GET', '/writing/quizzes/29', a.token)).status === 404,
  );

  // Practice routes unchanged.
  check(
    'N practice Writing /quizzes/17 still served',
    (await call('GET', '/quizzes/17', a.token)).status === 200,
  );
  const mini = await call('GET', '/quizzes/8', a.token);
  check(
    'N practice TOEIC mini /quizzes/8 200 without keys',
    mini.status === 200 && !has(mini.data, KEY),
    `status ${mini.status}`,
  );
  check(
    'N practice Writing /writing/quizzes/17 still served',
    (await call('GET', '/writing/quizzes/17', a.token)).status === 200,
  );

  // L&R attempt lifecycle on exam set 1.
  const start = await call('POST', '/toeic/exams/1/attempts', a.token, {
    mode: 'PRACTICE',
    parts: [5],
  });
  check(
    'C learner can start an attempt',
    start.status < 300,
    `status ${start.status} ${JSON.stringify(start.message)}`,
  );
  const attemptId = start.data?.id ?? start.data?.attemptId;
  if (attemptId) {
    const pending = await call('GET', `/toeic/attempts/${attemptId}`, a.token);
    check(
      'C not-yet-begun attempt shows no answer key',
      pending.status < 300 && !has(pending.data, KEY),
      `status ${pending.status}`,
    );
    const begin = await call(
      'POST',
      `/toeic/attempts/${attemptId}/begin`,
      a.token,
    );
    check('D begin attempt', begin.status < 300, `status ${begin.status}`);
    const active = await call('GET', `/toeic/attempts/${attemptId}`, a.token);
    check(
      'D active attempt receives questions',
      active.status === 200 && has(active.data, QUESTION),
      `status ${active.status}`,
    );
    check('D active attempt receives no answer key', !has(active.data, KEY));
    const other = await call('GET', `/toeic/attempts/${attemptId}`, b.token);
    check(
      'H another learner cannot read the attempt',
      other.status === 403,
      `status ${other.status}`,
    );
    const submit = await call(
      'POST',
      `/toeic/attempts/${attemptId}/submit`,
      a.token,
      {},
    );
    check('G submit', submit.status < 300, `status ${submit.status}`);
    const review = await call('GET', `/toeic/attempts/${attemptId}`, a.token);
    check(
      'L owner can review the submitted attempt',
      review.status === 200,
      `status ${review.status}; key shown=${has(review.data, KEY)}`,
    );
    const otherReview = await call(
      'GET',
      `/toeic/attempts/${attemptId}`,
      b.token,
    );
    check(
      'H another learner cannot read the submitted attempt',
      otherReview.status === 403,
      `status ${otherReview.status}`,
    );
  }

  console.log(`TOEIC_EXAM_CONTENT_ACCESS_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
