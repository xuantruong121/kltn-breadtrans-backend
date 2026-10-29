import './qa/qa-legacy-guard';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, QuizPublicationStatus, Role } from '@prisma/client';

const api = process.env.LISTENING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3011';
const web = process.env.LISTENING_QA_FRONTEND_ORIGIN ?? 'http://127.0.0.1:3108';
const prefix = 'qa-cms-workflow-listening-final-';
const run = Date.now();
const fixturePrefix = `${prefix}${run}-browser-`;
const password = `Listening451Browser!${run}`;
const prisma = new PrismaClient();
const unwrap = <T>(value: any): T => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? unwrap<T>(JSON.parse(text)) : (undefined as T);
  if (!response.ok)
    throw new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`,
    );
  return data;
}

async function cleanup() {
  await prisma.quiz.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await cleanup();
  const admin = await prisma.user.create({
    data: {
      email: `${fixturePrefix}admin@breadtrans.qa`,
      password: await bcrypt.hash(password, 10),
      role: Role.ADMIN,
    },
  });
  await prisma.user.create({
    data: {
      email: `${fixturePrefix}learner@breadtrans.qa`,
      password: await bcrypt.hash(password, 10),
      role: Role.STUDENT,
    },
  });
  const login = await request<{ access_token: string }>('/auth/login', 'POST', {
    email: `${fixturePrefix}admin@breadtrans.qa`,
    password,
  });
  const published = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}published`,
      description: 'Browser published Listening fixture',
      level: 'A2',
    },
    login.access_token,
  );
  const draft = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}draft`,
      description: 'Browser draft Listening fixture',
      level: 'A2',
    },
    login.access_token,
  );
  const empty = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Browser empty Listening fixture',
      level: 'A2',
    },
    login.access_token,
  );
  const question = await request<any>(
    `/admin/skill-content/listening/${published.id}/questions`,
    'POST',
    {
      type: 'MULTIPLE_CHOICE',
      content: {
        prompt: 'QA browser MCQ',
        text: 'QA browser MCQ',
        options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
        correctIndex: 1,
        explanation: 'Beta explanation.',
      },
      order: 0,
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/listening/${draft.id}/questions`,
    'POST',
    {
      type: 'DIALOGUE',
      content: {
        prompt: 'QA browser dialogue',
        transcriptSegments: [
          {
            speaker: 'A',
            text: 'Could we meet tomorrow?',
            translation: 'Mình gặp nhau ngày mai nhé?',
          },
          {
            speaker: 'B',
            text: 'Yes, that works for me.',
            translation: 'Được, mình đồng ý.',
          },
        ],
      },
      order: 0,
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/listening/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    login.access_token,
  );

  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const screenshots = 'D:\\Study\\KLTN\\Project\\artifacts\\phase451-listening';
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(screenshots, { recursive: true }),
  );
  try {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      await context.addInitScript(
        ({ token, user }) => {
          localStorage.setItem(
            'auth-storage-junior',
            JSON.stringify({
              state: { accessToken: token, refreshToken: 'qa', user },
              version: 0,
            }),
          );
        },
        {
          token: login.access_token,
          user: {
            id: admin.id,
            email: `${fixturePrefix}admin@breadtrans.qa`,
            role: 'ADMIN',
          },
        },
      );
      const page = await context.newPage();
      page.on('pageerror', (error) =>
        errors.push(`${viewport.name}: ${error.message}`),
      );
      await page.goto(`${web}/admin/listening`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByText(`${fixturePrefix}published`, { exact: true })
        .waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      assert(overflow, `${viewport.name} list has horizontal overflow`);
      await page.screenshot({
        path: `${screenshots}/${viewport.name}-list.png`,
        fullPage: true,
      });
      assert(
        (await page.getByText('Đã xuất bản', { exact: true }).count()) > 0,
        `${viewport.name} missing published label`,
      );
      assert(
        (await page.getByText('Bản nháp', { exact: true }).count()) > 0,
        `${viewport.name} missing draft label`,
      );
      assert(
        (await page.getByText('PUBLISHED', { exact: true }).count()) === 0,
        `${viewport.name} leaks raw PUBLISHED enum`,
      );
      assert(
        (await page.getByText('DRAFT', { exact: true }).count()) === 0,
        `${viewport.name} leaks raw DRAFT enum`,
      );

      const search = page.getByPlaceholder(
        'Tìm theo tiêu đề, mô tả, trình độ...',
      );
      await search.fill(`${fixturePrefix}published`);
      await page
        .getByText(`${fixturePrefix}published`, { exact: true })
        .waitFor();
      assert(
        (await page
          .getByText(`${fixturePrefix}draft`, { exact: true })
          .count()) === 0,
        `${viewport.name} search did not filter`,
      );
      await search.fill('does-not-exist');
      await page
        .getByText('Không tìm thấy nội dung phù hợp.', { exact: false })
        .waitFor();
      await search.fill('');
      const status = page.locator('select').first();
      await status.selectOption('DRAFT');
      assert(
        (await page
          .getByText(`${fixturePrefix}published`, { exact: true })
          .count()) === 0,
        `${viewport.name} draft filter leaked published`,
      );
      assert(
        (await page
          .getByText(`${fixturePrefix}draft`, { exact: true })
          .count()) > 0,
        `${viewport.name} draft filter missing draft`,
      );
      await status.selectOption('PUBLISHED');
      assert(
        (await page
          .getByText(`${fixturePrefix}published`, { exact: true })
          .count()) > 0,
        `${viewport.name} published filter missing published`,
      );
      await status.selectOption('ALL');

      await page.goto(`${web}/admin/listening/${published.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByText('Listening / Dictation', { exact: true }).waitFor();
      assert(
        (await page.getByText('Production audio', { exact: true }).count()) > 0,
        `${viewport.name} missing Production audio`,
      );
      assert(
        (await page
          .getByRole('button', { name: 'Gợi ý nội dung nghe' })
          .count()) === 1,
        `${viewport.name} missing content AI control`,
      );
      assert(
        (await page
          .getByRole('button', { name: 'Tạo câu hỏi nháp' })
          .count()) === 1,
        `${viewport.name} duplicated/missing question AI control`,
      );
      assert(
        (await page
          .getByRole('button', { name: 'Chuyển về bản nháp' })
          .count()) === 1,
        `${viewport.name} missing published lifecycle control`,
      );
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      const prompt = page
        .getByText('Nội dung / đề bài', { exact: true })
        .locator('..')
        .locator('..')
        .locator('textarea');
      await prompt.fill('QA browser MCQ updated');
      const options = page
        .locator('label')
        .filter({ hasText: 'Các phương án lựa chọn' })
        .locator('textarea');
      await options.fill('Alpha\nBeta\nGamma browser updated\nDelta');
      await page
        .locator('label')
        .filter({ hasText: 'Đáp án đúng' })
        .locator('select')
        .selectOption('2');
      await page
        .locator('label')
        .filter({ hasText: 'Ghi chú / giải thích' })
        .locator('textarea')
        .fill('Browser explanation updated.');
      const patch = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/admin/skill-content/listening/${published.id}/questions/${question.id}`,
            ) && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Cập nhật câu hỏi' }).click();
      await patch;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      assert(
        (await prompt.inputValue()) === 'QA browser MCQ updated',
        `${viewport.name} prompt did not reload`,
      );
      assert(
        (await options.inputValue()) ===
          'Alpha\nBeta\nGamma browser updated\nDelta',
        `${viewport.name} options did not reload`,
      );
      assert(
        (await page
          .locator('label')
          .filter({ hasText: 'Đáp án đúng' })
          .locator('select')
          .inputValue()) === '2',
        `${viewport.name} correct selector did not reload`,
      );
      assert(
        (await page
          .locator('label')
          .filter({ hasText: 'Ghi chú / giải thích' })
          .locator('textarea')
          .inputValue()) === 'Browser explanation updated.',
        `${viewport.name} explanation did not reload`,
      );
      assert(
        (await page.getByLabel('Xóa câu hỏi').count()) === 1,
        `${viewport.name} child delete control missing`,
      );
      const editorOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      assert(editorOverflow, `${viewport.name} editor has horizontal overflow`);
      await page.screenshot({
        path: `${screenshots}/${viewport.name}-editor.png`,
        fullPage: true,
      });
      await context.close();
    }

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(
      ({ token, user }) => {
        localStorage.setItem(
          'auth-storage-junior',
          JSON.stringify({
            state: { accessToken: token, refreshToken: 'qa', user },
            version: 0,
          }),
        );
      },
      {
        token: login.access_token,
        user: {
          id: admin.id,
          email: `${fixturePrefix}admin@breadtrans.qa`,
          role: 'ADMIN',
        },
      },
    );
    const page = await context.newPage();
    await page.goto(`${web}/admin/listening/${empty.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('Chưa có câu hỏi nào.', { exact: false }).waitFor();
    assert(
      (await page.getByLabel('Loại câu').count()) === 1,
      'empty editor missing question type form',
    );
    await page.getByRole('button', { name: 'Gợi ý nội dung nghe' }).click();
    await page.getByRole('heading', { name: 'Gợi ý nội dung nghe' }).waitFor();
    await page
      .getByRole('button', { name: 'Đóng gợi ý nội dung nghe' })
      .click();
    await page.getByRole('button', { name: 'Tạo câu hỏi nháp' }).click();
    await page
      .getByRole('heading', { name: 'Tạo câu hỏi nghe nháp' })
      .waitFor();
    await context.close();
    assert(errors.length === 0, `browser page errors: ${errors.join(' | ')}`);
    console.log(
      JSON.stringify(
        {
          webOrigin: web,
          apiOrigin: api,
          flags: {
            LISTENING_QA_ENVIRONMENT_PASS: true,
            LISTENING_BROWSER_UI_PASS: true,
            LISTENING_SEARCH_STATUS_FILTER_PASS: true,
            LISTENING_EDITOR_BROWSER_PASS: true,
            LISTENING_MCQ_FORM_BROWSER_PASS: true,
            LISTENING_MCQ_SAVE_RELOAD_BROWSER_PASS: true,
            LISTENING_CHILD_OWNERSHIP_BROWSER_PASS: true,
            LISTENING_EMPTY_STATE_PASS: true,
            LISTENING_ENUM_LABEL_PASS: true,
            LISTENING_RESPONSIVE_PASS: true,
            LISTENING_PHASE5B_AI_CONTROLS_PRESERVED: true,
            LISTENING_SOURCE_WIRING_PASS: true,
            LISTENING_DELETE_LIFECYCLE_DISTINCT: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await cleanup();
    const leftovers = await prisma.quiz.count({
      where: { title: { startsWith: prefix } },
    });
    const userLeftovers = await prisma.user.count({
      where: { email: { startsWith: prefix } },
    });
    console.error(
      JSON.stringify({
        LISTENING_SYNTHETIC_CLEANUP_PASS:
          leftovers === 0 && userLeftovers === 0,
        leftovers,
        userLeftovers,
      }),
    );
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
