/**
 * HTTP regression for Writing reference answers on the disposable harness
 * (:3101, deterministic grader, harness clone). Anonymous, FREE and PRO
 * learners must never receive `sampleResponse` / `sceneDescription` from the
 * quiz or analytics routes, while prompts, images and keywords stay; an
 * admin keeps the authoring content.
 *
 * Usage: HARNESS_DB=<clone> npx ts-node --transpile-only scripts/qa/writing-answer-leak-api.ts
 */
import { randomUUID } from 'node:crypto';

import {
  call,
  check,
  failureCount,
  newAdmin,
  newProStudent,
  newStudent,
} from './harness-api';

const HIDDEN = /sampleResponse|sceneDescription/;
const firstContent = (data: any) => data?.questions?.[0]?.content ?? {};

async function main() {
  const free = await newStudent('leak-free');
  const pro = await newProStudent('leak-pro');
  const admin = await newAdmin('leak-admin');

  for (const [who, token] of [
    ['anonymous', undefined],
    ['FREE', free.token],
    ['PRO', pro.token],
  ] as const) {
    for (const quiz of [3, 17, 45]) {
      const r = await call('GET', `/quizzes/${quiz}`, token);
      check(
        `${who} /quizzes/${quiz} 200 without reference data`,
        r.status === 200 && !HIDDEN.test(JSON.stringify(r.data)),
        `status ${r.status}`,
      );
      check(
        `${who} /quizzes/${quiz} keeps the prompt`,
        typeof firstContent(r.data).prompt === 'string',
      );
    }
  }
  const picture = await call('GET', '/quizzes/45', free.token);
  check(
    'picture task keeps image and cue words',
    !!firstContent(picture.data).imageUrl &&
      Array.isArray(firstContent(picture.data).requiredKeywords),
  );
  for (const quiz of [18, 46]) {
    const r = await call('GET', `/quizzes/${quiz}`, pro.token);
    check(
      `PRO premium /quizzes/${quiz} without reference data`,
      r.status === 200 && !HIDDEN.test(JSON.stringify(r.data)),
      `status ${r.status}`,
    );
    const f = await call('GET', `/quizzes/${quiz}`, free.token);
    check(
      `FREE premium /quizzes/${quiz} refused`,
      f.status === 403,
      `status ${f.status}`,
    );
  }

  const sub = await call('POST', '/writing/quizzes/17/submit', free.token, {
    answer:
      "Hi Lan, I'm sorry, but I'll be about fifteen minutes late for our study group because my bus is late. I should arrive at the library around 4:45. Please start without me and I'll join you soon.",
    clientAttemptId: randomUUID(),
    questionId: 81,
  });
  check(
    'FREE submission graded',
    sub.status < 300 && Number.isInteger(sub.data?.submissionId),
    `status ${sub.status}`,
  );
  const id = sub.data?.submissionId;
  const own = await call(
    'GET',
    `/quizzes/submissions/${id}/analytics`,
    free.token,
  );
  check(
    'own analytics without reference data',
    own.status === 200 && !HIDDEN.test(JSON.stringify(own.data)),
  );
  check(
    'own analytics keeps the answer and prompts',
    !!own.data?.submittedAnswer &&
      typeof firstContent(own.data).prompt === 'string',
  );
  const other = await call(
    'GET',
    `/quizzes/submissions/${id}/analytics`,
    pro.token,
  );
  check(
    'another learner cannot read the submission',
    other.status === 403,
    `status ${other.status}`,
  );
  const adm = await call('GET', '/quizzes/17', admin.token);
  check(
    'admin keeps authoring reference answers',
    adm.status === 200 && /sampleResponse/.test(JSON.stringify(adm.data)),
    `status ${adm.status}`,
  );

  console.log(`WRITING_ANSWER_LEAK_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
