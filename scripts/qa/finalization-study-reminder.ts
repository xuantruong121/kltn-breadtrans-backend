/**
 * The daily study reminder and the notifications row of the account menu, on
 * the disposable harness (owner 2026-11-11).
 *
 * Cron: NotificationsCronService.runStudyReminder runs here against the
 * harness database (real queries; pushes are recorded, not sent). A learner
 * with a noon habit is reminded at 12:00 and not at 20:00; a learner without
 * a habit at 20:00; a learner who studied today, a learner with nothing
 * waiting, and everybody in the quiet hours get nothing; a rerun of the hour
 * adds nothing; the text carries the learner's real open-mistake count.
 * Browser: the notifications section of the account menu is closed when the
 * menu opens, shows the unread count, and opens on a click.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-study-reminder.ts
 */
import { PrismaClient } from '@prisma/client';

import { NotificationsCronService } from '../../src/modules/notifications/notifications.cron';
import { call, check, failureCount, newStudent } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const DB = process.env.HARNESS_DB;
if (!DB) throw new Error('HARNESS_DB is required');
// The disposable cluster only; harnessQuery checks its identity as well.
const URL = `postgresql://harness:harness-disposable@127.0.0.1:5460/${DB}`;

const VN = 7 * 3_600_000;
const DAY = 86_400_000;
/** Today at `hour` Vietnam time. */
const todayAt = (hour: number, minute = 0) => {
  const start = Math.floor((Date.now() + VN) / DAY) * DAY - VN;
  return new Date(start + hour * 3_600_000 + minute * 60_000);
};
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
type Learner = Awaited<ReturnType<typeof newStudent>>;

/** Sets the streak and the last study day (days ago; 0 = today). */
function stats(u: Learner, streak: number, daysAgo: number) {
  harnessExec(
    `insert into "UserStats" ("userId", "streakCount", "lastStreakUpdate") values (${u.userId}, ${streak}, now() - interval '${daysAgo} days')
     on conflict ("userId") do update set "streakCount" = ${streak}, "lastStreakUpdate" = now() - interval '${daysAgo} days'`,
  );
}

/** Five graded items at `hour` Vietnam time on five earlier days. */
function habit(u: Learner, hour: number) {
  for (let day = 2; day <= 6; day += 1) {
    const at = new Date(todayAt(hour).getTime() - day * DAY).toISOString();
    harnessExec(
      `insert into "LearnerProgressEvent" ("userId", skill, level, "contentType", "contentId", "sourceKey", "scorePercent", "createdAt")
       values (${u.userId}, 'READING', 'BASIC', 'QUIZ', 1, 'qa-habit:${u.userId}:${day}', 70, '${at}')`,
    );
  }
}

const reminders = (u: Learner) =>
  harnessQuery(
    `select title, body, url from "Notification" where "userId" = ${u.userId} and type = 'study_reminder' order by id`,
  );

async function cron() {
  const noon = await newStudent('ntf-noon');
  const evening = await newStudent('ntf-evening');
  const done = await newStudent('ntf-done');
  const empty = await newStudent('ntf-empty');
  stats(noon, 4, 1);
  habit(noon, 12);
  stats(evening, 0, 1);
  stats(done, 6, 0);
  stats(empty, 0, 1);

  // One open mistake for the evening learner, read into the notebook.
  const topicId = Number(
    one(
      `select t.id from "GrammarTopic" t where t."publicationStatus" = 'PUBLISHED' and exists (select 1 from "GrammarQuestion" g where g."topicId" = t.id) order by t.id limit 1`,
    ),
  );
  const [qid, correct] = harnessQuery(
    `select id, "correctIndex" from "GrammarQuestion" where "topicId" = ${topicId} order by "order", id limit 1`,
  )[0];
  await call('POST', `/grammar/topics/${topicId}/attempt`, evening.token, {
    answers: { [qid]: (Number(correct) + 1) % 4 },
  });
  await call('GET', '/mistakes/summary', evening.token);
  // The grammar attempt is not skill practice, so the streak day is unchanged;
  // set it again in case the attempt touched the stats.
  stats(evening, 0, 1);

  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const pushed: number[] = [];
  const service = new NotificationsCronService(prisma, {
    createNotification: (data: any) => prisma.notification.create({ data }),
    sendPushToUser: (userId: number) => {
      pushed.push(userId);
      return Promise.resolve();
    },
  } as any);

  try {
    await service.runStudyReminder(todayAt(23, 10));
    await service.runStudyReminder(todayAt(6, 30));
    check(
      'nothing is sent in the quiet hours (23:10, 06:30)',
      [noon, evening, done, empty].every((u) => reminders(u).length === 0) &&
        pushed.length === 0,
    );

    await service.runStudyReminder(todayAt(12, 5));
    const atNoon = reminders(noon);
    check(
      'a learner with a noon habit is reminded at 12:00, with the streak in the title',
      atNoon.length === 1 &&
        atNoon[0][0] === 'Giữ chuỗi 4 ngày: hôm nay bạn chưa học' &&
        atNoon[0][2] === '/dashboard' &&
        pushed.includes(noon.userId),
      JSON.stringify(atNoon),
    );
    check(
      'a learner without a habit is not reminded at 12:00',
      reminders(evening).length === 0,
    );

    await service.runStudyReminder(todayAt(12, 40));
    check(
      'a rerun of the same hour adds nothing',
      reminders(noon).length === 1 &&
        pushed.filter((id) => id === noon.userId).length === 1,
    );

    await service.runStudyReminder(todayAt(20, 0));
    const atEight = reminders(evening);
    check(
      'a learner without a habit is reminded at 20:00, with the real mistake count',
      atEight.length === 1 &&
        atEight[0][0] === '1 lỗi đang chờ bạn ôn' &&
        atEight[0][2] === '/mistakes',
      JSON.stringify(atEight),
    );
    check(
      'the noon learner gets no second reminder at 20:00',
      reminders(noon).length === 1,
    );
    check(
      'a learner who studied today gets nothing',
      reminders(done).length === 0,
    );
    check(
      'a learner with nothing waiting gets nothing',
      reminders(empty).length === 0,
    );
    check(
      'no reminder text has an emoji',
      [...atNoon, ...atEight].every(
        (row) => !/\p{Extended_Pictographic}/u.test(row.join(' ')),
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('ntf-ui');
  harnessExec(
    `insert into "Notification" ("userId", type, title, body, url) values
     (${account.userId}, 'study_reminder', 'Giữ chuỗi 3 ngày: hôm nay bạn chưa học', 'Học một bài trước nửa đêm để giữ chuỗi.', '/dashboard'),
     (${account.userId}, 'weekly_report:qa', 'Tuần qua bạn luyện 4 bài', 'Tuần 02/11 – 08/11 bạn đã luyện 4 bài.', '/dashboard')`,
  );
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });

  const section = page.locator(
    'button[aria-controls="account-menu-notifications"]',
  );
  const openMenu = async () => {
    await page.getByRole('button', { name: 'Menu tài khoản' }).click();
    await section.waitFor({ timeout: 30_000 });
  };
  await openMenu();
  const list = page.locator('#account-menu-notifications');
  check(
    'the menu opens with the notifications closed',
    (await section.getAttribute('aria-expanded')) === 'false' &&
      (await list.count()) === 0,
    String(await section.getAttribute('aria-expanded')),
  );
  check(
    'the row shows the unread count',
    (await section.getByLabel('2 thông báo chưa đọc').count()) === 1,
    (await section.innerText()).replace(/\s+/g, ' '),
  );
  await page.screenshot({ path: `${SHOTS}/menu-notifications-closed.png` });

  await section.click();
  await list
    .getByText('Giữ chuỗi 3 ngày: hôm nay bạn chưa học')
    .waitFor({ timeout: 30_000 });
  check(
    'a click opens the list',
    (await section.getAttribute('aria-expanded')) === 'true',
  );
  await page.screenshot({ path: `${SHOTS}/menu-notifications-open.png` });

  // Close the menu and open it again: closed again.
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await section.waitFor({ state: 'detached', timeout: 30_000 });
  await openMenu();
  check(
    'opening the menu again starts closed',
    (await section.getAttribute('aria-expanded')) === 'false' &&
      (await list.count()) === 0,
  );

  check(
    'no console or network errors',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
}

void (async () => {
  await cron();
  await browserFlow();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
