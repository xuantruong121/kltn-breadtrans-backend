/**
 * Owner access matrix on the disposable harness, after
 * scripts/practice-level-normalization.ts (apply, media, ready):
 *   standalone Listening/Reading/Speaking/Writing: A1/A2 FREE, B1+ PLUS
 *   (PRO includes PLUS); Vocabulary/Flashcard/Grammar FREE; Courses PRO.
 * API checks call the real endpoints directly (lock bypass attempts
 * included); Chromium checks the /speaking catalog and lock states.
 * No real provider: mock Speaking evaluator, deterministic writing grader.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-practice-entitlements.ts <10s.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BE,
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
} from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
const wav = readFileSync(process.argv[2]);
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
type Acct = Awaited<ReturnType<typeof newStudent>>;

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
    reason: 'Harness entitlement matrix',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}
const expire = (userId: number) =>
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '31 days', "endsAt" = now() - interval '1 minute' where "userId" = ${userId} and "endsAt" > now()`,
  );
const planCode = async (t: string) =>
  (await call('GET', '/subscriptions/me', t)).data?.plan?.code;

async function speak(token: string, exerciseId: number) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(`${BE}/speaking/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  return res.status;
}

async function main() {
  const ids = {
    listeningA2: 10,
    listeningB1: 27,
    readingA: 13,
    readingB1: 6,
    readingC1: 16,
    writingA2: 17,
    writingB1: 18,
    speakingA2: Number(
      one(
        `select id from "SpeakingExercise" where "practiceSetId" = 'practice-question-response-a2' order by "order" limit 1`,
      ),
    ),
    speakingB1: 11,
    speakingC1: Number(
      one(
        `select id from "SpeakingExercise" where "practiceSetId" = 'practice-opinion-c1' order by "order" limit 1`,
      ),
    ),
    vocabPro: Number(
      one(
        `select id from "VocabTopic" where "isPro" and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
      ),
    ),
    grammar: Number(
      one(
        `select id from "GrammarTopic" where "publicationStatus" = 'PUBLISHED' order by id limit 1`,
      ),
    ),
    course: Number(
      one(
        `select id from "Course" where status = 'PUBLISHED' order by id limit 1`,
      ),
    ),
  };
  console.log(JSON.stringify(ids));
  const admin = await newAdmin('ent-admin');
  const free = await newStudent('ent-free');
  const plus = await newStudent('ent-plus');
  const pro = await newStudent('ent-pro');
  await grant(admin.token, plus.userId, 'PLUS');
  await grant(admin.token, pro.userId, 'PRO');

  const quiz = async (a: Acct, id: number) =>
    (await call('GET', `/quizzes/${id}`, a.token)).status;
  const speakingDetail = async (a: Acct, id: number) => {
    const r = await call('GET', `/speaking/exercises/${id}`, a.token);
    return { status: r.status, ...(r.data ?? {}) };
  };
  const course = async (a: Acct) =>
    (await call('GET', `/courses/${ids.course}/learning`, a.token)).status;

  console.log('\n== Quiz-backed practice: direct detail requests');
  // CP58 matrix: Listening/Reading B1+ need PLUS, Writing B1+ needs PRO.
  for (const [label, id, minPlan] of [
    ['Listening A2 (was PLUS)', ids.listeningA2, 'FREE'],
    ['Listening B1 (was FREE)', ids.listeningB1, 'PLUS'],
    ['Reading A1–A2', ids.readingA, 'FREE'],
    ['Reading B1 (was FREE)', ids.readingB1, 'PLUS'],
    ['Reading C1', ids.readingC1, 'PLUS'],
    ['Writing A2', ids.writingA2, 'FREE'],
    ['Writing B1', ids.writingB1, 'PRO'],
  ] as const) {
    const [f, p, r] = [
      await quiz(free, id),
      await quiz(plus, id),
      await quiz(pro, id),
    ];
    check(
      `${label}: opens from ${minPlan}`,
      f === (minPlan === 'FREE' ? 200 : 403) &&
        p === (minPlan === 'PRO' ? 403 : 200) &&
        r === 200,
      `(${f}/${p}/${r})`,
    );
  }
  const l10 = await call('GET', `/quizzes/${ids.listeningA2}`, free.token);
  const assetUrl = l10.data?.questions?.find((q: any) => q.audioAssets?.length)
    ?.audioAssets?.[0]?.url;
  const audio = assetUrl ? await fetch(assetUrl) : null;
  check(
    // The A2 quiz's private objects exist only in the real private bucket,
    // not in the harness fake S3: the signed URL is what is checked here.
    'FREE gets the A2 listening audio as a signed private URL',
    /X-Amz/.test(assetUrl ?? ''),
    `(object in harness fake S3: ${audio?.status})`,
  );
  const l27 = await call('GET', `/quizzes/${ids.listeningB1}`, plus.token);
  const premiumUrl = l27.data?.questions?.find(
    (q: any) => q.audioAssets?.length,
  )?.audioAssets?.[0]?.url;
  check(
    'PLUS gets the newly premium B1 audio as a signed private URL',
    /X-Amz/.test(premiumUrl ?? '') && (await fetch(premiumUrl)).status === 200,
  );
  const wr = await call(
    'POST',
    `/writing/quizzes/${ids.writingB1}/submit`,
    free.token,
    {
      answer:
        'I would like to request a meeting next week to discuss the project budget.',
      clientAttemptId: randomUUID(),
    },
  );
  check(
    'FREE cannot submit a B1 writing task directly (no grading)',
    wr.status === 403,
    `(${wr.status})`,
  );

  console.log('\n== Speaking: detail and submission');
  for (const [label, id, freeOk] of [
    ['Speaking A2', ids.speakingA2, true],
    ['Speaking B1 pronunciation (was FREE)', ids.speakingB1, false],
    ['Speaking C1 (new)', ids.speakingC1, false],
  ] as const) {
    const d = [
      await speakingDetail(free, id),
      await speakingDetail(plus, id),
      await speakingDetail(pro, id),
    ];
    // CP58 matrix: Speaking B1+ needs PRO, so PLUS is refused like FREE.
    check(
      `${label}: ${freeOk ? 'open to every plan' : 'PRO only'}`,
      (freeOk
        ? d[0].status === 200 &&
          d[0].isLocked === false &&
          d[1].status === 200 &&
          d[1].isLocked === false
        : d[0].status === 403 && d[1].status === 403) &&
        d[2].status === 200 &&
        d[2].isLocked === false,
      `(${d.map((x) => x.status).join('/')})`,
    );
    if (!freeOk)
      check(
        `${label}: FREE detail request returns no prompt or audio`,
        !d[0]?.targetText && !d[0]?.audioUrl,
      );
  }
  check(
    'FREE submits an A2 recording',
    (await speak(free.token, ids.speakingA2)) < 300,
  );
  check(
    'FREE cannot submit a B1 recording directly',
    (await speak(free.token, ids.speakingB1)) === 403,
  );
  check(
    'PLUS cannot submit a C1 recording directly',
    (await speak(plus.token, ids.speakingC1)) === 403,
  );
  check(
    'PRO submits a C1 recording',
    (await speak(pro.token, ids.speakingC1)) < 300,
  );
  const b1 = await speakingDetail(pro, ids.speakingB1);
  check(
    'PRO gets the moved B1 reference clip as a signed private URL',
    /X-Amz/.test(b1?.audioUrl ?? '') &&
      (await fetch(b1.audioUrl)).status === 200,
  );

  console.log('\n== Speaking catalog groups');
  const list = (await call('GET', '/speaking/exercises', free.token))
    .data as any[];
  const sets = new Map<string, any>();
  for (const e of list) sets.set(e.practiceSet.key, e.practiceSet);
  const labels = [...sets.values()].map((s) => s.difficultyLabel);
  check(
    'catalog = 9 practice sets, each with one level label',
    sets.size === 9 &&
      labels.every((l) =>
        /^(Cơ bản|Trung cấp|Nâng cao) · [ABC][12](–[ABC][12])?$/.test(l),
      ),
    labels.join(' | '),
  );
  check(
    'every set has at least five tasks',
    [...sets.values()].every((s) => s.exerciseCount >= 5),
    [...sets.values()].map((s) => s.exerciseCount).join(','),
  );
  check(
    'no set mixes FREE and locked tasks',
    [...sets.keys()].every(
      (k) =>
        new Set(
          list.filter((e) => e.practiceSet.key === k).map((e) => e.isLocked),
        ).size === 1,
    ),
  );

  console.log('\n== Free modules');
  const topics = (await call('GET', '/vocab/topics', free.token)).data;
  const all = [...(topics?.topics ?? [])];
  check(
    'Vocabulary/Flashcard: FREE sees every topic unlocked',
    all.length > 0 && all.every((t: any) => !t.isLocked),
    `(${all.length})`,
  );
  const vt = await call('GET', `/vocab/topics/${ids.vocabPro}`, free.token);
  check(
    'FREE opens a former PRO vocabulary topic',
    vt.status === 200 && (vt.data?.words?.length ?? 0) > 0,
    `(${vt.status})`,
  );
  const g = await call('GET', `/grammar/topics/${ids.grammar}`, free.token);
  check('FREE opens a grammar topic', g.status === 200, `(${g.status})`);

  console.log('\n== Courses');
  check(
    'Courses: FREE and PLUS refused, PRO opens',
    [403, 401].includes(await course(free)) &&
      [403, 401].includes(await course(plus)) &&
      (await course(pro)) === 200,
  );

  console.log('\n== Transitions');
  const up = await newStudent('ent-up');
  await grant(admin.token, up.userId, 'PLUS');
  check(
    'FREE → PLUS opens B1, course still refused',
    (await quiz(up, ids.readingB1)) === 200 && (await course(up)) === 403,
  );
  expire(up.userId);
  check(
    'PLUS expired → FREE: B1 refused again, A2 still open',
    (await planCode(up.token)) === 'FREE' &&
      (await quiz(up, ids.readingB1)) === 403 &&
      (await quiz(up, ids.readingA)) === 200,
  );
  await grant(admin.token, up.userId, 'PRO');
  check(
    '→ PRO: B1 and course open',
    (await quiz(up, ids.readingB1)) === 200 && (await course(up)) === 200,
  );
  expire(up.userId);
  await grant(admin.token, up.userId, 'PLUS');
  check(
    'PRO → PLUS: course refused, B1 open',
    (await course(up)) === 403 && (await quiz(up, ids.readingB1)) === 200,
  );
  expire(up.userId);
  check(
    '→ expired: FREE again',
    (await planCode(up.token)) === 'FREE' &&
      (await quiz(up, ids.readingB1)) === 403,
  );

  console.log('\n== Chromium /speaking');
  for (const [who, grantCode] of [
    ['free', null],
    ['pro', 'PRO'],
  ] as const) {
    const s = await studentPage(`ent-ui-${who}`, who === 'free' ? 1366 : 390);
    await hidePet(s.page);
    if (grantCode) await grant(admin.token, s.account.userId, grantCode);
    await s.page.goto(`${FE}/speaking`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await s.page.waitForTimeout(2500);
    const body = (await s.page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    const locks = await s.page.getByText('Mở khóa với PRO').count();
    if (who === 'free') {
      check(
        'FREE /speaking: basic sets open, B1+ sets show "Mở khóa với PRO"',
        locks >= 6 &&
          body.includes('Cơ bản · A1–A2') &&
          body.includes('Cơ bản · A2'),
        `(${locks} locks)`,
      );
      await s.page.screenshot({
        path: `${SHOTS}/practice-speaking-free-1366.png`,
        fullPage: true,
      });
      await s.page
        .getByRole('button', { name: 'Nâng cao', exact: true })
        .first()
        .click();
      await s.page.waitForTimeout(800);
      const adv = (await s.page.locator('body').innerText()).replace(
        /\s+/g,
        ' ',
      );
      check(
        'filter "Nâng cao" shows only the C1 set',
        adv.includes('Bảo vệ quan điểm về vấn đề xã hội') &&
          !adv.includes('Cơ bản ·') &&
          !adv.includes('Trung cấp ·'),
        adv.slice(0, 300),
      );
    } else {
      check(
        'PRO /speaking at 390 px: no PRO lock anywhere',
        locks === 0 && body.includes('Nâng cao · C1'),
        `(${locks})`,
      );
      await s.page.screenshot({
        path: `${SHOTS}/practice-speaking-pro-390.png`,
        fullPage: true,
      });
    }
    check(
      `${who}: no server error`,
      !s.issues.some((x) => x.startsWith('api 5')),
      s.issues.filter((x) => x.startsWith('api')).join(' | '),
    );
    await s.browser.close();
  }
  console.log(`\nPRACTICE_ENTITLEMENT_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
