// CP60 probe (harness): does a learner see classmates' e-mail addresses on the class page API?
import { call, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

void (async () => {
  const a = await newStudent('cp60-class-a');
  const b = await newStudent('cp60-class-b');
  const classId = Number(
    harnessQuery(`select id from "Class" order by id limit 1`)[0][0],
  );
  for (const u of [a, b])
    harnessExec(
      `insert into "Enrollment" ("userId","classId","status","progress","joinedAt") values (${u.userId}, ${classId}, 'ACTIVE', 0, now())`,
    );
  const detail = await call('GET', `/classes/${classId}`, a.token);
  const raw = JSON.stringify(detail.data ?? {});
  console.log('status', detail.status, 'class', classId);
  console.log('sees own email:', raw.includes(a.email));
  console.log('sees classmate email:', raw.includes(b.email));
  console.log('enrollments returned:', (detail.data?.enrollments ?? []).length);
  const other = await call(
    'GET',
    `/classes/${classId}`,
    (await newStudent('cp60-class-c')).token,
  );
  console.log('non-member status:', other.status);
})();
