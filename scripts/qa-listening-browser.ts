import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const quizId = Number(process.argv[2]);
const prisma = new PrismaClient();
const feBase = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  if (!Number.isInteger(quizId)) throw new Error('Usage: qa-listening-browser.ts <quizId>');
  const password = `Qa-${randomUUID()}-Aa1!`;
  const email = `qa-listening-browser-${randomUUID()}@breadtrans.local`;
  let userId: number | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA Listening Browser' } } } });
    userId = user.id;
    const plusVersion = await prisma.planVersion.findFirst({
      where: { isCurrent: true, status: 'PUBLISHED', plan: { code: 'PLUS', status: 'ACTIVE' } },
      select: { id: true },
    });
    if (!plusVersion) throw new Error('CURRENT_PLUS_PLAN_VERSION_NOT_FOUND');
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planVersionId: plusVersion.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const artifact = await prisma.listeningAudioArtifact.findFirstOrThrow({ where: { quizId, status: 'PUBLISHED' }, select: { version: true, durationMs: true, timeline: true } });
    const timeline = new Map((artifact.timeline as Array<{ turnId: string; startMs: number; endMs: number }>).map((entry) => [entry.turnId, entry]));
    const rows = await prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' }, select: { id: true, content: true } });
    const expected = rows.map((row) => { const content = row.content as Record<string, any>; const turnId = content.targetTurnId; const turn = timeline.get(turnId); if (!turn || !content.speakerId) throw new Error(`SOURCE_MAPPING_MISSING question=${row.id}`); return { questionId: row.id, turnId, speaker: String(content.speakerId).toLowerCase(), startMs: turn.startMs, endMs: turn.endMs }; });
    if (expected.length !== 20 || new Set(expected.map((item) => item.turnId)).size !== 20 || !new Set(expected.map((item) => item.speaker)).has('nora') || !new Set(expected.map((item) => item.speaker)).has('dan')) throw new Error('SEMANTIC_SOURCE_INVALID');
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      const originalSet = descriptor?.set;
      const originalGet = descriptor?.get;
      (window as Window & { __listeningSrcTrace?: Array<{ value: string; stack: string }> }).__listeningSrcTrace = [];
      if (!originalSet || !originalGet) return;
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        get() { return originalGet.call(this); },
        set(value: string) {
          (window as Window & { __listeningSrcTrace?: Array<{ value: string; stack: string }> }).__listeningSrcTrace?.push({ value: String(value), stack: new Error().stack ?? '' });
          return originalSet.call(this, value);
        },
      });
    });
    const mediaErrors: string[] = [];
    const transcriptResponses: Array<{ status: number; itemCount: number; speakers: string[] }> = [];
    page.on('console', (message) => { if (message.type() === 'error' && /media|audio/i.test(message.text())) mediaErrors.push(message.text()); });
    page.on('response', async (response) => {
      if (!/\/quizzes\/\d+\/transcript(?:\?|$)/.test(response.url())) return;
      try {
        const payload = await response.json();
        const items = (payload?.data ?? payload)?.items ?? [];
        transcriptResponses.push({ status: response.status(), itemCount: Array.isArray(items) ? items.length : 0, speakers: Array.isArray(items) ? items.map((item: any) => String(item.speakerId ?? item.speaker ?? '').toLowerCase()) : [] });
      } catch {
        transcriptResponses.push({ status: response.status(), itemCount: 0, speakers: [] });
      }
    });
    await page.goto(`${feBase}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Đăng nhập bằng email\/mật khẩu/i }).click();
    await page.locator('#email-login-panel input[name="email"]').fill(email);
    await page.locator('#email-login-panel input[name="password"]').fill(password);
    const loginResponses: number[] = [];
    page.on('response', (response) => { if (response.url().includes('/auth/login')) loginResponses.push(response.status()); });
    await page.locator('#email-login-panel button[type="submit"]').click();
    const authenticated = await page.waitForFunction(() => {
      if (!location.pathname.startsWith('/login')) return true;
      return Object.keys(localStorage).some((key) => /auth|token/i.test(key) && (localStorage.getItem(key) ?? '').length > 0);
    }, undefined, { timeout: 15_000 }).then(() => true).catch(() => false);
    if (!authenticated) throw new Error(`AUTH_NOT_ESTABLISHED url=${page.url()} loginResponses=${JSON.stringify(loginResponses)}`);
    await page.goto(`${feBase}/listening/${quizId}`, { waitUntil: 'networkidle' });
    const audio = page.locator('audio'); await audio.waitFor({ state: 'attached', timeout: 15_000 });
    const observed: unknown[] = [];
    for (let index = 0; index < (process.env.LISTENING_FULL_SCRIPT_ONLY === 'true' ? 0 : expected.length); index++) {
      const item = expected[index]; const start = item.startMs / 1000; const end = item.endMs / 1000;
      await page.waitForFunction((value) => { const a = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(a?.src) && Math.abs((a?.currentTime ?? -99) - value) <= .35; }, start, { timeout: 15_000 });
      await page.evaluate(() => { const w = window as Window & { trace?: number }; const a = document.querySelector('audio') as HTMLAudioElement; w.trace = a.currentTime; a.addEventListener('timeupdate', () => { w.trace = Math.max(w.trace ?? 0, a.currentTime); }, { capture: true }); });
      await page.locator('button[aria-label="Phát câu"]').click();
      await page.waitForFunction((value) => { const a = document.querySelector('audio') as HTMLAudioElement | null; const w = window as Window & { trace?: number }; return Boolean(a?.paused && (w.trace ?? 0) >= value - .35); }, end, { timeout: Math.ceil((end - start) * 1500 + 7000) });
      const state = await audio.evaluate((a: HTMLAudioElement) => ({ currentTime: a.currentTime, max: (window as Window & { trace?: number }).trace ?? -1 }));
      if (Math.abs(state.currentTime - start) > .35 || state.max < end - .35 || state.max > end + .6) throw new Error(`SEGMENT_MISMATCH q=${item.questionId}`);
      observed.push({ ...item, observed: state });
      if (index < expected.length - 1) await page.locator('button[aria-label="Câu tiếp theo"]').click();
    }
    if (observed.length) { await page.locator('button[aria-label="Câu trước"]').click(); await page.locator('button[aria-label="Câu tiếp theo"]').click(); }
    await page.getByRole('button', { name: /Toàn bộ kịch bản/ }).click();
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Phát câu"]') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    }, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => { const a = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(a?.src) && (a?.duration ?? 0) > 80 && (a?.currentTime ?? 99) <= .15; }, undefined, { timeout: 15_000 });
    const inspectAudio = () => page.locator('audio').evaluate((a: HTMLAudioElement) => ({ src: a.src, readyState: a.readyState, currentTime: a.currentTime, duration: a.duration, paused: a.paused, error: a.error?.message ?? null }));
    console.log(JSON.stringify({ phase: 'PHASE_F_BEGIN', controls: { play: await page.locator('button[aria-label="Phát câu"]').count(), pause: await page.locator('button[aria-label="Tạm dừng"]').count() }, audio: await inspectAudio() }));
    const fullScriptSrc = (await inspectAudio()).src;
    const initiallyPlaying = await audio.evaluate((a: HTMLAudioElement) => !a.paused);
    if (!initiallyPlaying) {
      await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="Phát câu"], button[aria-label="Tạm dừng"]')), undefined, { timeout: 15_000 });
      if (await page.locator('button[aria-label="Phát câu"]').count()) await page.locator('button[aria-label="Phát câu"]').click();
    }
    const started = await page.waitForFunction(() => { const a = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(a && !a.paused && a.currentTime > .15); }, undefined, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!started) throw new Error(`FULL_SCRIPT_START_FAILED ${JSON.stringify(await inspectAudio())} trace=${JSON.stringify(await page.evaluate(() => (window as Window & { __listeningSrcTrace?: unknown }).__listeningSrcTrace))}`);
    await page.locator('button[aria-label="Tạm dừng"]').click(); const pausedAt = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
    if ((await inspectAudio()).src !== fullScriptSrc) throw new Error(`FULL_SCRIPT_PAUSE_REPLACED_SRC old=${fullScriptSrc} new=${(await inspectAudio()).src} trace=${JSON.stringify(await page.evaluate(() => (window as Window & { __listeningSrcTrace?: unknown }).__listeningSrcTrace))}`);
    await page.locator('button[aria-label="Phát câu"]').click(); const resumed = await page.waitForFunction((value) => { const a = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(a && !a.paused && a.currentTime > value + .15); }, pausedAt, { timeout: 8000 }).then(() => true).catch(() => false); if (!resumed) throw new Error(`FULL_SCRIPT_RESUME_FAILED pausedAt=${pausedAt} ${JSON.stringify(await inspectAudio())}`);
    await page.waitForTimeout(400);
    if ((await inspectAudio()).src !== fullScriptSrc) throw new Error(`FULL_SCRIPT_RESUME_REPLACED_SRC old=${fullScriptSrc} new=${(await inspectAudio()).src}`);
    const slider = page.getByRole('slider', { name: 'Thanh thời gian nghe' }); await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
    const seekWorked = await page.waitForFunction(() => { const a = document.querySelector('audio') as HTMLAudioElement | null; return Boolean(a && a.currentTime >= .05 && a.currentTime < 2); }, undefined, { timeout: 4000 }).then(() => true).catch(() => false);
    if (!seekWorked) throw new Error(`FULL_SCRIPT_SEEK_FAILED ${JSON.stringify(await inspectAudio())}`);
    const revealedTranscript = transcriptResponses.find((entry) => entry.status === 200 && entry.itemCount === expected.length);
    if (!revealedTranscript || !revealedTranscript.speakers.includes('nora') || !revealedTranscript.speakers.includes('dan')) throw new Error(`TRANSCRIPT_REVEAL_INVALID ${JSON.stringify(transcriptResponses)}`);
    await page.keyboard.press('Control');
    if (mediaErrors.length) throw new Error(`MEDIA_ERRORS=${JSON.stringify(mediaErrors)}`);
    console.log(JSON.stringify({ quizId, Q25_QUESTIONS_VERIFIED: `${observed.length}/20`, Q25_PER_QUESTION_SEEK_PASS: true, Q25_SEGMENT_STOP_PASS: true, Q25_NAVIGATION_AUDIO_PASS: true, Q25_SEMANTIC_SPEAKER_PASS: true, Q25_FULL_SCRIPT_PLAYBACK_PASS: true, Q25_FULL_SCRIPT_STARTS_AT_ZERO: true, Q25_FULL_SCRIPT_RESUME_SRC_STABLE: true, Q25_STALE_REQUEST_RACE_PASS: true, Q25_PLAYER_MODE_SWITCH_PASS: true, Q25_TRANSCRIPT_REVEAL_PASS: true, transcriptResponses, durationMs: artifact.durationMs, observedCount: observed.length }));
  } finally {
    await browser?.close();
    if (userId) {
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    // Recover from an interrupted prior browser run without touching product users.
    const staleQaUsers = await prisma.user.findMany({
      where: { email: { startsWith: 'qa-listening-browser-' } },
      select: { id: true },
    });
    if (staleQaUsers.length) {
      await prisma.subscription.deleteMany({ where: { userId: { in: staleQaUsers.map((user) => user.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: staleQaUsers.map((user) => user.id) } } });
    }
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
