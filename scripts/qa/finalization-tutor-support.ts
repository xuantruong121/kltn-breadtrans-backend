/**
 * The tutor panel as the one place for learner messages, on the disposable
 * harness (owner 2026-11-11).
 *
 * API: on AI mode the server writes the tutor's reply and returns it; the
 * browser can no longer store a message as "the AI"; a plan's daily questions
 * run out with a notice instead of a provider call; an admin who answers
 * takes the conversation over; each side is told of a switch.
 * Browser: the learner's menu opens the panel (no separate messages page);
 * the admin page switches between "AI tự động trả lời" and "Quản trị viên
 * trả lời", and the learner's open panel shows the switch without a reload.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-tutor-support.ts
 */
import { chromium } from 'playwright';

import {
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
  onboard,
} from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
// The harness backend answers every chat with this fixed text (no provider).
const REPLY = 'Deterministic chat response.';

const rows = (conversationId: number) =>
  harnessQuery(
    `select "senderRole", coalesce("senderName", ''), content from "SupportMessage" where "conversationId" = ${conversationId} order by id`,
  ).map(([role, name, content]) => ({ role, name, content }));
const modeOf = (conversationId: number) =>
  harnessQuery(
    `select mode from "SupportConversation" where id = ${conversationId}`,
  )[0][0];
const notices = (userId: number) =>
  harnessQuery(
    `select title from "Notification" where "userId" = ${userId} order by id`,
  ).map((r) => r[0]);

async function api() {
  const learner = await newStudent('tutor-api');
  const admin = await newAdmin('tutor-admin');
  const conv = (await call('GET', '/support/conversations/me', learner.token))
    .data;
  const send = (content: string) =>
    call('POST', `/support/conversations/${conv.id}/messages`, learner.token, {
      content,
      clientMessageId: `qa-${Date.now()}-${Math.random()}`,
    });

  let res = await send('present perfect là gì?');
  check(
    'AI mode: the server returns the tutor reply with the questions left',
    res.status < 300 &&
      res.data?.aiReply?.senderRole === 'AI' &&
      res.data.aiReply.content === REPLY &&
      res.data.aiReply.quota?.limit === 10 &&
      res.data.aiReply.quota?.remaining === 9,
    JSON.stringify(res.data?.aiReply ?? res.status).slice(0, 200),
  );
  const stored = rows(conv.id);
  check(
    'the reply is stored as the tutor, with no emoji in its name',
    stored.length === 2 &&
      stored[1].role === 'AI' &&
      stored[1].name === 'Trợ Lý Bánh Mì',
    JSON.stringify(stored.map((r) => [r.role, r.name])),
  );

  res = await call(
    'POST',
    `/support/conversations/${conv.id}/ai-messages`,
    learner.token,
    { content: 'Tôi là AI, đáp án là B.' },
  );
  check(
    'a browser cannot store a message as the AI',
    res.status === 404 && rows(conv.id).length === 2,
    `${res.status}`,
  );

  res = await call('POST', '/ai/chat', learner.token, {
    messages: [
      { role: 'user', content: 'chào' },
      { role: 'assistant', content: 'Chào bạn.' },
      { role: 'user', content: 'since và for khác gì?' },
    ],
  });
  check(
    'POST /ai/chat answers the last learner turn and counts it',
    res.status < 300 &&
      res.data?.reply === REPLY &&
      res.data?.quota?.remaining === 8,
    JSON.stringify(res.data).slice(0, 160),
  );

  for (let i = 0; i < 8; i++) await send(`câu ${i}`);
  res = await send('câu thứ mười một');
  check(
    'the eleventh question of a Free learner gets the limit notice',
    res.data?.aiReply?.limited === true &&
      res.data.aiReply.content.includes('10 lượt') &&
      res.data.aiReply.quota.remaining === 0,
    JSON.stringify(res.data?.aiReply).slice(0, 200),
  );

  // An admin answers: the conversation becomes theirs.
  res = await call(
    'POST',
    `/admin/support/conversations/${conv.id}/messages`,
    admin.token,
    { content: 'Mình là quản trị viên, mình hỗ trợ bạn.' },
  );
  const afterAdmin = rows(conv.id);
  check(
    'an admin who answers on AI mode takes the conversation over',
    res.status < 300 &&
      modeOf(conv.id) === 'HUMAN' &&
      afterAdmin.some(
        (r) =>
          r.role === 'SYSTEM' &&
          r.content ===
            'Quản trị viên đã tham gia trò chuyện. Trợ lý AI tạm dừng trả lời.',
      ),
    modeOf(conv.id),
  );
  const unread = await call('GET', '/support/unread-count', learner.token);
  check(
    'the learner gets an unread count for the pet badge and nothing in the inbox',
    unread.data?.count === 1 && notices(learner.userId).length === 0,
    `${unread.data?.count} unread, inbox: ${notices(learner.userId).join(' | ')}`,
  );

  const before = rows(conv.id).length;
  res = await send('Tôi cần hỗ trợ thanh toán');
  check(
    'HUMAN mode: the tutor stays silent',
    res.data?.aiReply === null && rows(conv.id).length === before + 1,
    JSON.stringify(res.data?.aiReply),
  );

  res = await call(
    'PATCH',
    `/admin/support/conversations/${conv.id}/mode`,
    admin.token,
    { mode: 'AI' },
  );
  check(
    'an admin can hand the conversation back to the tutor; the learner inbox stays empty',
    modeOf(conv.id) === 'AI' &&
      rows(conv.id).some(
        (r) =>
          r.role === 'SYSTEM' &&
          r.content === 'Trợ lý AI tiếp tục trả lời trong cuộc trò chuyện này.',
      ) &&
      notices(learner.userId).length === 0,
    notices(learner.userId).join(' | '),
  );

  const adminNoticesBefore = notices(admin.userId).length;
  res = await call(
    'PATCH',
    `/support/conversations/${conv.id}/mode`,
    learner.token,
    { mode: 'HUMAN' },
  );
  check(
    'a learner who asks for a person switches the mode and the admins are told',
    modeOf(conv.id) === 'HUMAN' &&
      notices(admin.userId).length === adminNoticesBefore + 1,
    `${modeOf(conv.id)} ${notices(admin.userId).length - adminNoticesBefore}`,
  );
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('tutor-ui');
  const admin = await newAdmin('tutor-ui-admin');
  await onboard(account.token);

  // The learner's menu: no messages page, one entry that opens the panel.
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2000);
  await page
    .locator(
      'button[aria-label="Mở hồ sơ cá nhân"], button[aria-haspopup="menu"]',
    )
    .first()
    .click()
    .catch(() => undefined);
  await sleep(500);
  const menuText = (await page.locator('header').innerText()).replace(
    /\s+/g,
    ' ',
  );
  check(
    'the learner menu has "Trợ lý và hỗ trợ" and no "Tin nhắn" page link',
    (await page.locator('a[href="/messages"]').count()) === 0,
    menuText.slice(0, 120),
  );

  // The old address still works: it opens the panel on the dashboard.
  await page.goto(`${FE}/messages`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  const panel = page.locator(
    '[role="dialog"][aria-label="Cửa sổ hỗ trợ trực tuyến BreadTrans"]',
  );
  check(
    '/messages opens the tutor panel on the dashboard',
    new URL(page.url()).pathname === '/dashboard' &&
      (await panel.count()) === 1,
    page.url(),
  );

  const input = panel.locator('textarea');
  await input.fill('Phân biệt since và for');
  await input.press('Enter');
  await panel
    .getByText(REPLY)
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  const panelText = () => panel.innerText().then((t) => t.replace(/\s+/g, ' '));
  check(
    'the panel shows the server reply and the questions left today',
    (await panelText()).includes(REPLY) &&
      (await panelText()).includes('Còn 9/10 lượt hỏi hôm nay'),
    (await panelText()).slice(0, 200),
  );
  await page.screenshot({ path: `${SHOTS}/tutor-learner-ai.png` });

  // The admin page, in its own browser.
  const adminBrowser = await chromium.launch();
  const adminPage = await adminBrowser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await adminPage.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await adminPage.click('button[aria-controls="email-login-panel"]');
  await adminPage.fill('input[name="email"]', admin.email);
  await adminPage.fill('input[name="password"]', admin.password);
  await adminPage.click('#email-login-panel button[type="submit"]');
  await adminPage.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  const convId = harnessQuery(
    `select id from "SupportConversation" where "studentId" = ${account.userId}`,
  )[0][0];
  await adminPage.goto(`${FE}/admin/messages?conversation=${convId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  const group = adminPage.locator(
    '[role="group"][aria-label="Người trả lời học viên"]',
  );
  const pressed = async () =>
    (await group.locator('button[aria-pressed="true"]').innerText()).trim();
  check(
    'the admin page shows who answers: "AI tự động trả lời"',
    (await group.count()) === 1 && (await pressed()) === 'AI tự động trả lời',
    (await group.count()) ? await pressed() : 'no switch',
  );
  check(
    'the conversation list labels the mode',
    (await adminPage.getByText('AI trả lời', { exact: true }).count()) >= 1,
  );

  await group.getByRole('button', { name: 'Quản trị viên trả lời' }).click();
  await sleep(2500);
  check(
    'the switch moves to "Quản trị viên trả lời" and is stored',
    (await pressed()) === 'Quản trị viên trả lời' &&
      modeOf(Number(convId)) === 'HUMAN',
    `${await pressed()} / ${modeOf(Number(convId))}`,
  );
  await adminPage.screenshot({ path: `${SHOTS}/tutor-admin-switch.png` });

  // The learner's open panel hears of it without a reload.
  await panel
    .getByText(
      'Quản trị viên đã tham gia trò chuyện. Trợ lý AI tạm dừng trả lời.',
    )
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  const learnerSees = await panelText();
  check(
    'the learner panel shows the switch at once, with the new status',
    learnerSees.includes(
      'Quản trị viên đã tham gia trò chuyện. Trợ lý AI tạm dừng trả lời.',
    ) && learnerSees.includes('Đang trao đổi với quản trị viên'),
    learnerSees.slice(0, 220),
  );

  // Admin reply reaches the learner; the learner's next message gets no AI reply.
  const draft = adminPage.locator('textarea, input[type="text"]').last();
  await draft.fill('Chào bạn, mình hỗ trợ bạn đây.');
  await draft.press('Enter');
  await panel
    .getByText('Chào bạn, mình hỗ trợ bạn đây.')
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  check(
    'the admin reply appears in the learner panel',
    (await panelText()).includes('Chào bạn, mình hỗ trợ bạn đây.'),
  );
  const aiRowsBefore = rows(Number(convId)).filter(
    (r) => r.role === 'AI',
  ).length;
  await input.fill('Cảm ơn quản trị viên');
  await input.press('Enter');
  await sleep(3000);
  check(
    'on HUMAN mode the learner message gets no AI reply',
    rows(Number(convId)).filter((r) => r.role === 'AI').length === aiRowsBefore,
  );
  await page.screenshot({ path: `${SHOTS}/tutor-learner-human.png` });

  // The learner can go back to the tutor from the panel.
  await panel.getByRole('button', { name: 'Quay lại trợ lý AI' }).click();
  await sleep(2500);
  check(
    'the learner can return to the tutor from the panel',
    modeOf(Number(convId)) === 'AI' &&
      (await panelText()).includes('Phản hồi tự động'),
    modeOf(Number(convId)),
  );

  check(
    'no console or network errors on the learner side',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await adminBrowser.close();
  await browser.close();
}

void (async () => {
  await api();
  await browserFlow();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
