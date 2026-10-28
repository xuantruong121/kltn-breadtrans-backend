/**
 * CP60 probe (harness only): learner modules without their own QA script.
 * Two fresh learners, A and B. Each check asks whether B can read or change
 * something that belongs to A, then that A's own path still works.
 *
 *   Suggestions, issue reports, notification inbox, saved vocabulary,
 *   support conversation, class assignments, daily quests and pet.
 *
 * Run: npx ts-node --transpile-only scripts/qa/cp60-probe-learner-ownership.ts
 */
import { call, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

void (async () => {
  const a = await newStudent('cp60-own-a');
  const b = await newStudent('cp60-own-b');

  console.log('\n== Suggestions');
  const sug = await call('POST', '/suggestions', a.token, {
    category: 'FEATURE',
    content: 'CP60 harness probe: a suggestion that only its author may read.',
  });
  const sugId = sug.data?.id;
  check(
    'A creates a suggestion',
    sug.status < 300 && !!sugId,
    `(${sug.status})`,
  );
  check(
    'A reads it back',
    (await call('GET', `/suggestions/${sugId}`, a.token)).status === 200,
  );
  const sugB = await call('GET', `/suggestions/${sugId}`, b.token);
  check(
    "B cannot read A's suggestion",
    [403, 404].includes(sugB.status),
    `(${sugB.status})`,
  );
  const mineB = await call('GET', '/suggestions/me', b.token);
  check(
    "B's own list does not contain A's suggestion",
    mineB.status === 200 &&
      !JSON.stringify(mineB.data).includes(String(sug.data?.content)),
  );
  check(
    'a learner cannot open the admin suggestion list',
    [401, 403].includes(
      (await call('GET', '/admin/suggestions', a.token)).status,
    ),
  );

  console.log('\n== Issue reports');
  const rep = await call('POST', '/issue-reports', a.token, {
    area: 'LISTENING',
    category: 'CONTENT_ERROR',
    description: 'CP60 harness probe: the transcript and the audio differ.',
  });
  check('A files an issue report', rep.status < 300, `(${rep.status})`);
  check(
    'a learner cannot open the admin issue-report list',
    [401, 403].includes(
      (await call('GET', '/admin/issue-reports', a.token)).status,
    ),
  );

  console.log('\n== Notification inbox');
  harnessExec(
    `insert into "Notification" ("userId","type","title","body") values (${a.userId}, 'CP60_PROBE', 'CP60 probe', 'harness only')`,
  );
  const notifId = Number(
    harnessQuery(
      `select id from "Notification" where "userId" = ${a.userId} and type = 'CP60_PROBE' order by id desc limit 1`,
    )[0][0],
  );
  const inboxB = await call('GET', '/notifications/inbox', b.token);
  check(
    "B's inbox does not list A's notification",
    inboxB.status === 200 &&
      !JSON.stringify(inboxB.data).includes('CP60 probe'),
  );
  const readB = await call(
    'PATCH',
    `/notifications/inbox/${notifId}/read`,
    b.token,
  );
  const delB = await call('DELETE', `/notifications/inbox/${notifId}`, b.token);
  const stillUnread = harnessQuery(
    `select "isRead" from "Notification" where id = ${notifId}`,
  )[0]?.[0];
  check(
    "B can neither mark read nor delete A's notification",
    readB.status === 404 && delB.status === 404 && stillUnread === 'f',
    `(${readB.status}/${delB.status}, isRead=${stillUnread})`,
  );
  const unread = await call(
    'GET',
    '/notifications/inbox/unread-count',
    a.token,
  );
  check(
    'A sees one unread notification',
    unread.status === 200 && JSON.stringify(unread.data).includes('1'),
    JSON.stringify(unread.data),
  );
  const readA = await call(
    'PATCH',
    `/notifications/inbox/${notifId}/read`,
    a.token,
  );
  const delA = await call('DELETE', `/notifications/inbox/${notifId}`, a.token);
  check(
    'A marks it read, then deletes it',
    readA.status === 200 && delA.status === 200,
    `(${readA.status}/${delA.status})`,
  );

  console.log('\n== Saved vocabulary');
  const save = await call('POST', '/vocab/saved', a.token, { word: 'harbour' });
  const savedId =
    save.data?.id ??
    Number(
      harnessQuery(
        `select id from "UserSavedWord" where "userId" = ${a.userId} order by id desc limit 1`,
      )[0]?.[0],
    );
  check('A saves a word', save.status < 300 && !!savedId, `(${save.status})`);
  const savedB = await call('GET', '/vocab/saved', b.token);
  check(
    "B's saved list does not show A's word",
    savedB.status === 200 && !JSON.stringify(savedB.data).includes('harbour'),
  );
  const delSavedB = await call('DELETE', `/vocab/saved/${savedId}`, b.token);
  const savedLeft = harnessQuery(
    `select count(*) from "UserSavedWord" where id = ${savedId}`,
  )[0][0];
  check(
    "B cannot delete A's saved word",
    delSavedB.status === 404 && savedLeft === '1',
    `(${delSavedB.status}, rows=${savedLeft})`,
  );
  check(
    'A deletes it',
    (await call('DELETE', `/vocab/saved/${savedId}`, a.token)).status === 200,
  );

  console.log('\n== Support conversation');
  const convA = await call('GET', '/support/conversations/me', a.token);
  const convId = convA.data?.id ?? convA.data?.conversation?.id;
  check(
    'A opens a support conversation',
    convA.status === 200 && !!convId,
    `(${convA.status})`,
  );
  const msgA = await call(
    'POST',
    `/support/conversations/${convId}/messages`,
    a.token,
    {
      content: 'CP60 probe: a message only A and the staff may read.',
      clientMessageId: `cp60-${Date.now()}`,
    },
  );
  check('A posts a message', msgA.status < 300, `(${msgA.status})`);
  const readConvB = await call(
    'GET',
    `/support/conversations/${convId}/messages`,
    b.token,
  );
  const postConvB = await call(
    'POST',
    `/support/conversations/${convId}/messages`,
    b.token,
    {
      content: 'CP60 probe: B must not be able to post here.',
      clientMessageId: `cp60-b-${Date.now()}`,
    },
  );
  const aiConvB = await call(
    'POST',
    `/support/conversations/${convId}/ai-messages`,
    b.token,
    {
      content: 'CP60 probe: B must not be able to post an AI reply here.',
      clientMessageId: `cp60-bai-${Date.now()}`,
    },
  );
  const modeB = await call(
    'PATCH',
    `/support/conversations/${convId}/mode`,
    b.token,
    {
      mode: 'HUMAN',
    },
  );
  check(
    "B cannot read, post to, or switch the mode of A's conversation",
    [readConvB, postConvB, aiConvB, modeB].every((r) =>
      [403, 404].includes(r.status),
    ),
    `(${[readConvB, postConvB, aiConvB, modeB].map((r) => r.status).join('/')})`,
  );
  check(
    'a learner cannot open the admin support inbox',
    [401, 403].includes(
      (await call('GET', '/admin/support/conversations', a.token)).status,
    ),
  );

  console.log('\n== Class assignments');
  const classId = Number(
    harnessQuery(`select id from "Class" order by id limit 1`)[0][0],
  );
  harnessExec(
    `insert into "Enrollment" ("userId","classId","status","progress","joinedAt") values (${a.userId}, ${classId}, 'ACTIVE', 0, now())`,
  );
  const listA = await call(
    'GET',
    `/courses/classes/${classId}/assignments`,
    a.token,
  );
  const listB = await call(
    'GET',
    `/courses/classes/${classId}/assignments`,
    b.token,
  );
  check(
    'a member lists the class assignments; a non-member is refused',
    listA.status === 200 && listB.status === 403,
    `(${listA.status}/${listB.status})`,
  );
  const assignmentId = harnessQuery(
    `select id from "Assignment" where "classId" = ${classId} order by id limit 1`,
  )[0]?.[0];
  if (assignmentId) {
    const dB = await call(
      'GET',
      `/courses/assignments/${assignmentId}`,
      b.token,
    );
    const sB = await call(
      'POST',
      `/courses/assignments/${assignmentId}/submit`,
      b.token,
      {
        content: 'CP60 probe',
      },
    );
    check(
      'a non-member can neither open nor submit an assignment',
      dB.status === 403 && sB.status === 403,
      `(${dB.status}/${sB.status})`,
    );
    const dA = await call(
      'GET',
      `/courses/assignments/${assignmentId}`,
      a.token,
    );
    const others = (dA.data?.submissions ?? []).filter(
      (s: any) => s.userId !== a.userId,
    );
    check(
      "a member sees no other learner's submission",
      dA.status === 200 && others.length === 0,
      `(${dA.status}, others=${others.length})`,
    );
  } else {
    console.log('NOT_RUN  assignment detail/submit: class has no assignment');
  }
  check(
    'a learner cannot grade a submission',
    [401, 403].includes(
      (
        await call('PUT', '/courses/submissions/1/grade', a.token, {
          score: 10,
        })
      ).status,
    ),
  );

  console.log('\n== Daily quests, pet, leaderboard');
  for (const path of [
    '/gamification/quests',
    '/gamification/pet',
    '/gamification/dashboard/today',
    '/gamification/leaderboard',
    '/gamification/badges/me',
    '/notifications/inbox',
  ]) {
    const r = await call('GET', path, a.token);
    check(`GET ${path} answers 200`, r.status === 200, `(${r.status})`);
  }
  const lb = JSON.stringify(
    (await call('GET', '/gamification/leaderboard', a.token)).data ?? {},
  );
  check(
    'the leaderboard exposes no e-mail address',
    !/@[a-z0-9-]+\.[a-z]/i.test(lb),
  );
  check(
    'a learner cannot trigger the daily cron',
    [401, 403].includes(
      (await call('POST', '/gamification/trigger-daily-cron', a.token)).status,
    ),
  );

  console.log(`\nCP60_OWNERSHIP_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
