/**
 * CP60.1 regression (harness only): classroom, Teacher and tuition surfaces
 * are retired; self-paced course access follows PRO; course progress
 * survives PRO expiry and renewal.
 *
 * Run: npx ts-node --transpile-only scripts/qa/cp601-course-domain-regression.ts
 */
import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

type Acct = Awaited<ReturnType<typeof newStudent>>;
const one = (sql: string) => harnessQuery(sql)[0]?.[0];

async function grant(admin: string, userId: number, code: 'PLUS' | 'PRO') {
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and p.code = '${code}'`,
    ),
  );
  const r = await call('POST', '/admin/subscriptions/grant', admin, {
    studentId: userId,
    planVersionId,
    durationDays: 30,
    reason: 'Harness CP60.1 course domain',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}
const expire = (userId: number) =>
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '31 days', "endsAt" = now() - interval '1 minute' where "userId" = ${userId} and "endsAt" > now()`,
  );
const enrollInLegacyClass = (userId: number, classId: number) =>
  harnessExec(
    `insert into "Enrollment" ("userId","classId","status","progress","joinedAt") values (${userId}, ${classId}, 'ACTIVE', 0, now()) on conflict do nothing`,
  );

const keys = new Map<number, unknown>(
  harnessQuery(
    `select id, "correctAnswer"::text from "CourseLessonQuestion"`,
  ).map(([id, key]) => [Number(id), JSON.parse(key)]),
);
const answersFor = (exercise: any) =>
  exercise.questions.map((q: any) =>
    Array.isArray(q.options) && q.options.length
      ? { questionId: q.id, answer: keys.get(q.id) }
      : { questionId: q.id, answer: 'In my own words: this is my answer.' },
  );

async function main() {
  const admin = await newAdmin('cp601-admin');
  const free = await newStudent('cp601-free');
  const plus = await newStudent('cp601-plus');
  await grant(admin.token, plus.userId, 'PLUS');
  const pro = await newStudent('cp601-pro');
  await grant(admin.token, pro.userId, 'PRO');
  const [classId, courseId] = harnessQuery(
    `select id, "courseId" from "Class" order by id limit 1`,
  )[0].map(Number);
  const courseIds: number[] = (await call('GET', '/public/courses')).data.map(
    (c: any) => c.id,
  );

  console.log('\n== Roles: the database cannot hold a TEACHER');
  check(
    'Role enum is exactly ADMIN, STUDENT',
    one(`select enum_range(null::"Role")::text`) === '{ADMIN,STUDENT}',
  );
  let teacherWrite = 'accepted';
  try {
    harnessExec(`update "User" set role = 'TEACHER' where id = ${free.userId}`);
  } catch {
    teacherWrite = 'rejected';
  }
  check(
    'assigning TEACHER to a user is rejected by the database',
    teacherWrite === 'rejected',
  );
  check(
    'a token for a deleted (e.g. former Teacher) account is refused',
    await (async () => {
      const gone = await newStudent('cp601-gone');
      harnessExec(`delete from "User" where id = ${gone.userId}`);
      return (await call('GET', '/users/profile', gone.token)).status === 401;
    })(),
  );
  check(
    'a learner cannot reach admin course management',
    [401, 403].includes(
      (await call('GET', '/admin/courses', free.token)).status,
    ),
  );
  check(
    'admin reaches course management',
    (await call('GET', '/admin/courses', admin.token)).status === 200,
  );

  console.log('\n== Retired classroom, Teacher and tuition routes');
  const retired: Array<[string, string, unknown?]> = [
    ['GET', '/classes'],
    ['GET', '/classes/my-classes'],
    ['GET', `/classes/${classId}`],
    ['GET', '/classes/watch-tracking'],
    [
      'PATCH',
      '/classes/watch-tracking',
      { classId, videoKey: 'x', played: 0.5 },
    ],
    ['GET', `/courses/classes/${classId}/assignments`],
    ['POST', `/courses/classes/${classId}/assignments`, { title: 'x' }],
    ['GET', '/courses/assignments/1'],
    ['POST', '/courses/assignments/1/submit', { content: 'x' }],
    ['PUT', '/courses/submissions/1/grade', { grade: 10 }],
    ['POST', `/courses/classes/${classId}/enroll`],
    ['GET', `/courses/${courseId}/my-enrollments`],
    ['GET', '/admin/classes'],
    ['GET', `/admin/classes/${classId}`],
    ['POST', `/admin/courses/${courseId}/classes`, { name: 'x' }],
    ['GET', '/payments/me'],
    ['POST', '/payments/1/report-transfer'],
    ['GET', '/admin/payments'],
    ['POST', '/admin/payments/1/confirm'],
  ];
  for (const who of [
    ['learner', pro.token],
    ['admin', admin.token],
  ] as const) {
    const statuses = [];
    for (const [m, p, body] of retired)
      statuses.push(
        `${m} ${p}=${(await call(m as any, p, who[1], body as any)).status}`,
      );
    check(
      `every retired route answers 404 to an authenticated ${who[0]}`,
      statuses.every((s) => s.endsWith('=404')),
      statuses.filter((s) => !s.endsWith('=404')).join(' | '),
    );
  }

  console.log('\n== Course APIs carry no class, enrollment or tuition data');
  for (const [label, token] of [
    ['guest', undefined],
    ['FREE', free.token],
    ['PRO', pro.token],
  ] as const) {
    const list = JSON.stringify(
      (await call('GET', '/courses', token)).data ?? '',
    );
    const pub = JSON.stringify(
      (await call('GET', '/public/courses', token)).data ?? '',
    );
    const detail = JSON.stringify(
      (await call('GET', `/public/courses/${courseId}`, token)).data ?? '',
    );
    check(
      `${label}: course list, public catalog and detail have no classes, enrollments or tuition`,
      ![list, pub, detail].some((t) =>
        /tuitionFeeVnd|"classes"|enrollment|upcomingClassCount|remainingSeats/i.test(
          t,
        ),
      ),
    );
  }
  const adminCourses = JSON.stringify(
    (await call('GET', '/admin/courses', admin.token)).data,
  );
  check(
    'admin course list has no classes or tuition',
    !/tuitionFeeVnd|"classes"|enrollments/.test(adminCourses),
  );

  console.log(
    '\n== Course access follows PRO, never a legacy class Enrollment',
  );
  for (const a of [free, plus]) enrollInLegacyClass(a.userId, classId);
  const learn = async (a: Acct) =>
    (await call('GET', `/courses/${courseId}/learning`, a.token)).status;
  check(
    'FREE with a legacy Enrollment is refused (403)',
    (await learn(free)) === 403,
  );
  check(
    'PLUS with a legacy Enrollment is refused (403)',
    (await learn(plus)) === 403,
  );
  check('PRO opens the learning path (200)', (await learn(pro)) === 200);
  for (const id of courseIds) {
    const [f, p, r] = [
      (await call('GET', `/courses/${id}/learning`, free.token)).status,
      (await call('GET', `/courses/${id}/learning`, plus.token)).status,
      (await call('GET', `/courses/${id}/learning`, pro.token)).status,
    ];
    check(
      `course ${id}: FREE/PLUS refused, PRO opens`,
      f === 403 && p === 403 && r === 200,
      `(${f}/${p}/${r})`,
    );
  }
  const draftId = Number(
    harnessExec(
      `insert into "Course" (title, status, "updatedAt") values ('CP60.1 draft', 'DRAFT', now()) returning id`,
    )[0][0],
  );
  check(
    'an unpublished course stays hidden from PRO',
    (await call('GET', `/courses/${draftId}/learning`, pro.token)).status ===
      404,
  );
  harnessExec(`delete from "Course" where id = ${draftId}`);

  console.log('\n== Progress survives PRO expiry and renewal');
  const renewer = await newStudent('cp601-renew');
  await grant(admin.token, renewer.userId, 'PRO');
  enrollInLegacyClass(renewer.userId, classId);
  const overview = await call(
    'GET',
    `/courses/${courseId}/learning`,
    renewer.token,
  );
  const lessonId = overview.data.lessons[0].id;
  const lesson = await call(
    'GET',
    `/courses/${courseId}/learning/lessons/${lessonId}`,
    renewer.token,
  );
  for (const exercise of lesson.data.lesson.exercises) {
    const r = await call(
      'POST',
      `/courses/${courseId}/learning/lessons/${lessonId}/exercises/${exercise.id}/submit`,
      renewer.token,
      { answers: answersFor(exercise) },
    );
    if (r.status >= 300) console.log('submit', exercise.id, r.status);
  }
  const before = await call(
    'GET',
    `/courses/${courseId}/learning`,
    renewer.token,
  );
  const attempts = () =>
    Number(
      one(
        `select count(*) from "CourseLessonAttempt" where "userId" = ${renewer.userId}`,
      ),
    );
  const attemptsBefore = attempts();
  check(
    'PRO completes lesson 1',
    before.data.lessons[0].completed === true && attemptsBefore > 0,
    `(completed ${before.data.progress.completedLessons}/${before.data.progress.totalLessons}, attempts ${attemptsBefore})`,
  );
  expire(renewer.userId);
  const expired = await call(
    'GET',
    `/courses/${courseId}/learning`,
    renewer.token,
  );
  const expiredLesson = await call(
    'GET',
    `/courses/${courseId}/learning/lessons/${lessonId}`,
    renewer.token,
  );
  check(
    'expired PRO (with a legacy Enrollment) is refused the path and the lesson',
    expired.status === 403 && expiredLesson.status === 403,
    `(${expired.status}/${expiredLesson.status})`,
  );
  check('expiry deletes no progress row', attempts() === attemptsBefore);
  await grant(admin.token, renewer.userId, 'PRO');
  const after = await call(
    'GET',
    `/courses/${courseId}/learning`,
    renewer.token,
  );
  check(
    'renewed PRO resumes with lesson 1 still complete and the same progress',
    after.status === 200 &&
      after.data.lessons[0].completed === true &&
      after.data.progress.completedLessons ===
        before.data.progress.completedLessons,
    `(${after.status}, ${after.data?.progress?.completedLessons})`,
  );
  const other = await call('GET', `/courses/${courseId}/learning`, pro.token);
  check(
    'another PRO learner does not inherit that progress',
    other.data.lessons[0].completed === false,
  );

  console.log('\n== Plan payments are untouched');
  const plans = await call('GET', '/plans/catalog');
  const codes = JSON.stringify(plans.data);
  check(
    'plan catalog still offers PLUS and PRO',
    plans.status === 200 && codes.includes('PLUS') && codes.includes('PRO'),
  );

  console.log(`\nCP601_COURSE_DOMAIN_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
