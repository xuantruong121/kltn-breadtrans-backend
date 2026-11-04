/**
 * Every daily-quest button on the learner dashboard opens a page that loads,
 * and doing that page's activity advances exactly that quest (harness
 * :3100/:3101 only). Several learners are used so the rotating pool
 * (daily-quest-catalog.ts) is covered. Also checks that the dashboard's
 * "Bắt đầu" links open their catalog with the promised filter applied.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/learner-cta-truth.ts <10s.wav>
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/audit`;
const LEARNERS = Number(process.env.CTA_LEARNERS ?? 8);
const ERROR_COPY =
  /Không tìm thấy|This page could not be found|Đã xảy ra lỗi|Không thể tải bài/i;
const WRITING_TEXT =
  'Hi Lan, thanks for your message. I can meet you on Saturday at ten near the library. I will bring the notes and we can study together. See you, Minh';

/** Where each quest's activity lives; a button anywhere else cannot advance it. */
const QUEST_DESTINATION: Record<string, RegExp> = {
  DO_LISTENING: /^\/listening(\/\d+)?$/,
  DO_READING: /^\/reading(\/\d+)?$/,
  DO_WRITING: /^\/writing(\/\d+)?$/,
  PERFECT_QUIZ: /^\/(listening|reading)(\/\d+)?$/,
  DO_SPEAKING: /^\/speaking(\/\d+)?$/,
  PRACTICE_SPEAKING: /^\/speaking(\/\d+)?$/,
};

const progressOf = (userId: number) =>
  new Map(
    harnessQuery(
      `select d.type, p."currentValue" from "UserQuestProgress" p join "DailyQuest" d on d.id = p."questId" where p."userId" = ${userId} and p."dateKey" = to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    ).map(([type, value]) => [type, Number(value)]),
  );

const settle = () => new Promise((ok) => setTimeout(ok, 2500));

function keyAnswers(quizId: number) {
  return harnessQuery(
    `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
  ).map(([id, raw]) => {
    const c = JSON.parse(raw);
    return {
      questionId: Number(id),
      // Dictation keeps its key in correctAnswer.
      answer: Array.isArray(c.options)
        ? c.options[c.correctIndex]
        : (c.correctAnswer ?? c.correct),
    };
  });
}

/** A free, unlocked practice of this kind, when the button opened a catalog. */
function anyQuiz(type: string) {
  return Number(
    harnessQuery(
      `select z.id from "Quiz" z where z.type = '${type}' and z."publicationStatus" = 'PUBLISHED' and z."isPremiumContent" = false and z.title ~ 'A1|A2' ${type.startsWith('WRITING') ? `and z."practiceTopicId" is not null and not exists (select 1 from "ToeicWritingSetItem" i where i."writingQuizId" = z.id)` : ''} and exists (select 1 from "Question" q where q."quizId" = z.id) order by z.id limit 1`,
    )[0]?.[0],
  );
}

/** An open speaking exercise of the kind a quest counts, from the learner list. */
async function anySpeaking(token: string, pronunciation: boolean) {
  const list = await call('GET', '/speaking/exercises', token);
  const open = ((list.data ?? []) as any[]).find(
    (exercise) =>
      !exercise.isLocked &&
      !exercise.isLevelLocked &&
      ['READ_ALOUD', 'PRONUNCIATION_DRILL'].includes(exercise.taskType) ===
        pronunciation,
  );
  return Number(open?.id);
}

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

/** Does the activity a quest asks for, from the page its button opened. */
async function doActivity(
  type: string,
  href: string,
  token: string,
  wav: Buffer,
) {
  const id = Number(/\/(\d+)$/.exec(href)?.[1]);
  if (
    type === 'DO_LISTENING' ||
    type === 'DO_READING' ||
    type === 'PERFECT_QUIZ'
  ) {
    const kind =
      href.startsWith('/reading') || type === 'DO_READING'
        ? 'BILINGUAL_READING'
        : 'LISTENING_PRACTICE';
    const quizId = id || anyQuiz(kind);
    if (kind === 'LISTENING_PRACTICE')
      await call('POST', `/quizzes/${quizId}/listening-attempts`, token).then(
        async (attempt) => {
          const sub = await call('POST', `/quizzes/${quizId}/submit`, token, {
            answers: keyAnswers(quizId),
            attemptId: attempt.data?.id ?? attempt.data?.attemptId,
          });
          return sub;
        },
      );
    else
      await call('POST', `/quizzes/${quizId}/submit`, token, {
        answers: keyAnswers(quizId),
      });
    return `quiz ${quizId}`;
  }
  if (type === 'DO_WRITING') {
    const quizId = id || anyQuiz('WRITING_EMAIL');
    for (const [question] of harnessQuery(
      `select id from "Question" where "quizId" = ${quizId} order by "order", id`,
    ))
      await call('POST', `/writing/quizzes/${quizId}/submit`, token, {
        answer: `${WRITING_TEXT} [[percent:90]]`,
        questionId: Number(question),
        clientAttemptId: randomUUID(),
      });
    return `writing ${quizId}`;
  }
  const pronunciation = type === 'PRACTICE_SPEAKING';
  const exerciseId = id || (await anySpeaking(token, pronunciation));
  const runs = pronunciation ? 3 : 1;
  let status = '';
  for (let i = 0; i < runs; i += 1)
    status = await submitSpeaking(token, exerciseId, wav);
  return `speaking ${exerciseId} ×${runs} ${status}`;
}

async function questButtons(page: Page, titles: string[]) {
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
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
      };
    });
  }, titles);
}

async function main() {
  const wav = readFileSync(process.argv[2]);
  const browser = await chromium.launch();
  const covered = new Set<string>();
  const issues: string[] = [];
  let page: Page | null = null;

  for (let n = 0; n < LEARNERS; n += 1) {
    const student = await newStudent(`cta-${n}`);
    await call('PUT', '/learning-path/profile', student.token, {
      onboarded: true,
      goal: 'GENERAL',
      track: 'GENERAL',
      minutesPerDay: 15,
    });
    const quests: any[] =
      (await call('GET', '/gamification/dashboard/today', student.token)).data
        ?.quests ?? [];
    check(
      `learner ${n}: three quests today`,
      quests.length === 3,
      quests.map((q) => q.type).join(','),
    );
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    page = await context.newPage();
    page.on('pageerror', (e) =>
      issues.push(`pageerror ${e.message.slice(0, 160)}`),
    );
    page.on('response', (r) => {
      if (
        r.url().startsWith(BE) &&
        r.status() >= 400 &&
        r.status() !== 401 &&
        !/\/audio(\?|$)/.test(r.url()) &&
        // The Listening page probes the transcript and handles the 403 itself.
        !(r.status() === 403 && /\/transcript$/.test(new URL(r.url()).pathname))
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
    const buttons = await questButtons(
      page,
      quests.map((q) => String(q.title)),
    );
    if (n === 0) await page.screenshot({ path: `${SHOTS}/cta-quests.png` });

    for (const quest of quests) {
      covered.add(quest.type);
      const button = buttons.find((b) => b.title === quest.title);
      const href = button?.href ?? '';
      check(
        `${quest.type}: the button opens where it advances`,
        Boolean(QUEST_DESTINATION[quest.type]?.test(href)),
        `${button?.label} -> ${href}`,
      );
      // The page itself must load: this is what the first audit missed.
      await page.goto(`${FE}${href}`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText();
      check(
        `${quest.type}: ${href} loads`,
        !ERROR_COPY.test(text) &&
          !new URL(page.url()).pathname.startsWith('/login'),
        ERROR_COPY.exec(text)?.[0] ?? '',
      );
      const before = progressOf(student.userId);
      const done = await doActivity(quest.type, href, student.token, wav);
      await settle();
      const after = progressOf(student.userId);
      check(
        `${quest.type}: doing it (${done}) completes the quest`,
        (after.get(quest.type) ?? 0) >= Number(quest.targetValue),
        `${after.get(quest.type) ?? 0}/${quest.targetValue}`,
      );
      for (const other of quests) {
        if (other.type === quest.type) continue;
        // A perfect Listening or Reading practice also counts for that skill.
        const companion =
          (quest.type === 'PERFECT_QUIZ' &&
            ['DO_LISTENING', 'DO_READING'].includes(other.type)) ||
          (other.type === 'PERFECT_QUIZ' &&
            ['DO_LISTENING', 'DO_READING'].includes(quest.type));
        if (companion) continue;
        check(
          `${quest.type}: leaves ${other.type} unchanged`,
          (after.get(other.type) ?? 0) === (before.get(other.type) ?? 0),
          `${before.get(other.type) ?? 0} -> ${after.get(other.type) ?? 0}`,
        );
      }
    }
    await context.close();
  }

  check(
    'the learners covered every quest of the pool',
    covered.size === 6,
    [...covered].join(','),
  );

  // Dashboard "Bắt đầu" deep links: the catalog applies the promised filter.
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  page = await context.newPage();
  const any = await newStudent('cta-filter');
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', any.email);
  await page.fill('input[name="password"]', any.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
  for (const [href, label] of [
    ['/listening?mode=DICTATION', 'Nghe chép'],
    ['/reading?difficulty=ADVANCED', 'Nâng cao'],
    ['/exams?paper=TOEIC_SW', 'TOEIC S&W'],
  ]) {
    await page.goto(`${FE}${href}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const pressed = await page
      .locator('button[aria-pressed="true"]')
      .allInnerTexts();
    check(
      `${href} opens with "${label}" selected`,
      pressed.some((t) => t.includes(label)),
      JSON.stringify(pressed),
    );
  }
  await context.close();

  check(
    'no page error or API error on the way',
    issues.length === 0,
    issues.slice(0, 6).join(' | '),
  );
  await browser.close();
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
