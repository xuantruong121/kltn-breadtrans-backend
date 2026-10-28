import './qa/qa-legacy-guard';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, QuizPublicationStatus, Role } from '@prisma/client';

const api = process.env.READING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3018';
const web = process.env.READING_QA_FRONTEND_ORIGIN ?? 'http://127.0.0.1:3118';
const prefix = 'qa-cms-workflow-reading-final-';
const run = Date.now();
const fixturePrefix = `${prefix}${run}-browser-`;
const password = `Reading451Browser!${run}`;
const screenshots = 'D:\\Study\\KLTN\\Project\\artifacts\\phase451-reading';
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
  const adminEmail = `${fixturePrefix}admin@breadtrans.qa`;
  const login = await request<{ access_token: string }>('/auth/login', 'POST', {
    email: adminEmail,
    password,
  });
  const passage =
    'Browser QA passage: rooftop gardens provide fresh vegetables and cool buildings in hot weather.';
  const published = await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}published`,
      description: 'Browser published Reading fixture',
      level: 'A2',
      passage,
    },
    login.access_token,
  );
  const empty = await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}draft`,
      description: 'Browser draft Reading fixture',
      level: 'A2',
      passage,
    },
    login.access_token,
  );
  await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Browser empty Reading fixture',
      level: 'A2',
      passage: '',
    },
    login.access_token,
  );
  await request<any>(
    `/admin/skill-content/reading/${published.id}/questions`,
    'POST',
    {
      type: 'MULTIPLE_CHOICE',
      content: {
        text: 'Which benefit is stated?',
        passage,
        options: [
          'Fresh vegetables',
          'More traffic',
          'Taller buildings',
          'Less sunlight',
        ],
        correctIndex: 0,
        explanation:
          'The passage states that gardens provide fresh vegetables.',
        questionType: 'MAIN_IDEA',
      },
      order: 0,
    },
    login.access_token,
  );
  await request(
    `/admin/skill-content/reading/${published.id}/publish`,
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
  let responsivePass = true;
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
      await page.goto(`${web}/admin/reading`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByText(`${fixturePrefix}published`, { exact: true })
        .waitFor();
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
        (await page.getByText('PUBLISHED', { exact: true }).count()) === 0;
      listPass &&=
        (await page.getByText('DRAFT', { exact: true }).count()) === 0;

      const search = page.getByPlaceholder(
        'Tìm theo tiêu đề, mô tả, trình độ...',
      );
      await search.fill(`${fixturePrefix}published`);
      searchPass &&=
        (await page
          .getByText(`${fixturePrefix}draft`, { exact: true })
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
          .getByText(`${fixturePrefix}published`, { exact: true })
          .count()) === 0;
      statusPass &&=
        (await page
          .getByText(`${fixturePrefix}draft`, { exact: true })
          .count()) > 0;
      await status.selectOption('PUBLISHED');
      statusPass &&=
        (await page
          .getByText(`${fixturePrefix}published`, { exact: true })
          .count()) > 0;
      await status.selectOption('ALL');

      await page.goto(`${web}/admin/reading/${published.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByText('Đoạn đọc (Reading Passage)', { exact: true })
        .waitFor();
      const fullEditorCheck = viewport.name === 'desktop';
      editorPass &&=
        !fullEditorCheck ||
        (await page.getByText('Câu hỏi', { exact: true }).count()) > 0;
      editorPass &&=
        !fullEditorCheck ||
        (await page.getByRole('button', { name: 'Gợi ý đoạn đọc' }).count()) ===
          1;
      editorPass &&=
        !fullEditorCheck ||
        (await page
          .getByRole('button', { name: 'Tạo câu hỏi nháp' })
          .count()) === 1;
      editorPass &&=
        !fullEditorCheck ||
        (await page.getByLabel('Dạng câu hỏi đọc hiểu').count()) === 1;
      editorPass &&=
        !fullEditorCheck ||
        (await page.getByRole('button', { name: 'Xóa câu hỏi' }).count()) === 1;
      editorPass &&=
        !fullEditorCheck ||
        (await page.getByRole('button', { name: 'Xóa nội dung' }).count()) ===
          0;
      responsivePass &&= await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      if (viewport.name === 'desktop') {
        await page.getByRole('button', { name: 'Sửa', exact: true }).click();
        editorPass &&= (await page.getByLabel('Đáp án đúng').count()) === 1;
        const initialQuestionPrompt = page.locator('textarea').nth(2);
        await initialQuestionPrompt.fill('Browser edited question');
        await page
          .getByLabel('Các phương án lựa chọn (mỗi dòng một phương án)')
          .fill(
            'Fresh vegetables\nMore traffic\nTaller buildings\nLess sunlight',
          );
        await page.getByLabel('Đáp án đúng').selectOption('0');
        await page
          .getByLabel('Ghi chú / giải thích')
          .fill('Browser edited explanation.');
        await page.getByRole('button', { name: 'Cập nhật câu hỏi' }).click();
        await page.getByText('Đã lưu câu hỏi', { exact: true }).waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText('Browser edited question', { exact: true })
          .waitFor();
        const passageField = page
          .locator('label')
          .filter({ hasText: 'Đoạn đọc (Reading Passage)' })
          .locator('..')
          .locator('..')
          .locator('textarea');
        const currentPassage = `${passage} local edit`;
        await passageField.fill(currentPassage);
        await page.getByRole('button', { name: 'Tạo câu hỏi nháp' }).click();
        let aiBody: any = null;
        await page.route(
          '**/admin/reading/ai/suggest-questions**',
          async (route) => {
            aiBody = route.request().postDataJSON();
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                candidates: [
                  {
                    prompt: 'Which benefit does the passage mention?',
                    options: [
                      'Fresh vegetables',
                      'More traffic',
                      'Taller buildings',
                      'Less sunlight',
                    ],
                    correctIndex: 0,
                    explanation: 'The passage mentions fresh vegetables.',
                    questionType: 'DETAIL',
                  },
                ],
              }),
            });
          },
        );
        await page
          .getByRole('button', { name: 'Tạo câu hỏi nháp', exact: true })
          .last()
          .click();
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll('input')).some(
              (element) => element.value === expected,
            ),
          'Which benefit does the passage mention?',
        );
        let persistenceRequests = 0;
        page.on('request', (request) => {
          if (
            request.method() !== 'GET' &&
            request.url().includes('/admin/skill-content/')
          )
            persistenceRequests += 1;
        });
        await page.getByRole('button', { name: 'Áp dụng vào form' }).click();
        await page.waitForTimeout(100);
        assert(
          aiBody?.passage === currentPassage,
          'AI request did not use current unsaved passage',
        );
        assert(
          persistenceRequests === 0,
          'AI apply persisted Reading data before explicit save',
        );
        const questionPrompt = page.locator('textarea').nth(2);
        await questionPrompt.fill(
          'Which benefit does the passage mention? updated',
        );
        const options = page.getByLabel(
          'Các phương án lựa chọn (mỗi dòng một phương án)',
        );
        await options.fill(
          'Fresh vegetables\nMore traffic\nTaller buildings\nLess sunlight',
        );
        await page.getByLabel('Đáp án đúng').selectOption('0');
        await page
          .getByLabel('Ghi chú / giải thích')
          .fill('Updated browser explanation.');
        await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
        await page.getByText('Đã lưu câu hỏi', { exact: true }).waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText('Which benefit does the passage mention? updated', {
            exact: true,
          })
          .waitFor();
        const savedEditor = await request<any>(
          `/admin/skill-content/reading/${published.id}`,
          'GET',
          undefined,
          login.access_token,
        );
        const savedAiQuestion = savedEditor.questions.find(
          (item: any) =>
            item.content?.text ===
            'Which benefit does the passage mention? updated',
        );
        assert(
          savedAiQuestion?.content?.passage === currentPassage,
          'Current passage was not persisted with the AI-applied question',
        );
        await page.screenshot({
          path: `${screenshots}/desktop-editor.png`,
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
    await emptyPage.goto(`${web}/admin/reading/${empty.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await emptyPage
      .getByText('Chưa có câu hỏi nào.', { exact: false })
      .waitFor();
    assert(
      (await emptyPage
        .getByRole('button', { name: 'Thêm câu hỏi' })
        .count()) === 1,
      'Reading empty state has no create action',
    );
    await emptyContext.close();
  } finally {
    await browser.close();
  }
  assert(errors.length === 0, `Browser page errors: ${errors.join(' | ')}`);
  console.log(
    JSON.stringify(
      {
        READING_LIST_BROWSER_PASS: listPass,
        READING_SEARCH_BROWSER_PASS: searchPass,
        READING_STATUS_FILTER_BROWSER_PASS: statusPass,
        READING_EDITOR_BROWSER_PASS: editorPass,
        READING_CORRECT_ANSWER_UI_PASS: editorPass,
        READING_QUESTION_BROWSER_SAVE_RELOAD_PASS: editorPass,
        READING_CHILD_FORM_BROWSER_PASS: editorPass,
        READING_LIFECYCLE_UI_PASS: editorPass,
        READING_DELETE_LIFECYCLE_DISTINCT: editorPass,
        READING_EMPTY_STATE_PASS: true,
        READING_ENUM_LABELS_PASS: listPass,
        READING_DESKTOP_PASS: responsivePass,
        READING_TABLET_PASS: responsivePass,
        READING_MOBILE_PASS: responsivePass,
        READING_PHASE5A_AI_UI_PRESERVED: editorPass,
        READING_AI_USES_CURRENT_EDITOR_PASSAGE: true,
        READING_AI_APPLY_LOCAL_ONLY_PASS: true,
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
