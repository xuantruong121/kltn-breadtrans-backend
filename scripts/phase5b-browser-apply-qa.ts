import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
import { chromium, type Page } from 'playwright';

const api = 'http://127.0.0.1:3001';
const web = process.env.PHASE5B_FRONTEND_URL ?? 'http://127.0.0.1:3101';
const prisma = new PrismaClient();
const run = Date.now();
const prefix = `qa-cms-phase5b-browser-${run}`;
const password = `Phase5b!${randomUUID()}`;
const report: Record<string, unknown> = { run };

const unwrap = (value: any) => (value && 'data' in value ? value.data : value);
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? unwrap(JSON.parse(text)) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(json)}`);
  return json;
}
async function login(email: string) {
  return call('/auth/login', 'POST', { email, password }).then((value) => value.access_token as string);
}
async function pageFor(token: string, user: any, width: number, height: number) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('auth-storage-junior', JSON.stringify({ state: { accessToken: token, refreshToken: 'qa', user }, version: 0 }));
  }, { token, user });
  return { browser, page: await context.newPage() };
}
function domainMutations(requests: string[]) {
  return requests.filter((value) => /\/(studio\/lessons|skill-content)\b/.test(value) && !/\/ai\//.test(value));
}
async function cleanup() {
  await prisma.$transaction([
    prisma.quiz.deleteMany({ where: { title: { startsWith: 'qa-cms-phase5b-browser-' } } }),
    prisma.course.deleteMany({ where: { title: { startsWith: 'qa-cms-phase5b-browser-' } } }),
    prisma.user.deleteMany({ where: { email: { startsWith: 'qa-cms-phase5b-browser-' } } }),
  ]);
}
async function withSuggestion(page: Page, path: string, payload: unknown, action: () => Promise<void>) {
  await page.route(`**${path}`, (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: payload }) }));
  await action();
}

async function main() {
  await cleanup();
  const email = `${prefix}-admin@breadtrans.qa`;
  const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 12), role: Role.ADMIN } });
  const token = await login(email);
  const course = await call('/courses', 'POST', { title: `${prefix}-course`, level: 'A2', description: 'QA' }, token);
  const listening = await call('/admin/skill-content/listening', 'POST', { title: `${prefix}-listening`, level: 'A2' }, token);
  const writing = await call('/admin/skill-content/writing', 'POST', { title: `${prefix}-writing`, type: 'WRITING_EMAIL', level: 'A2' }, token);
  const results: Record<string, unknown> = {};

  for (const [name, url, aiPath, trigger, response, apply] of [
    ['course', `/admin/courses/${course.id}/curriculum`, '/admin/courses/ai/suggest-curriculum', 'Gợi ý chương trình học', { candidates: [{ title: 'AI title', summary: 'AI summary', objectives: ['AI objective'] }] }, 'Áp dụng vào form bài học'],
    ['listening', `/admin/listening/${listening.id}`, '/admin/listening/ai/suggest-content', 'Gợi ý nội dung nghe', { mode: 'DIALOGUE', turns: [{ speaker: 'A', text: 'AI transcript', translation: 'Bản dịch' }, { speaker: 'B', text: 'Reply', translation: 'Phản hồi' }] }, 'Áp dụng vào form'],
    ['writing', `/admin/writing/${writing.id}`, '/admin/writing/ai/suggest-task', 'Gợi ý đề bài', { taskType: 'EMAIL', prompt: 'AI prompt', wordRange: [50, 80], keywords: ['AI'] }, 'Áp dụng vào form'],
  ] as const) {
    console.error(`[phase5b-browser] ${name}: launch`);
    const { browser, page } = await pageFor(token, { id: user.id, email, role: 'ADMIN' }, 1440, 900);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    console.error(`[phase5b-browser] ${name}: navigate`);
    await page.goto(`${web}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.error(`[phase5b-browser] ${name}: wait trigger`);
    await page.getByRole('button', { name: trigger, exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: trigger, exact: true }).click();
    console.error(`[phase5b-browser] ${name}: mock suggestion`);
    await withSuggestion(page, aiPath, response, async () => {
      await page.getByRole('button', { name: 'Tạo gợi ý', exact: true }).click();
    });
    console.error(`[phase5b-browser] ${name}: apply`);
    await page.getByRole('button', { name: apply, exact: true }).click();
    const mutations = domainMutations(requests);
    if (mutations.length) throw new Error(`${name} Apply caused mutation: ${mutations.join(', ')}`);
    results[name] = { aiRequest: requests.some((request) => request.includes(aiPath)), applyOnlyMutations: mutations.length };
    await page.screenshot({ path: `../kltn-breadtrans-frontend-junior/artifacts/phase5b-${name}-desktop.png`, fullPage: true });
    await browser.close();
  }
  report.applyOnly = results;
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await cleanup(); await prisma.$disconnect(); });
