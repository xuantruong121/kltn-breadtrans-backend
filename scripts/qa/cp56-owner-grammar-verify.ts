/**
 * Checkpoint 56 acceptance on the owner's local app (BE :3001, FE :3000)
 * after the Grammar replacement, with the QA FREE learner only. It submits one
 * attempt per replacement topic (a normal learner action) and reads the rest.
 * Usage: npx ts-node --transpile-only scripts/qa/cp56-owner-grammar-verify.ts
 */
import { execFileSync } from 'node:child_process';

import { chromium } from 'playwright';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_OWNER_READONLY', 'cp56-owner-grammar-verify drives the owner app (:3000/:3001, kltn_db) read-only; logins still write sessions');

const BE = 'http://127.0.0.1:3001';
const FE = 'http://localhost:3000';
const SHOTS = 'artifacts/finalization/evidence';
const EMAIL = 'qa-cp51-free@breadtrans.local';
const PASSWORD = 'Cp51-Free-Qa-2026!';

const sql = (q: string) =>
  execFileSync(
    'docker',
    [
      'exec',
      'kltn-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'kltn_db',
      '-At',
      '-c',
      q,
    ],
    { encoding: 'utf8' },
  ).trim();

let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
};

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const r = await fetch(BE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, data: j?.data ?? j };
}

void (async () => {
  const login = await call('POST', '/auth/login', undefined, {
    email: EMAIL,
    password: PASSWORD,
  });
  const token = login.data?.access_token ?? login.data?.accessToken;
  const uid = Number(sql(`select id from "User" where email='${EMAIL}'`));
  const plan = await call('GET', '/subscriptions/me', token);
  check(
    'QA learner is on FREE',
    plan.data?.plan?.code === 'FREE',
    plan.data?.plan?.code,
  );

  const list = await call('GET', '/grammar/topics', token);
  const topics: any[] = Array.isArray(list.data)
    ? list.data
    : (list.data?.items ?? []);
  const ids = topics.map((t) => t.id);
  check('learner catalog lists 12 topics', ids.length === 12, ids.join(','));
  check(
    'first two topics are the replacements 13 and 14',
    ids[0] === 13 && ids[1] === 14,
  );
  check(
    'original topics 1-2 are not listed',
    !ids.includes(1) && !ids.includes(2),
  );
  check(
    'no duplicate titles for learners',
    new Set(topics.map((t) => t.title)).size === topics.length,
  );

  const wallet = () =>
    sql(
      `select coalesce((select sum(points) from "PointHistory" where "userId"=${uid}),0)||'/'||coalesce((select "totalBanhRan" from "UserStats" where "userId"=${uid}),0)||'/'||(select count(*) from "BanhTransaction" where "userId"=${uid})||'/'||(select count(*) from "UserQuestProgress" where "userId"=${uid})`,
    );
  const before = wallet();
  for (const id of [13, 14]) {
    const d = await call('GET', `/grammar/topics/${id}`, token);
    check(
      `FREE opens topic ${id} (5 questions, no key sent)`,
      d.status === 200 &&
        d.data?.questions?.length === 5 &&
        !JSON.stringify(d.data.questions).includes('correctIndex'),
      `(${d.status})`,
    );
    const keys = sql(
      `select string_agg(id||':'||"correctIndex", ',') from "GrammarQuestion" where "topicId"=${id}`,
    )
      .split(',')
      .map((k) => k.split(':').map(Number));
    const r = await call('POST', `/grammar/topics/${id}/attempt`, token, {
      answers: Object.fromEntries(keys),
    });
    check(
      `FREE submits topic ${id}: score 100 with an explanation per question`,
      r.status < 300 &&
        r.data?.score === 100 &&
        r.data?.questionsResult?.every(
          (q: any) => q.isCorrect && q.explanation,
        ),
      `(${r.status} ${r.data?.score})`,
    );
    check(
      `topic ${id} grants 0 XP and 0 Bread`,
      r.data?.rewardXP === 0 && r.data?.rewardBanh === 0,
    );
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  check(
    'XP / Bread / ledger / DailyQuest unchanged',
    wallet() === before,
    `${before} -> ${wallet()}`,
  );
  const hist = await call('GET', '/grammar/my-attempts', token);
  const h: any[] = Array.isArray(hist.data)
    ? hist.data
    : (hist.data?.items ?? []);
  check(
    'both attempts are in the learner history',
    [13, 14].every((id) => h.some((a) => a.topicId === id)),
  );

  const browser = await chromium.launch();
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
    });
    await page.goto(`${FE}/grammar`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const count = (
      text.match(
        /Ngữ pháp\s*\S\s*(Cơ bản|Trung cấp|Nâng cao)\s*\S\s*5 câu hỏi/g,
      ) ?? []
    ).length;
    check(
      `@${width} /grammar shows 12 topic cards with Vietnamese level labels`,
      count === 12,
      `(${count})`,
    );
    check(
      `@${width} first card is Present Simple, then Past Simple`,
      text.indexOf('Present Simple & Adverbs') <
        text.indexOf('Past Simple & Time') &&
        text.indexOf('Past Simple & Time') < text.indexOf('Present Perfect'),
    );
    check(
      `@${width} each title appears once`,
      text.split('Present Simple & Adverbs of Frequency').length === 2,
    );
    check(
      `@${width} completion survives reload on both replacements`,
      (text.match(/Đã hoàn thành/g) ?? []).length >= 2,
    );
    check(
      `@${width} no internal wording`,
      !/\b(BEGINNER|INTERMEDIATE|ADVANCED|PUBLISHED|DRAFT|undefined)\b/.test(
        text,
      ),
    );
    await page.screenshot({
      path: `${SHOTS}/cp56-owner-grammar-${width}.png`,
      fullPage: width === 1366,
    });
    if (width === 1366) {
      await page
        .getByRole('button', { name: /Luyện lại|Bắt đầu/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
      const detail = (await page.locator('body').innerText()).replace(
        /\s+/g,
        ' ',
      );
      check(
        'opening the first card shows the corrected Present Simple questions',
        /Present Simple/.test(detail) &&
          /reception desk/.test(detail) &&
          !/\bINTERMEDIATE|BEGINNER\b/.test(detail),
        detail.slice(0, 120),
      );
      await page.screenshot({
        path: `${SHOTS}/cp56-owner-grammar-topic13.png`,
        fullPage: true,
      });
    }
    await page.close();
  }
  await browser.close();
  console.log(`CP56_OWNER_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
