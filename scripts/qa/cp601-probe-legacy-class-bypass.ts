/**
 * CP60.1 probe (harness only): does a legacy class Enrollment let a learner
 * without PRO read course lesson content, and what do the legacy classroom
 * routes still answer?
 *
 * Run: npx ts-node --transpile-only scripts/qa/cp601-probe-legacy-class-bypass.ts
 */
import { call, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

void (async () => {
  const free = await newStudent('cp601-legacy');
  const [classId, courseId] = harnessQuery(
    `select id, "courseId" from "Class" order by id limit 1`,
  )[0].map(Number);
  harnessExec(
    `insert into "Enrollment" ("userId","classId","status","progress","joinedAt") values (${free.userId}, ${classId}, 'ACTIVE', 0, now())`,
  );
  const plan = await call('GET', '/subscriptions/me', free.token);
  console.log(
    'plan:',
    JSON.stringify(plan.data?.planCode ?? plan.data?.plan?.code ?? plan.status),
  );

  const learning = await call(
    'GET',
    `/courses/${courseId}/learning`,
    free.token,
  );
  console.log(`GET /courses/${courseId}/learning (PRO gate):`, learning.status);

  const cls = await call('GET', `/classes/${classId}`, free.token);
  const lessons = cls.data?.course?.lessons ?? [];
  const urls = lessons
    .flatMap((l: any) => [
      l.videoUrl,
      ...(l.materials ?? []).map((m: any) => m.fileUrl),
    ])
    .filter(Boolean);
  console.log(
    `GET /classes/${classId}:`,
    cls.status,
    'lessons',
    lessons.length,
    'media urls',
    urls.length,
    urls.slice(0, 2),
  );
  console.log('  assignments', (cls.data?.assignments ?? []).length);

  const list = await call('GET', '/courses', free.token);
  const listUrls =
    JSON.stringify(list.data ?? []).match(/"videoUrl":"[^"]+"/g) ?? [];
  console.log(
    'GET /courses (STUDENT branch):',
    list.status,
    'rows',
    (list.data ?? []).length,
    'videoUrls',
    listUrls.length,
    'tuition field',
    JSON.stringify(list.data ?? []).includes('tuitionFeeVnd'),
  );

  for (const [m, p, body] of [
    ['GET', '/classes', undefined],
    ['GET', '/classes/my-classes', undefined],
    ['GET', '/classes/watch-tracking', undefined],
    [
      'PATCH',
      '/classes/watch-tracking',
      { classId, videoKey: 'cp601', played: 0.5 },
    ],
    ['GET', `/courses/classes/${classId}/assignments`, undefined],
    ['GET', '/payments/me', undefined],
    ['POST', `/courses/classes/${classId}/enroll`, undefined],
  ] as const) {
    const r = await call(m, p, free.token, body as any);
    console.log(`${m} ${p}:`, r.status);
  }
})();
