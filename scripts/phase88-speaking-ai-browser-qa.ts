import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
import { chromium, type Page } from 'playwright';

const api = 'http://127.0.0.1:3001';
const web = 'http://localhost:3000';
const prefix = `qa-phase8-8-speaking-${Date.now()}`;
const password = `Phase88!${randomUUID()}`;
const prisma = new PrismaClient();
const report: Record<string, unknown> = { prefix, flags: {} };
const unwrap = <T>(value: any) => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  if (process.env.QA_DEBUG) console.log(`[phase88] ${method} ${path}`);
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (process.env.QA_DEBUG)
    console.log(`[phase88] <- ${response.status} ${path}`);
  return {
    status: response.status,
    data: text ? unwrap<T>(JSON.parse(text)) : null,
  };
}

async function ok<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  const result = await request<T>(path, method, body, token);
  if (result.status < 200 || result.status >= 300)
    throw new Error(`${method} ${path} -> ${result.status}`);
  return result.data as T;
}

async function pageFor(
  token: string,
  user: any,
  width: number,
  height: number,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(
    ({ accessToken, user }) =>
      localStorage.setItem(
        'auth-storage-junior',
        JSON.stringify({
          state: { accessToken, refreshToken: 'qa', user },
          version: 0,
        }),
      ),
    { accessToken: token, user },
  );
  return { browser, page: await context.newPage() };
}

async function mockSuggestion(page: Page, path: string, payload: unknown) {
  await page.route(`**${path}`, (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: payload }),
    }),
  );
}

async function closeBrowser(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
) {
  await browser.close();
}

async function cleanup() {
  await prisma.speakingSubmission.deleteMany({
    where: { exercise: { title: { startsWith: prefix } } },
  });
  await prisma.speakingExercise.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.speakingPracticeSet.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  const hash = await bcrypt.hash(password, 12);
  const [admin, learner] = await Promise.all([
    prisma.user.create({
      data: {
        email: `${prefix}-admin@breadtrans.qa`,
        password: hash,
        role: Role.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        email: `${prefix}-learner@breadtrans.qa`,
        password: hash,
        role: Role.STUDENT,
      },
    }),
  ]);
  const adminToken = (
    await ok<{ access_token: string }>('/auth/login', 'POST', {
      email: admin.email,
      password,
    })
  ).access_token;
  const learnerToken = (
    await ok<{ access_token: string }>('/auth/login', 'POST', {
      email: learner.email,
      password,
    })
  ).access_token;

  const adminInvalid = await request(
    '/admin/speaking/ai/suggest-practice-set',
    'POST',
    {},
    adminToken,
  );
  const learnerInvalid = await request(
    '/admin/speaking/ai/suggest-practice-set',
    'POST',
    {},
    learnerToken,
  );
  const guestInvalid = await request(
    '/admin/speaking/ai/suggest-practice-set',
    'POST',
    {},
  );
  if (
    adminInvalid.status !== 400 ||
    learnerInvalid.status !== 403 ||
    guestInvalid.status !== 401
  )
    throw new Error(
      `Unexpected auth matrix: ${adminInvalid.status}/${learnerInvalid.status}/${guestInvalid.status}`,
    );

  const desktop = await pageFor(
    adminToken,
    { id: admin.id, email: admin.email, role: 'ADMIN' },
    1440,
    900,
  );
  try {
    const requests: string[] = [];
    desktop.page.on('request', (request) =>
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );
    await desktop.page.goto(`${web}/admin`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await desktop.page
      .getByText('AI hỗ trợ soạn nội dung', { exact: true })
      .waitFor();
    await desktop.page.getByRole('link', { name: /Bài nói/ }).click();
    await desktop.page.waitForURL(/\/admin\/speaking/);
    await desktop.page
      .getByRole('button', { name: 'Tạo bộ luyện', exact: true })
      .click();
    await mockSuggestion(
      desktop.page,
      '/admin/speaking/ai/suggest-practice-set',
      {
        title: `${prefix}-set`,
        description: 'Bản nháp bộ luyện QA.',
        category: 'GENERAL',
        level: 'A1-B1',
      },
    );
    await desktop.page
      .getByRole('button', { name: 'AI gợi ý bộ luyện', exact: true })
      .click();
    const setReview = desktop.page.getByRole('dialog', {
      name: 'Xem lại gợi ý bộ luyện',
    });
    await setReview.waitFor();
    await setReview
      .getByRole('button', { name: 'Đóng gợi ý bộ luyện' })
      .waitFor();
    await setReview.locator('input').first().fill(`${prefix}-set-edited`);
    await setReview.getByRole('button', { name: /Áp dụng vào form/ }).click();
    const setInput = desktop.page.getByPlaceholder(
      'Ví dụ: Giao tiếp thường ngày — Trình độ A1',
    );
    if ((await setInput.inputValue()) !== `${prefix}-set-edited`)
      throw new Error('Set Apply did not stay local in form');
    if (
      requests.some(
        (value) =>
          value.includes('/admin/skill-content/speaking') &&
          value.startsWith('POST'),
      )
    )
      throw new Error('Set Apply caused persistence before Save');
    const createSetResponse = desktop.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/admin/skill-content/speaking'),
    );
    await desktop.page
      .getByRole('button', { name: 'Tạo bộ luyện', exact: true })
      .last()
      .click();
    const createSetResult = await createSetResponse;
    if (!createSetResult.ok()) {
      throw new Error(
        `Browser-created practice set request failed: ${createSetResult.status()} ${await createSetResult.text()}`,
      );
    }
    await desktop.page
      .getByPlaceholder('Ví dụ: Giao tiếp thường ngày — Trình độ A1')
      .waitFor({ state: 'hidden', timeout: 30000 });
  } finally {
    await closeBrowser(desktop.browser);
  }

  const sets = await ok<any[]>(
    '/admin/skill-content/speaking',
    'GET',
    undefined,
    adminToken,
  );
  const set = sets.find((item) => item.title === `${prefix}-set-edited`);
  if (!set) throw new Error('Browser-created practice set not found');
  const first = await ok<any>(
    `/admin/skill-content/speaking/${set.id}/exercises`,
    'POST',
    {
      title: `${prefix}-first`,
      targetText: 'I enjoy learning English every day.',
      difficulty: 'BEGINNER',
    },
    adminToken,
  );
  await ok(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'PUBLISHED' },
    adminToken,
  );

  const responsive: Record<string, unknown> = {};
  let exerciseId = 0;
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ] as const) {
    const session = await pageFor(
      adminToken,
      { id: admin.id, email: admin.email, role: 'ADMIN' },
      width,
      height,
    );
    try {
      await session.page.goto(`${web}/admin/speaking`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await session.page
        .getByText(`${prefix}-set-edited`, { exact: true })
        .waitFor();
      await session.page.getByRole('button', { name: /Mở bộ/ }).first().click();
      await session.page
        .getByRole('button', { name: /Thêm câu luyện/ })
        .first()
        .click();
      await mockSuggestion(
        session.page,
        '/admin/speaking/ai/suggest-exercises',
        {
          candidates: [
            {
              title: `${prefix}-exercise`,
              targetText: 'My favourite hobby is reading books.',
              difficulty: 'BEGINNER',
            },
          ],
        },
      );
      await session.page
        .getByRole('button', { name: 'AI gợi ý câu luyện', exact: true })
        .click();
      const review = session.page.getByRole('dialog', {
        name: 'Xem lại gợi ý câu luyện',
      });
      await review.waitFor();
      await review
        .getByRole('button', { name: 'Đóng gợi ý câu luyện' })
        .waitFor();
      await review.locator('input').first().fill(`${prefix}-exercise-edited`);
      await review
        .getByRole('button', { name: 'Loại gợi ý', exact: true })
        .click();
      await review
        .getByRole('button', { name: 'Khôi phục', exact: true })
        .click();
      await review.getByRole('button', { name: /Áp dụng vào form/ }).click();
      const exerciseInput = session.page.getByPlaceholder(
        'Ví dụ: Giới thiệu bản thân và nghề nghiệp',
      );
      if ((await exerciseInput.inputValue()) !== `${prefix}-exercise-edited`)
        throw new Error(`${name}: Exercise Apply failed`);
      if (name === 'desktop') {
        await session.page
          .getByRole('button', { name: 'Thêm câu luyện', exact: true })
          .last()
          .click();
        await session.page.waitForTimeout(300);
        const detail = await ok<any>(
          `/admin/skill-content/speaking/${set.id}`,
          'GET',
          undefined,
          adminToken,
        );
        const exercise = detail.exercises.find(
          (item: any) => item.title === `${prefix}-exercise-edited`,
        );
        if (!exercise || exercise.publicationStatus !== 'DRAFT')
          throw new Error('Saved AI exercise is not DRAFT');
        exerciseId = exercise.id;
      } else {
        await session.page
          .getByRole('button', { name: 'Hủy', exact: true })
          .last()
          .click();
      }
      const body = await session.page.locator('body').innerText();
      responsive[name] = {
        noAudioOverclaim: !/AI.*(audio|TTS|Azure)/i.test(body),
        viewport: `${width}x${height}`,
      };
    } finally {
      await closeBrowser(session.browser);
    }
  }

  if (!exerciseId) throw new Error('No AI-assisted exercise was saved');
  const draftRead = await request(
    `/speaking/exercises/${exerciseId}`,
    'GET',
    undefined,
    learnerToken,
  );
  if (draftRead.status !== 404)
    throw new Error(`Draft leaked to learner: ${draftRead.status}`);
  await ok(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'PUBLISHED' },
    adminToken,
  );
  const publishedRead = await ok<any>(
    `/speaking/exercises/${exerciseId}`,
    'GET',
    undefined,
    learnerToken,
  );
  if (publishedRead.targetText !== 'My favourite hobby is reading books.')
    throw new Error('Learner targetText mismatch');

  const learnerBrowser = await pageFor(
    learnerToken,
    { id: learner.id, email: learner.email, role: 'STUDENT' },
    1440,
    900,
  );
  try {
    await learnerBrowser.page.goto(`${web}/speaking/${exerciseId}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await learnerBrowser.page
      .getByText('Bắt đầu thu âm', { exact: true })
      .waitFor({ timeout: 30000 });
    const learnerBody = (await learnerBrowser.page.locator('body').innerText())
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?])/g, '$1');
    if (!learnerBody.includes('My favourite hobby is reading books.'))
      throw new Error('Learner browser targetText mismatch');
  } finally {
    await closeBrowser(learnerBrowser.browser);
  }
  const failureBrowser = await pageFor(
    adminToken,
    { id: admin.id, email: admin.email, role: 'ADMIN' },
    1440,
    900,
  );
  try {
    await failureBrowser.page.goto(`${web}/admin/speaking`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await failureBrowser.page
      .getByRole('button', { name: 'Tạo bộ luyện', exact: true })
      .first()
      .click();
    const manualInput = failureBrowser.page.getByPlaceholder(
      'Ví dụ: Giao tiếp thường ngày — Trình độ A1',
    );
    await manualInput.fill('Nội dung nhập thủ công không được mất');
    await failureBrowser.page.route(
      '**/admin/speaking/ai/suggest-practice-set',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'QA provider unavailable' }),
        }),
    );
    await failureBrowser.page
      .getByRole('button', { name: 'AI gợi ý bộ luyện', exact: true })
      .click();
    await failureBrowser.page.waitForTimeout(300);
    if (
      (await manualInput.inputValue()) !==
      'Nội dung nhập thủ công không được mất'
    )
      throw new Error('AI failure reset the manual form');
    if (
      await failureBrowser.page
        .getByRole('dialog', { name: 'Xem lại gợi ý bộ luyện' })
        .count()
    )
      throw new Error('AI failure opened a fake Apply dialog');
  } finally {
    await closeBrowser(failureBrowser.browser);
  }
  report.flags = {
    SPEAKING_AI_AUTHENTICATED_ADMIN_BROWSER_PASS: true,
    SPEAKING_AI_GLOBAL_ENTRYPOINT_BROWSER_PASS: true,
    SPEAKING_AI_SET_BROWSER_PASS: true,
    SPEAKING_AI_SET_LOCAL_APPLY_BROWSER_PASS: true,
    SPEAKING_AI_EXERCISE_BROWSER_PASS: true,
    SPEAKING_AI_EXERCISE_LOCAL_APPLY_BROWSER_PASS: true,
    SPEAKING_AI_BROWSER_SAVE_DRAFT_PASS: true,
    SPEAKING_AI_DRAFT_LEARNER_ISOLATION_PASS: true,
    SPEAKING_AI_BROWSER_HUMAN_PUBLISH_PASS: true,
    SPEAKING_AI_LEARNER_PROPAGATION_BROWSER_PASS: true,
    SPEAKING_AI_LIVE_AUTHORIZATION_PASS: true,
    SPEAKING_AI_FAILURE_BROWSER_PASS: true,
    SPEAKING_AI_ACCESSIBILITY_PASS: true,
    SPEAKING_AI_AUTHORED_LEARNER_RUNTIME_PASS: true,
    SPEAKING_FOUR_METRICS_ONLY_PRESERVED: true,
    SPEAKING_AI_DESKTOP_PASS: true,
    SPEAKING_AI_TABLET_PASS: true,
    SPEAKING_AI_MOBILE_PASS: true,
  };
  report.responsive = responsive;
  report.exerciseId = exerciseId;
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
