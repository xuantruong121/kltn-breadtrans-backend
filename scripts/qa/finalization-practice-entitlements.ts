/**
 * Owner access matrix on the disposable harness, after
 * scripts/practice-level-normalization.ts (apply, media, ready):
 *   owner matrix 2026-10-30: Reading and Listening FREE at every level,
 *   except dictation B1+ (PLUS); Speaking/Writing A1-A2 FREE, B1-B2 PLUS,
 *   C1+ PRO (PRO includes PLUS); Vocabulary/Flashcard/Grammar FREE.
 *   Courses were removed on 2026-11-01. Every learner has all practice
 *   levels opened, so a refusal here is the plan's, not the level lock's.
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
  unlockAllLevels,
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
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and coalesce(pv."durationDays", 30) = 30 and p.code = '${code}'`,
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
    writingC1: 19,
    dictationB1: 25,
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
  };
  console.log(JSON.stringify(ids));
  const admin = await newAdmin('ent-admin');
  const free = await newStudent('ent-free');
  const plus = await newStudent('ent-plus');
  const pro = await newStudent('ent-pro');
  await grant(admin.token, plus.userId, 'PLUS');
  await grant(admin.token, pro.userId, 'PRO');
  for (const learner of [free, plus, pro]) unlockAllLevels(learner.userId);

  const quiz = async (a: Acct, id: number) =>
    (await call('GET', `/quizzes/${id}`, a.token)).status;
  const speakingDetail = async (a: Acct, id: number) => {
    const r = await call('GET', `/speaking/exercises/${id}`, a.token);
    return { status: r.status, ...(r.data ?? {}) };
  };

  console.log('\n== Quiz-backed practice: direct detail requests');
  for (const [label, id, minPlan] of [
    ['Listening A2', ids.listeningA2, 'FREE'],
    ['Conversation B1', ids.listeningB1, 'FREE'],
    ['Dictation B1', ids.dictationB1, 'PLUS'],
    ['Reading A1–A2', ids.readingA, 'FREE'],
    ['Reading B1', ids.readingB1, 'FREE'],
    ['Reading C1', ids.readingC1, 'FREE'],
    ['Writing A2', ids.writingA2, 'FREE'],
    ['Writing B1', ids.writingB1, 'PLUS'],
    ['Writing B2–C1', ids.writingC1, 'PRO'],
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
  const d25 = await call('GET', `/quizzes/${ids.dictationB1}`, plus.token);
  const premiumUrl = d25.data?.questions?.find(
    (q: any) => q.audioAssets?.length,
  )?.audioAssets?.[0]?.url;
  check(
    // As above: the object itself lives only in the real private bucket.
    'PLUS gets the dictation B1 audio as a signed private URL',
    /X-Amz/.test(premiumUrl ?? ''),
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
  for (const [label, id, minPlan] of [
    ['Speaking A2', ids.speakingA2, 'FREE'],
    ['Speaking B1 pronunciation', ids.speakingB1, 'PLUS'],
    ['Speaking C1', ids.speakingC1, 'PRO'],
  ] as const) {
    const d = [
      await speakingDetail(free, id),
      await speakingDetail(plus, id),
      await speakingDetail(pro, id),
    ];
    const open = (x: { status: number; isLocked?: boolean }) =>
      x.status === 200 && x.isLocked === false;
    check(
      `${label}: opens from ${minPlan}`,
      (minPlan === 'FREE' ? open(d[0]) : d[0].status === 403) &&
        (minPlan === 'PRO' ? d[1].status === 403 : open(d[1])) &&
        open(d[2]),
      `(${d.map((x) => x.status).join('/')})`,
    );
    if (minPlan !== 'FREE')
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
  const publishedSets = Number(
    one(
      `select count(*) from "SpeakingPracticeSet" where scope = 'SKILL_PRACTICE' and "publicationStatus" = 'PUBLISHED'`,
    ),
  );
  check(
    `catalog = the ${publishedSets} published practice sets, each with one level label`,
    sets.size === publishedSets &&
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

  console.log('\n== Transitions');
  // Writing B1 needs PLUS, Writing B2–C1 needs PRO (matrix 2026-10-30).
  const up = await newStudent('ent-up');
  unlockAllLevels(up.userId);
  await grant(admin.token, up.userId, 'PLUS');
  check(
    'FREE → PLUS opens B1 writing, C1 writing still refused',
    (await quiz(up, ids.writingB1)) === 200 &&
      (await quiz(up, ids.writingC1)) === 403,
  );
  expire(up.userId);
  check(
    'PLUS expired → FREE: B1 writing refused again, A2 still open',
    (await planCode(up.token)) === 'FREE' &&
      (await quiz(up, ids.writingB1)) === 403 &&
      (await quiz(up, ids.writingA2)) === 200,
  );
  await grant(admin.token, up.userId, 'PRO');
  check(
    '→ PRO: B1 and C1 writing open',
    (await quiz(up, ids.writingB1)) === 200 &&
      (await quiz(up, ids.writingC1)) === 200,
  );
  expire(up.userId);
  await grant(admin.token, up.userId, 'PLUS');
  check(
    'PRO → PLUS: C1 writing refused, B1 open',
    (await quiz(up, ids.writingC1)) === 403 &&
      (await quiz(up, ids.writingB1)) === 200,
  );
  expire(up.userId);
  check(
    '→ expired: FREE again',
    (await planCode(up.token)) === 'FREE' &&
      (await quiz(up, ids.writingB1)) === 403,
  );

  console.log('\n== Chromium /speaking');
  for (const [who, grantCode] of [
    ['free', null],
    ['pro', 'PRO'],
  ] as const) {
    const s = await studentPage(`ent-ui-${who}`, who === 'free' ? 1366 : 390);
    unlockAllLevels(s.account.userId);
    await hidePet(s.page);
    if (grantCode) await grant(admin.token, s.account.userId, grantCode);
    await s.page.goto(`${FE}/speaking`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await s.page.waitForTimeout(2500);
    // Matrix 2026-10-30: B1-B2 sets unlock with PLUS, C1 sets with PRO. The
    // catalog pages its cards, so each level filter is checked on its own.
    const levelView = async (name: string) => {
      await s.page.getByRole('button', { name, exact: true }).first().click();
      await s.page.waitForTimeout(800);
      return {
        text: (await s.page.locator('body').innerText()).replace(/\s+/g, ' '),
        plus: await s.page.getByText('Mở khóa với PLUS').count(),
        pro: await s.page.getByText('Mở khóa với PRO').count(),
      };
    };
    const c1Sets = Number(
      one(
        `select count(*) from "SpeakingPracticeSet" where scope = 'SKILL_PRACTICE' and "publicationStatus" = 'PUBLISHED' and level = 'C1'`,
      ),
    );
    // The catalog list starts after "N bộ luyện nói"; the recommendations above
    // it are not filtered by level, so only the list is read.
    const catalog = (text: string) => {
      const m = /(\d+) bộ luyện nói/.exec(text);
      return {
        count: m ? Number(m[1]) : -1,
        list: m ? text.slice(m.index) : '',
      };
    };
    const onlyAdvanced = (text: string) => {
      const c = catalog(text);
      return (
        c.count === c1Sets &&
        c.list.includes('· Nâng cao ·') &&
        !/· (Mất gốc|Cơ bản|Trung cấp) ·/.test(c.list)
      );
    };
    const basic = await levelView('Cơ bản');
    const middle = await levelView('Trung cấp');
    const advanced = await levelView('Nâng cao');
    if (who === 'free') {
      check(
        'FREE /speaking: Cơ bản open, Trung cấp shows PLUS, Nâng cao shows PRO',
        basic.plus + basic.pro === 0 &&
          middle.plus > 0 &&
          middle.pro === 0 &&
          advanced.pro > 0 &&
          advanced.plus === 0,
        `(basic ${basic.plus}/${basic.pro}, middle ${middle.plus}/${middle.pro}, advanced ${advanced.plus}/${advanced.pro})`,
      );
      check(
        'filter "Nâng cao" lists only the C1 sets',
        onlyAdvanced(advanced.text),
        `(${catalog(advanced.text).count} shown, ${c1Sets} C1 sets)`,
      );
      await s.page.screenshot({
        path: `${SHOTS}/practice-speaking-free-1366.png`,
        fullPage: true,
      });
    } else {
      check(
        'PRO /speaking at 390 px: no plan lock at any level',
        [basic, middle, advanced].every((v) => v.plus + v.pro === 0) &&
          onlyAdvanced(advanced.text),
        `(${[basic, middle, advanced].map((v) => v.plus + v.pro).join('/')})`,
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
