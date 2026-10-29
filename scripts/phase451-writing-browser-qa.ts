import './qa/qa-legacy-guard';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  PrismaClient,
  QuizPublicationStatus,
  Role,
  TopicCategory,
} from '@prisma/client';

const api = process.env.WRITING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3028';
const web = process.env.WRITING_QA_FRONTEND_ORIGIN ?? 'http://127.0.0.1:3128';
const prefix = 'qa-cms-workflow-writing-final-';
const fixturePrefix = `${prefix}${Date.now()}-browser-`;
const password = `Writing451Browser!${Date.now()}`;
const screenshots = 'D:\\Study\\KLTN\\Project\\artifacts\\phase451-writing';
const prisma = new PrismaClient();
const unwrap = <T>(value: any): T => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
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
  await prisma.practiceTopic.deleteMany({
    where: { name: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await cleanup();
  await mkdir(screenshots, { recursive: true });
  const adminEmail = `${fixturePrefix}admin@breadtrans.qa`;
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      password: await bcrypt.hash(password, 10),
      role: Role.ADMIN,
    },
  });
  const topicFixtures = [
    { category: TopicCategory.WRITING_PART1, label: 'picture' },
    { category: TopicCategory.WRITING_PART2, label: 'email' },
  ];
  for (const fixture of topicFixtures) {
    if (
      !(await prisma.practiceTopic.count({
        where: { category: fixture.category },
      }))
    ) {
      await prisma.practiceTopic.create({
        data: {
          name: `${fixturePrefix}${fixture.label}-topic`,
          vietnameseName: `${fixturePrefix}${fixture.label}`,
          category: fixture.category,
          order: 0,
        },
      });
    }
  }
  const login = await request<{ access_token: string }>('/auth/login', 'POST', {
    email: adminEmail,
    password,
  });
  const email = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}email`,
      description: 'Browser Writing Email fixture',
      level: 'B1',
      type: 'WRITING_EMAIL',
    },
    login.access_token,
  );
  const picture = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}picture`,
      description: 'Browser Writing Picture fixture',
      level: 'A2',
      type: 'WRITING_PICTURE',
    },
    login.access_token,
  );
  const empty = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Browser empty Writing fixture',
      level: 'A2',
      type: 'WRITING_EMAIL',
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/writing/${email.id}/questions`,
    'POST',
    {
      type: 'WRITING',
      prompt: 'Browser initial email prompt.',
      taskType: 'EMAIL',
      level: 'B1',
      wordRange: [80, 120],
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/writing/${picture.id}/questions`,
    'POST',
    {
      type: 'WRITING',
      prompt: 'Browser picture prompt.',
      taskType: 'SENTENCE',
      level: 'A2',
      keywords: ['people', 'work'],
      sampleSentences: ['The people are working together.'],
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/writing/${email.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    login.access_token,
  );

  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  let listPass = true;
  let searchPass = true;
  let statusPass = true;
  let editorPass = true;
  let familyPass = true;
  let lifecyclePass = true;
  let responsivePass = true;
  let aiWiringPass = true;
  let aiApplyPass = true;
  let overridePass = true;

  try {
    for (const viewport of viewports) {
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
          user: { id: admin.id, email: adminEmail, role: 'ADMIN' },
        },
      );
      const page = await context.newPage();
      page.on('pageerror', (error) =>
        errors.push(`${viewport.name}: ${error.message}`),
      );
      page.on('console', (message) => {
        if (message.type() === 'error')
          errors.push(`${viewport.name}: ${message.text()}`);
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          console.error(
            `Writing browser HTTP ${response.status()} (${viewport.name}): ${response.url()}`,
          );
        }
      });
      await page.goto(`${web}/admin/writing`, {
        waitUntil: 'domcontentloaded',
      });
      try {
        await page
          .getByText(`${fixturePrefix}email`, { exact: true })
          .waitFor();
      } catch (error) {
        console.error(
          `Writing browser list debug (${viewport.name}, ${page.url()}):`,
          await page.locator('body').innerText(),
        );
        console.error('Writing browser console errors:', errors);
        await page.screenshot({
          path: `${screenshots}/${viewport.name}-list-debug.png`,
          fullPage: true,
        });
        throw error;
      }
      responsivePass &&= await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      await page.screenshot({
        path: `${screenshots}/${viewport.name}-list.png`,
        fullPage: true,
      });
      listPass &&=
        (await page.getByText('Đã xuất bản', { exact: true }).count()) > 0;
      listPass &&=
        (await page.getByText('Bản nháp', { exact: true }).count()) > 0;
      listPass &&=
        (await page.getByText('WRITING_EMAIL', { exact: true }).count()) === 0;
      listPass &&=
        (await page.getByText('WRITING_PICTURE', { exact: true }).count()) ===
        0;

      const search = page.getByPlaceholder(
        'Tìm theo tiêu đề, mô tả, trình độ...',
      );
      await search.fill(`${fixturePrefix}email`);
      searchPass &&=
        (await page
          .getByText(`${fixturePrefix}picture`, { exact: true })
          .count()) === 0;
      await search.fill('does-not-exist');
      await page
        .getByText('Không tìm thấy nội dung phù hợp.', { exact: false })
        .waitFor();
      await search.fill('');
      const status = page.locator('select').first();
      await status.selectOption('DRAFT');
      statusPass &&=
        (await page
          .getByText(`${fixturePrefix}email`, { exact: true })
          .count()) === 0;
      statusPass &&=
        (await page
          .getByText(`${fixturePrefix}picture`, { exact: true })
          .count()) > 0;
      await status.selectOption('PUBLISHED');
      statusPass &&=
        (await page
          .getByText(`${fixturePrefix}email`, { exact: true })
          .count()) > 0;
      await status.selectOption('ALL');

      await page.goto(`${web}/admin/writing/${email.id}`, {
        waitUntil: 'domcontentloaded',
      });
      try {
        await page.getByLabel('Dạng bài viết').waitFor();
      } catch (error) {
        console.error(
          `Writing browser editor debug (${viewport.name}, ${page.url()}):`,
          await page.locator('body').innerText(),
        );
        console.error('Writing browser console errors:', errors);
        await page.screenshot({
          path: `${screenshots}/${viewport.name}-email-debug.png`,
          fullPage: true,
        });
        throw error;
      }
      const fullEditor = viewport.name === 'desktop';
      editorPass &&=
        !fullEditor ||
        (await page.getByRole('button', { name: 'Gợi ý đề bài' }).count()) ===
          1;
      familyPass &&=
        (await page
          .getByText('Hình ảnh miêu tả (Picture Task)', { exact: true })
          .count()) === 0;
      familyPass &&=
        (await page
          .getByText('Email / message constraints', { exact: true })
          .count()) === 1;
      familyPass &&=
        (await page.getByText('WRITING_EMAIL', { exact: true }).count()) === 0;
      responsivePass &&= await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );

      if (fullEditor) {
        let aiBody: any = null;
        let persistenceRequests = 0;
        await page.getByRole('button', { name: 'Sửa' }).click();
        await page.route('**/admin/writing/ai/suggest-task', async (route) => {
          aiBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              taskType: 'EMAIL',
              prompt: 'Browser AI email prompt.',
              context: 'Project manager requested a new time.',
              wordRange: [90, 130],
            }),
          });
        });
        page.on('request', (request) => {
          if (
            request.method() !== 'GET' &&
            request.url().includes('/admin/skill-content/')
          )
            persistenceRequests += 1;
        });
        await page.getByRole('button', { name: 'Gợi ý đề bài' }).click();
        await page.getByRole('button', { name: 'Tạo gợi ý' }).click();
        await page.getByRole('button', { name: 'Áp dụng vào form' }).waitFor();
        await page.getByRole('button', { name: 'Áp dụng vào form' }).click();
        await page.waitForTimeout(100);
        aiWiringPass &&= aiBody?.taskType === 'EMAIL';
        aiWiringPass &&= ![
          'imageUrl',
          'r2Url',
          'objectKey',
          'presignedUrl',
        ].some((key) =>
          Object.prototype.hasOwnProperty.call(aiBody ?? {}, key),
        );
        aiApplyPass &&= persistenceRequests === 0;

        const promptField = page.locator('textarea').nth(1);
        await promptField.fill('Browser Admin override prompt.');
        overridePass &&=
          (await promptField.inputValue()) === 'Browser Admin override prompt.';
        await page.getByRole('button', { name: 'Cập nhật câu hỏi' }).click();
        await page.getByText('Đã lưu câu hỏi', { exact: true }).waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText('Browser Admin override prompt.', { exact: true })
          .waitFor();
        await page.screenshot({
          path: `${screenshots}/desktop-email-editor.png`,
          fullPage: true,
        });

        await page.getByRole('button', { name: 'Chuyển về bản nháp' }).click();
        await page
          .getByRole('button', { name: 'Chuyển về bản nháp' })
          .last()
          .click();
        try {
          await page
            .getByText('Trạng thái: Bản nháp', { exact: true })
            .waitFor();
        } catch (error) {
          console.error(
            'Writing browser lifecycle debug:',
            await page.locator('body').innerText(),
          );
          throw error;
        }
        await page.getByRole('button', { name: 'Kiểm tra & xuất bản' }).click();
        await page
          .getByRole('button', { name: 'Xuất bản', exact: true })
          .click();
        await page
          .getByText('Trạng thái: Đã xuất bản', { exact: true })
          .waitFor();
        lifecyclePass &&=
          (await page.getByRole('button', { name: 'Xóa câu hỏi' }).count()) ===
          1;
        lifecyclePass &&=
          (await page.getByRole('button', { name: 'Xóa nội dung' }).count()) ===
          0;
      }

      await page.goto(`${web}/admin/writing/${picture.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByText('Hình ảnh miêu tả (Picture Task)', { exact: true })
        .waitFor();
      familyPass &&=
        (await page
          .getByText('Email / message constraints', { exact: true })
          .count()) === 0;
      familyPass &&=
        (await page
          .getByText('Tải ảnh từ máy tính', { exact: true })
          .count()) === 1;
      familyPass &&=
        (await page
          .getByText('Đường dẫn tệp (URL kỹ thuật):', { exact: true })
          .count()) === 0;
      familyPass &&=
        (await page.getByText('WRITING_PICTURE', { exact: true }).count()) ===
        0;
      responsivePass &&= await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );

      if (fullEditor) {
        let pictureAiBody: any = null;
        await page.getByRole('button', { name: 'Sửa' }).click();
        await page.route('**/admin/writing/ai/suggest-task', async (route) => {
          pictureAiBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              taskType: 'SENTENCE',
              prompt: 'Browser AI picture sentence.',
              wordRange: [1, 20],
            }),
          });
        });
        await page.getByRole('button', { name: 'Gợi ý đề bài' }).click();
        await page.getByRole('button', { name: 'Tạo gợi ý' }).click();
        await page.getByRole('button', { name: 'Áp dụng vào form' }).waitFor();
        await page.getByRole('button', { name: 'Áp dụng vào form' }).click();
        aiWiringPass &&= pictureAiBody?.taskType === 'SENTENCE';
        aiWiringPass &&= ![
          'imageUrl',
          'r2Url',
          'objectKey',
          'presignedUrl',
        ].some((key) =>
          Object.prototype.hasOwnProperty.call(pictureAiBody ?? {}, key),
        );
        aiApplyPass &&=
          (await page
            .getByText('Hình ảnh miêu tả (Picture Task)', { exact: true })
            .count()) === 1;
        await page.getByRole('button', { name: 'Cập nhật câu hỏi' }).click();
        await page.getByText('Đã lưu câu hỏi', { exact: true }).waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText('Browser AI picture sentence.', { exact: true })
          .waitFor();
        await page.screenshot({
          path: `${screenshots}/desktop-picture-editor.png`,
          fullPage: true,
        });
      }
      await context.close();
    }

    const emptyContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await emptyContext.addInitScript(
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
        user: { id: admin.id, email: adminEmail, role: 'ADMIN' },
      },
    );
    const emptyPage = await emptyContext.newPage();
    await emptyPage.goto(`${web}/admin/writing/${empty.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await emptyPage
      .getByText('Chưa có câu hỏi nào.', { exact: false })
      .waitFor();
    assert(
      (await emptyPage
        .getByRole('button', { name: 'Thêm câu hỏi' })
        .count()) === 1,
      'Writing empty state has no create action',
    );
    await emptyContext.close();
  } finally {
    await browser.close();
  }

  assert(errors.length === 0, `Browser page errors: ${errors.join(' | ')}`);
  console.log(
    JSON.stringify(
      {
        WRITING_LIST_BROWSER_PASS: listPass,
        WRITING_SEARCH_BROWSER_PASS: searchPass,
        WRITING_STATUS_FILTER_BROWSER_PASS: statusPass,
        WRITING_TASK_TYPE_LABELS_PASS: listPass && familyPass,
        WRITING_EMAIL_EDITOR_BROWSER_PASS: editorPass,
        WRITING_PICTURE_EDITOR_BROWSER_PASS: familyPass,
        WRITING_TASK_FAMILY_FIELD_ISOLATION_PASS: familyPass,
        WRITING_EMAIL_BROWSER_SAVE_RELOAD_PASS: overridePass,
        WRITING_PICTURE_BROWSER_SAVE_RELOAD_PASS: familyPass,
        WRITING_LIFECYCLE_UI_PASS: lifecyclePass,
        WRITING_DELETE_LIFECYCLE_DISTINCT: lifecyclePass,
        WRITING_EMPTY_STATE_PASS: true,
        WRITING_ENUM_LABELS_PASS: listPass && familyPass,
        WRITING_DESKTOP_PASS: responsivePass,
        WRITING_TABLET_PASS: responsivePass,
        WRITING_MOBILE_PASS: responsivePass,
        WRITING_PHASE5B_AI_UI_PRESERVED: editorPass,
        WRITING_PHASE5B_TASK_FAMILY_WIRING_PASS: aiWiringPass,
        WRITING_AI_CANNOT_FABRICATE_MEDIA: aiWiringPass,
        WRITING_AI_APPLY_LOCAL_ONLY_PASS: aiApplyPass,
        WRITING_AI_ADMIN_OVERRIDE_UI_PASS: overridePass,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
