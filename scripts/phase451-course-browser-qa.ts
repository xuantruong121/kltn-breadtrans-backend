import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const api = 'http://127.0.0.1:3001';
const frontend = 'http://localhost:3108';
const prefix = `qa-cms-workflow-course-final-${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Phase451!${randomUUID()}`;
const playwright = require(
  join(
    'D:/Study/KLTN/Project/kltn-breadtrans-frontend-junior',
    'node_modules/playwright',
  ),
);

const text = {
  all: 'T\u1ea5t c\u1ea3',
  cancel: 'H\u1ee7y',
  coursePublish: 'Xu\u1ea5t b\u1ea3n kh\u00f3a h\u1ecdc',
  coursePublishConfirm: 'Xu\u1ea5t b\u1ea3n kh\u00f3a h\u1ecdc?',
  createLesson: 'T\u1ea1o b\u00e0i h\u1ecdc m\u1edbi',
  draft: 'B\u1ea3n nh\u00e1p',
  edit: 'S\u1eeda',
  exercises: 'B\u00e0i luy\u1ec7n t\u1eadp',
  finalCheck: 'Ki\u1ec3m tra cu\u1ed1i b\u00e0i',
  guided: 'Luy\u1ec7n t\u1eadp c\u00f3 h\u01b0\u1edbng d\u1eabn',
  lessonPublish: 'Xu\u1ea5t b\u1ea3n b\u00e0i h\u1ecdc',
  lessonPublishConfirm: 'Xu\u1ea5t b\u1ea3n b\u00e0i h\u1ecdc?',
  preview: 'Xem tr\u01b0\u1edbc b\u00e0i h\u1ecdc',
  ai: 'G\u1ee3i \u00fd ch\u01b0\u01a1ng tr\u00ecnh h\u1ecdc',
  question: 'Th\u00eam c\u00e2u h\u1ecfi',
};

const unwrap = <T>(value: unknown) =>
  ((value as { data?: T } | null)?.data ?? value) as T;
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

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
  const raw = await response.text();
  const data = raw ? unwrap<T>(JSON.parse(raw)) : (undefined as T);
  if (!response.ok)
    throw new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`,
    );
  return data;
}

async function cleanup() {
  await prisma.course.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function createFixture(token: string) {
  const course = await request<any>(
    '/admin/courses',
    'POST',
    {
      title: `${prefix}-course`,
      description: 'Browser Course fixture',
      level: 'BEGINNER',
    },
    token,
  );
  const emptyCourse = await request<any>(
    '/admin/courses',
    'POST',
    {
      title: `${prefix}-empty-course`,
      description: 'Empty Course fixture',
      level: 'BEGINNER',
    },
    token,
  );
  const lessonA = await request<any>(
    `/admin/courses/${course.id}/studio/lessons`,
    'POST',
    {
      title: `${prefix}-lesson-a`,
      slug: `${prefix}-lesson-a`,
      summary: 'Lesson A summary',
      learningObjectives: ['Browser fixture objective'],
    },
    token,
  );
  const lessonB = await request<any>(
    `/admin/courses/${course.id}/studio/lessons`,
    'POST',
    {
      title: `${prefix}-lesson-b`,
      slug: `${prefix}-lesson-b`,
      summary: 'Lesson B summary',
      learningObjectives: ['Second browser fixture objective'],
    },
    token,
  );
  const section = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/sections`,
    'POST',
    {
      type: 'THEORY',
      heading: 'Browser fixture section',
      content: { text: 'Browser fixture content' },
      isRequired: true,
    },
    token,
  );
  const guided = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/exercises`,
    'POST',
    {
      slug: 'guided-practice',
      type: 'MULTIPLE_CHOICE',
      title: 'Guided Practice fixture',
      prompt: 'Guided practice prompt',
      content: {},
      required: true,
      order: 0,
    },
    token,
  );
  const finalCheck = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/exercises`,
    'POST',
    {
      slug: 'final-check',
      type: 'MULTIPLE_CHOICE',
      title: 'Final Check fixture',
      prompt: 'Final check prompt',
      content: {},
      required: true,
      order: 1,
    },
    token,
  );
  for (const [exercise, prompt] of [
    [guided, 'Guided question'],
    [finalCheck, 'Final question'],
  ] as const)
    await request(
      `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/exercises/${exercise.id}/questions`,
      'POST',
      {
        prompt,
        options: ['Correct choice', 'Incorrect choice'],
        correctAnswer: 'Correct choice',
        explanation: `${prompt} explanation`,
      },
      token,
    );
  return { course, emptyCourse, lessonA, lessonB, section };
}

async function main() {
  let browser: any;
  try {
    await cleanup();
    const admin = await prisma.user.create({
      data: {
        email: `${prefix}@breadtrans.qa`,
        password: await bcrypt.hash(password, 10),
        role: Role.ADMIN,
      },
    });
    const login = await request<{ access_token: string }>(
      '/auth/login',
      'POST',
      { email: admin.email, password },
    );
    const fixture = await createFixture(login.access_token);
    const directList = await request<any[]>(
      '/admin/courses',
      'GET',
      undefined,
      login.access_token,
    );
    assert(
      directList.some((row) => row.id === fixture.course.id),
      'Admin Course list misses fixture before browser navigation',
    );

    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(
      ({ token, admin }: any) => {
        localStorage.setItem(
          'auth-storage-junior',
          JSON.stringify({
            state: {
              accessToken: token,
              refreshToken: 'qa-browser-refresh-not-used',
              user: { id: admin.id, email: admin.email, role: 'ADMIN' },
            },
            version: 0,
          }),
        );
      },
      { token: login.access_token, admin },
    );
    const page = await context.newPage();
    const browserRequests: Array<{
      url: string;
      status: number;
      body: unknown;
    }> = [];
    page.on('response', async (response: any) => {
      const url = new URL(response.url());
      if (
        response.request().method() === 'GET' &&
        url.pathname === '/admin/courses'
      ) {
        try {
          browserRequests.push({
            url: response.url(),
            status: response.status(),
            body: unwrap(await response.json()),
          });
        } catch {}
      }
    });

    await page.goto(`${frontend}/admin/courses`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .getByText(fixture.course.title, { exact: true })
      .waitFor({ timeout: 15_000 });
    const listResponse = browserRequests.at(-1);
    const listBody = Array.isArray(listResponse?.body)
      ? listResponse?.body
      : [];
    assert(
      listResponse?.status === 200 &&
        listBody.some((row: any) => row.id === fixture.course.id),
      'Browser Course list request did not return fixture',
    );
    const courseCard = page
      .locator('div.rounded-2xl')
      .filter({ hasText: fixture.course.title })
      .first();
    const state: Record<string, boolean | string> = {};
    state.list =
      (await courseCard.count()) === 1 &&
      (await courseCard.innerText()).includes(text.draft);
    state.noRawListStatus = !(await courseCard.innerText()).includes('DRAFT');
    const search = page.locator('input[placeholder]').first();
    await search.fill(fixture.course.title);
    state.searchMatch =
      (await page.getByText(fixture.course.title, { exact: true }).count()) ===
      1;
    await search.fill('not-a-course-fixture');
    state.searchMiss =
      (await page.getByText(fixture.course.title, { exact: true }).count()) ===
      0;
    await search.fill('');
    await page.getByRole('button', { name: text.draft, exact: true }).click();
    state.draftFilter =
      (await page.getByText(fixture.course.title, { exact: true }).count()) ===
      1;
    await page.getByRole('button', { name: text.all, exact: true }).click();
    state.filterVocabulary =
      !(await page.locator('body').innerText()).includes('PENDING_REVIEW') &&
      !(await page.locator('body').innerText()).includes('REJECTED');

    await page.goto(
      `${frontend}/admin/courses/${fixture.course.id}/curriculum`,
      { waitUntil: 'domcontentloaded' },
    );
    await page
      .getByText(fixture.lessonA.title, { exact: true })
      .waitFor({ timeout: 15_000 });
    const curriculumBody = await page.locator('body').innerText();
    state.curriculum =
      curriculumBody.includes(text.draft) &&
      curriculumBody.includes(text.createLesson) &&
      curriculumBody.includes('M\u1edf Editor');
    state.reorderDelete =
      (await page.locator('[title="Di chuy\u1ec3n l\u00ean"]').count()) > 0 &&
      (await page.locator('[title="X\u00f3a b\u00e0i h\u1ecdc"]').count()) > 0;
    await page
      .getByRole('button', { name: text.coursePublish, exact: true })
      .click();
    await page.getByText(text.coursePublishConfirm, { exact: true }).waitFor();
    state.coursePublishConfirm = true;
    await page
      .getByRole('button', { name: text.cancel, exact: true })
      .last()
      .click();
    await page.getByRole('button', { name: text.ai, exact: true }).click();
    await page.getByText(text.ai, { exact: true }).last().waitFor();
    state.aiControl = true;
    await page
      .locator(
        '[aria-label="\u0110\u00f3ng g\u1ee3i \u00fd ch\u01b0\u01a1ng tr\u00ecnh h\u1ecdc"]',
      )
      .click();
    await page
      .getByRole('button', { name: text.createLesson, exact: true })
      .click();
    const createModal = page.locator('div.fixed.inset-0').last();
    state.createLesson =
      (await createModal.locator('input').count()) >= 1 &&
      (await createModal.locator('textarea').count()) >= 1;
    await createModal
      .getByRole('button', { name: text.cancel, exact: true })
      .click();

    await page.goto(
      `${frontend}/admin/courses/${fixture.course.id}/lessons/${fixture.lessonA.id}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page
      .getByText(fixture.section.heading, { exact: true })
      .waitFor({ timeout: 15_000 });
    const editorBody = await page.locator('body').innerText();
    state.editorTabs =
      editorBody.includes(text.exercises) &&
      editorBody.includes('N\u1ed9i dung b\u00e0i h\u1ecdc') &&
      editorBody.includes('Th\u00f4ng tin chung') &&
      editorBody.includes(text.preview);
    state.noRawEditorStatus =
      !editorBody.includes('DRAFT') && editorBody.includes(text.draft);
    const sectionCard = page
      .locator('div.rounded-xl')
      .filter({ hasText: fixture.section.heading })
      .first();
    await sectionCard
      .getByRole('button', { name: text.edit, exact: true })
      .click();
    const sectionModal = page.locator('div.fixed.inset-0').last();
    state.sectionEditor =
      (await sectionModal.locator('select').count()) === 1 &&
      (await sectionModal.locator('input').count()) >= 1 &&
      !(await sectionModal.innerText()).includes('Kh\u00f3a h\u1ecdc');
    await sectionModal
      .getByRole('button', { name: text.cancel, exact: true })
      .click();
    await page
      .getByRole('button', { name: text.exercises, exact: false })
      .click();
    await page.getByText(text.guided, { exact: false }).waitFor();
    state.exerciseLabels =
      (await page.locator('body').innerText()).includes(text.guided) &&
      (await page.locator('body').innerText()).includes(text.finalCheck);
    await page
      .getByRole('button', { name: text.question, exact: true })
      .first()
      .click();
    const questionModal = page.locator('div.fixed.inset-0').last();
    state.questionEditor =
      (await questionModal.locator('input').count()) >= 4 &&
      (await questionModal.locator('select').count()) === 1 &&
      !(await questionModal.innerText()).includes('Kh\u00f3a h\u1ecdc');
    await questionModal
      .getByRole('button', { name: text.cancel, exact: true })
      .click();
    await page
      .getByRole('button', { name: text.lessonPublish, exact: true })
      .click();
    await page.getByText(text.lessonPublishConfirm, { exact: true }).waitFor();
    state.lessonPublishConfirm = true;
    await page
      .getByRole('button', { name: text.cancel, exact: true })
      .last()
      .click();

    await page.goto(
      `${frontend}/admin/courses/${fixture.emptyCourse.id}/curriculum`,
      { waitUntil: 'domcontentloaded' },
    );
    await page
      .getByText(
        'Kh\u00f3a h\u1ecdc ch\u01b0a c\u00f3 b\u00e0i h\u1ecdc n\u00e0o.',
        { exact: false },
      )
      .waitFor({ timeout: 15_000 });
    state.emptyState = (await page.locator('body').innerText()).includes(
      text.createLesson,
    );

    for (const [name, size] of [
      ['desktop', [1440, 900]],
      ['tablet', [768, 1024]],
      ['mobile', [390, 844]],
    ] as const) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.goto(
        `${frontend}/admin/courses/${fixture.course.id}/curriculum`,
        { waitUntil: 'domcontentloaded' },
      );
      await page
        .getByText(fixture.lessonA.title, { exact: true })
        .waitFor({ timeout: 15_000 });
      const layout = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      state[`${name}Responsive`] = layout.scrollWidth <= layout.width + 1;
    }
    for (const [name, value] of Object.entries(state))
      assert(value === true, `Browser Course QA failed: ${name}=${value}`);
    console.log(
      JSON.stringify(
        {
          prefix,
          courseId: fixture.course.id,
          lessonId: fixture.lessonA.id,
          courseBrowserWorkflow: true,
          state,
          request: { url: listResponse?.url, status: listResponse?.status },
        },
        null,
        2,
      ),
    );
    await context.close();
  } finally {
    if (browser) await browser.close();
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
