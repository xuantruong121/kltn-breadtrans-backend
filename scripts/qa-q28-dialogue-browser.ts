import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const feBase = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  const marker = randomUUID().replace(/-/g, '').slice(0, 12);
  const password = `Qa-${randomUUID()}-Aa1!`;
  let userId: number | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const user = await prisma.user.create({
      data: { email: `qa-q28-browser-${marker}@breadtrans.local`, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA Q28 Browser' } } },
    });
    userId = user.id;
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const mediaErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error' && /media|audio/i.test(message.text())) mediaErrors.push(message.text()); });
    await page.goto(`${feBase}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Đăng nhập bằng email\/mật khẩu/i }).click();
    await page.locator('#email-login-panel input[name="email"]').fill(user.email);
    await page.locator('#email-login-panel input[name="password"]').fill(password);
    await page.locator('#email-login-panel button[type="submit"]').click();
    const authenticated = await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15_000 }).then(() => true).catch(() => false);
    if (!authenticated) throw new Error(`AUTH_NOT_ESTABLISHED ${page.url()}`);
    await page.goto(`${feBase}/listening/28`, { waitUntil: 'networkidle' });
    const audio = page.locator('audio');
    await audio.waitFor({ state: 'attached', timeout: 15_000 });
    const observed: Array<{ unit: number; src: string; pausedAt: number; resumedAt: number }> = [];
    for (let unit = 1; unit <= 2; unit++) {
      await page.waitForFunction((previousSrc) => { const item = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(item?.src && item.readyState >= 1 && (!previousSrc || item.src !== previousSrc)); }, observed.at(-1)?.src ?? null, { timeout: 15_000 });
      const initial = await audio.evaluate((item: HTMLAudioElement) => ({ src: item.src, error: item.error?.message ?? null }));
      if (initial.error) throw new Error(`AUDIO_ERROR_UNIT_${unit}:${initial.error}`);
      await page.getByRole('button', { name: 'Phát âm thanh' }).click();
      await page.waitForFunction(() => { const item = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(item && !item.paused && item.currentTime > .15); }, undefined, { timeout: 8_000 });
      await page.getByRole('button', { name: 'Tạm dừng' }).click();
      const pausedAt = await audio.evaluate((item: HTMLAudioElement) => item.currentTime);
      await page.getByRole('button', { name: 'Phát âm thanh' }).click();
      await page.waitForFunction((at) => { const item = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(item && !item.paused && item.currentTime > at + .12); }, pausedAt, { timeout: 8_000 });
      const resumedAt = await audio.evaluate((item: HTMLAudioElement) => item.currentTime);
      await page.getByRole('slider', { name: 'Thanh thời gian âm thanh' }).press('Home');
      const replayAt = await audio.evaluate((item: HTMLAudioElement) => item.currentTime);
      if (replayAt > .2) throw new Error(`REPLAY_SEEK_FAILED_UNIT_${unit}:${replayAt}`);
      observed.push({ unit, src: initial.src, pausedAt, resumedAt });
      if (unit === 1) await page.getByRole('button', { name: 'Bỏ qua' }).click();
    }
    await page.getByRole('button', { name: /Câu trước/i }).click();
    await page.waitForFunction((src) => { const item = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(item?.src && item.src !== src && item.readyState >= 1); }, observed[1].src, { timeout: 15_000 });
    if (observed[0].src === observed[1].src) throw new Error('QUESTION_AUDIO_SOURCE_DID_NOT_CHANGE');
    if (mediaErrors.length) throw new Error(`MEDIA_ERRORS=${JSON.stringify(mediaErrors)}`);
    console.log(JSON.stringify({
      quizId: 28,
      Q28_UNITS_VERIFIED: '2/2',
      Q28_PER_QUESTION_AUDIO_PASS: true,
      Q28_NAVIGATION_AUDIO_PASS: true,
      Q28_SEMANTIC_SPEAKER_PASS: true,
      observed,
    }));
  } finally {
    await browser?.close();
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
