import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const feBase = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
const marker = `qa-r2-browser-${randomUUID()}`;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  const password = `Browser-${randomUUID()}-Aa1!`;
  const email = `${marker}@breadtrans.local`;
  let userId: number | undefined;
  let accessToken: string | undefined;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const pro = await prisma.planVersion.findFirstOrThrow({
      where: { isCurrent: true, status: 'PUBLISHED', plan: { code: 'PRO' } },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email, password: await bcrypt.hash(password, 10), role: Role.STUDENT,
        emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA Browser Recovery' } },
      },
    });
    userId = user.id;
    await prisma.subscription.create({
      data: {
        userId, planVersionId: pro.id, status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        try {
          failedResponses.push(`${response.status()}:${new URL(response.url()).pathname}`);
        } catch {
          failedResponses.push(`${response.status()}:unknown`);
        }
      }
    });
    await page.goto(`${feBase}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('[aria-controls="email-login-panel"]').click();
    await page.locator('#emailInput').fill(email);
    await page.locator('#passwordInput').fill(password);
    await page.locator('#email-login-panel button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    const courseResults: Record<string, unknown> = {};
    for (const courseId of [1, 8, 12]) {
      const lesson = await prisma.courseLesson.findFirstOrThrow({
        where: { courseId, status: 'PUBLISHED' }, orderBy: { order: 'asc' }, select: { id: true },
      });
      const response = await page.goto(`${feBase}/my-courses/${courseId}/lessons/${lesson.id}`, { waitUntil: 'networkidle' });
      const body = await page.locator('body').innerText();
      const imageCount = await page.locator('img').count();
      const brokenImages = await page.locator('img').evaluateAll((images) =>
        images.filter((image) => {
          const img = image as HTMLImageElement;
          return !img.complete || img.naturalWidth === 0;
        }).length,
      );
      courseResults[String(courseId)] = {
        httpStatus: response?.status() ?? null,
        blank: body.trim().length === 0,
        notFoundText: /không tìm thấy|lỗi tải/i.test(body),
        imageCount,
        brokenImages,
      };
    }
    const coreRoutes = [
      '/dashboard',
      '/plans',
      '/courses',
      '/flashcard',
      '/listening',
      '/speaking',
      '/reading',
      '/writing',
      '/grammar',
      '/exams',
      '/diagnostic',
      '/market',
      '/arena',
      '/hub',
      '/toeic/assessments',
    ];
    const coreRouteResults: Record<string, unknown> = {};
    for (const route of coreRoutes) {
      const response = await page.goto(`${feBase}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_000);
      const body = await page.locator('body').innerText();
      const htmlLength = await page.locator('body').evaluate((element) => element.innerHTML.length);
      coreRouteResults[route] = {
        httpStatus: response?.status() ?? null,
        blank: body.trim().length === 0,
        htmlLength,
        notFoundText: /không tìm thấy trang|lỗi ứng dụng|application error/i.test(body),
      };
    }
    const listeningResponse = await page.goto(`${feBase}/listening/25`, { waitUntil: 'networkidle' });
    const audio = page.locator('audio').first();
    await page
      .waitForFunction(
        () => Boolean(document.querySelector('audio')?.getAttribute('src')),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    const audioCount = await page.locator('audio').count();
    const audioSource = audioCount ? await audio.getAttribute('src') : null;
    if (Object.values(courseResults).some((value: any) => value.httpStatus !== 200 || value.blank || value.notFoundText || value.brokenImages > 0)) {
      throw new Error('Course browser smoke failed');
    }
    if (Object.values(coreRouteResults).some((value: any) => value.httpStatus !== 200 || value.blank || value.notFoundText)) {
      throw new Error(`Core learner route browser smoke failed: ${JSON.stringify({ coreRouteResults, consoleErrors, failedResponses, failedRequests: failedRequests.map((url) => new URL(url).pathname) })}`);
    }
    if (listeningResponse?.status() !== 200 || !audioSource) {
      throw new Error(
        `Dictation browser audio source was not rendered (status=${listeningResponse?.status() ?? 'none'}, audioCount=${audioCount}, failedRequests=${JSON.stringify(failedRequests.map((url) => new URL(url).pathname))}, failedResponses=${JSON.stringify(failedResponses)})`,
      );
    }
    console.log(JSON.stringify({
      LEARNER_BROWSER_SMOKE: 'PASS',
      courseResults,
      coreRouteResults,
      dictation: { status: listeningResponse.status(), audioCount, audioSourcePresent: Boolean(audioSource) },
      consoleErrorCount: consoleErrors.length,
      failedRequestCount: failedRequests.length,
    }));
  } finally {
    await browser?.close();
    if (userId) {
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
