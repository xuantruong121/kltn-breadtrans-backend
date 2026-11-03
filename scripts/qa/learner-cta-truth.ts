/**
 * Every daily-quest button on the learner dashboard leads to an activity that
 * advances that quest, and doing that activity really advances it (harness
 * :3100/:3101 only). Also checks that the dashboard's "Bắt đầu" links open
 * their catalog with the promised filter applied.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/learner-cta-truth.ts <10s.wav>
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet } from './harness-browser';
import { harnessQuery } from './harness-db';
import { chromium, type Page } from 'playwright';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/audit`;

/** Where each quest's activity lives; a button anywhere else cannot advance it. */
const QUEST_DESTINATION: Record<string, RegExp> = {
  COMPLETE_QUIZ: /^\/(listening|reading|writing)(\/|\?|$)/,
  DO_LISTENING: /^\/listening(\/|\?|$)/,
  DO_SPEAKING: /^\/speaking(\/|\?|$)/,
  PRACTICE_SPEAKING: /^\/speaking(\/|\?|$)/,
  LEARN_VOCAB: /^\/(flashcard|vocabulary)(\/|\?|$)/,
};

const questRow = (userId: number, type: string) =>
  harnessQuery(
    `select coalesce(max(p."currentValue"),0), bool_or(p."isCompleted") from "UserQuestProgress" p join "DailyQuest" d on d.id = p."questId" where p."userId" = ${userId} and d.type = '${type}'`,
  )[0];

async function submitSpeaking(token: string, exerciseId: number, wav: Buffer) {
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
  const json: any = await res.json().catch(() => null);
  const id = (json?.data ?? json)?.submissionId;
  for (let i = 0; i < 40 && id; i += 1) {
    const r = await call('GET', `/speaking/submissions/${id}`, token);
    if (['COMPLETED', 'FAILED'].includes(r.data?.status)) return r.data?.status;
    await new Promise((ok) => setTimeout(ok, 750));
  }
  return `HTTP ${res.status}`;
}

/** The quest cards as the learner sees them: title, button label, href. */
async function questButtons(page: Page, titles: string[]) {
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.getByText('Nhiệm vụ hôm nay').first().waitFor({ timeout: 60_000 });
  await hidePet(page);
  // Each quest card: the element holding the title, then the nearest
  // ancestor that also holds a link (the card's button).
  for (const title of titles)
    await page
      .getByText(title, { exact: true })
      .first()
      .waitFor({ timeout: 60_000 });
  return page.evaluate((names) => {
    return names.map((title) => {
      const node = [...document.querySelectorAll('body *')].find(
        (el) =>
          el.children.length === 0 && (el.textContent ?? '').trim() === title,
      );
      let card: Element | null = node ?? null;
      while (card && !card.querySelector('a[href]')) card = card.parentElement;
      const a = card?.querySelector('a[href]');
      return {
        title,
        label: (a?.textContent ?? '').trim(),
        href: a?.getAttribute('href') ?? '',
        card: (card?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
      };
    });
  }, titles);
}

async function main() {
  const wav = readFileSync(process.argv[2]);
  const student = await newStudent('cta-truth');
  const profile = await call('PUT', '/learning-path/profile', student.token, {
    onboarded: true,
    goal: 'GENERAL',
    track: 'GENERAL',
    minutesPerDay: 15,
  });
  check(
    'the learner is onboarded',
    profile.status < 300,
    String(profile.status),
  );

  const today = await call(
    'GET',
    '/gamification/dashboard/today',
    student.token,
  );
  const quests: any[] = today.data?.quests ?? [];
  check(
    'the dashboard lists active quests',
    quests.length > 0,
    String(quests.length),
  );
  for (const quest of quests) {
    const rule = QUEST_DESTINATION[quest.type];
    check(
      `API: quest ${quest.type} links where its activity lives`,
      Boolean(rule?.test(quest.actionUrl ?? '')),
      `${quest.actionLabel} -> ${quest.actionUrl}`,
    );
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const issues: string[] = [];
  page.on('pageerror', (e) =>
    issues.push(`pageerror ${e.message.slice(0, 160)}`),
  );
  page.on('response', (r) => {
    // Practice audio lives in the private bucket, which the harness fakes
    // empty; its presence on the real bucket is checked separately.
    if (
      r.url().startsWith(BE) &&
      r.status() >= 500 &&
      !/\/audio(\?|$)/.test(r.url())
    )
      issues.push(`api ${r.status()} ${r.url().slice(21)}`);
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', student.email);
  await page.fill('input[name="password"]', student.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });

  const titles = quests.map((q) => String(q.title));
  const buttons = await questButtons(page, titles);
  await page.screenshot({ path: `${SHOTS}/cta-quests.png` });
  for (const quest of quests) {
    const button = buttons.find((b) => b.title === quest.title);
    const rule = QUEST_DESTINATION[quest.type];
    check(
      `UI: the "${quest.title}" button opens where ${quest.type} advances`,
      Boolean(button && rule?.test(button.href)),
      `${button?.label} -> ${button?.href}`,
    );
    check(
      `UI: the "${quest.title}" button is not labelled as an exam`,
      !/kiểm tra|thi\b|đề/i.test(button?.label ?? ''),
      button?.label,
    );
  }

  // Doing the activity behind the skill-practice button advances the quest.
  const skillQuest = quests.find((q) => q.type === 'COMPLETE_QUIZ');
  if (skillQuest) {
    const button = buttons.find((b) => b.title === skillQuest.title);
    await page.goto(`${FE}${button?.href ?? '/listening'}`, {
      waitUntil: 'networkidle',
    });
    const quizId =
      Number(/\/listening\/(\d+)/.exec(button?.href ?? '')?.[1]) ||
      Number(
        harnessQuery(
          `select q.id from "Quiz" q where q.type = 'LISTENING_PRACTICE' and q."isPremiumContent" = false and q."practiceTopicId" is null and exists (select 1 from "Question" x where x."quizId" = q.id) order by q.id limit 1`,
        )[0]?.[0],
      );
    const questions = harnessQuery(
      `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
    );
    const answers = questions.map(([id, raw]) => {
      const c = JSON.parse(raw);
      return {
        questionId: Number(id),
        answer: Array.isArray(c.options)
          ? c.options[c.correctIndex]
          : c.correct,
      };
    });
    const attempt = await call(
      'POST',
      `/quizzes/${quizId}/listening-attempts`,
      student.token,
    );
    const submitted = await call(
      'POST',
      `/quizzes/${quizId}/submit`,
      student.token,
      {
        answers,
        attemptId: attempt.data?.id ?? attempt.data?.attemptId,
      },
    );
    check(
      'the listening practice behind the button is submitted',
      submitted.status < 300,
      `quiz ${quizId} ${submitted.status}`,
    );
    await page.waitForTimeout(2500);
    const [value, done] = questRow(student.userId, 'COMPLETE_QUIZ');
    check(
      'COMPLETE_QUIZ advanced to done',
      Number(value) >= 1 && done === 't',
      `${value} ${done}`,
    );
    const bread = harnessQuery(
      `select coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${student.userId} and source = 'DAILY_QUEST'`,
    )[0]?.[0];
    check(
      'the quest paid its Bánh mì',
      Number(bread) >= Number(skillQuest.rewardBanh ?? 1),
      `bread ${bread}`,
    );
  }

  // Speaking quests: one free read-aloud submission.
  const speakingQuests = quests.filter((q) =>
    ['DO_SPEAKING', 'PRACTICE_SPEAKING'].includes(q.type),
  );
  if (speakingQuests.length) {
    // The exercise the speaking button opens.
    const href =
      buttons.find((b) => b.title === speakingQuests[0].title)?.href ?? '';
    const exercise = Number(/\/speaking\/(\d+)/.exec(href)?.[1]) || 1;
    const status = await submitSpeaking(student.token, exercise, wav);
    check(
      'a free speaking practice completes',
      status === 'COMPLETED',
      `exercise ${exercise}: ${status}`,
    );
    for (const quest of speakingQuests) {
      const [value] = questRow(student.userId, quest.type);
      check(
        `${quest.type} ("${quest.title}") advanced by one speaking practice`,
        Number(value) >= 1,
        `${value}/${quest.targetValue}`,
      );
    }
  }

  const after = await questButtons(page, titles);
  await page.screenshot({ path: `${SHOTS}/cta-quests-after.png` });
  check(
    'the dashboard shows the finished quest',
    after.length > 0 &&
      (await page.locator('body').innerText()).includes('1/1'),
  );

  // Dashboard "Bắt đầu" deep links: the catalog applies the promised filter.
  const filters: Array<[string, string, RegExp]> = [
    ['/listening?mode=DICTATION', 'Nghe chép', /DICTATION/],
    ['/reading?difficulty=ADVANCED', 'Nâng cao', /ADVANCED/],
    ['/exams?paper=TOEIC_SW', 'TOEIC S&W', /TOEIC_SW/],
  ];
  for (const [href, label] of filters) {
    await page.goto(`${FE}${href}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const pressed = await page
      .locator(
        'button[aria-pressed="true"], [role="tab"][aria-selected="true"], button[data-active="true"]',
      )
      .allInnerTexts();
    check(
      `${href} opens with "${label}" selected`,
      pressed.some((text) => text.includes(label)),
      JSON.stringify(pressed).slice(0, 160),
    );
  }

  check(
    'no page error or API 5xx on the way',
    issues.length === 0,
    issues.join(' | ').slice(0, 400),
  );
  await browser.close();
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
