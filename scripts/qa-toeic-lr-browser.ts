import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const marker = `qa-toeic-lr-${randomUUID()}`;
const evidence = resolve('artifacts/learner-runtime-qa.jsonl');
const base = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
let userId: number | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function log(value: Record<string, unknown>) { await mkdir(dirname(evidence), { recursive: true }); await appendFile(evidence, `${JSON.stringify({ timestamp: new Date().toISOString(), marker, ...value })}\n`); }
async function main() {
  const email = `${marker}@breadtrans.local`; const password = `Qa-${randomUUID()}-Aa1!`;
  try {
    const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA TOEIC LR' } } } }); userId = user.id;
    await log({ test: 'setup', route: '/toeic/1', user: marker, result: 'PASS', userId });
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const loginStatuses: number[] = [];
    let runtimeExam: { groups?: Array<{ part: number; imageUrl?: string | null; audioUrl?: string | null; questions?: unknown[] }> } | undefined;
    page.on('response', response => { if (response.url().includes('/auth/login')) loginStatuses.push(response.status()); });
    page.on('response', response => {
      if (!/\/toeic\/attempts\/\d+$/.test(new URL(response.url()).pathname) || response.request().method() !== 'GET') return;
      void response.json().then((body) => { runtimeExam = body?.data?.exam ?? body?.exam; }).catch(() => undefined);
    });
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    const emailToggle = page.locator('[aria-controls="email-login-panel"]');
    await emailToggle.click();
    await page.locator('#emailInput').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#emailInput').fill(email);
    await page.locator('#passwordInput').fill(password);
    const loginResponse = page.waitForResponse((response) => response.url().includes('/auth/login') && response.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.locator('#email-login-panel button[type="submit"]').click();
    const loginResponseStatus = (await loginResponse)?.status() ?? null;
    const authenticated = await page.waitForFunction(() => {
      if (!location.pathname.startsWith('/login')) return true;
      return Object.keys(localStorage).some(key => /auth|token/i.test(key) && (localStorage.getItem(key) ?? '').length > 0);
    }, undefined, { timeout: 15000 }).then(() => true).catch(() => false);
    const loginError = await page.locator('[role="alert"]').allTextContents();
    await log({ test: 'auth', route: page.url(), result: authenticated ? 'PASS' : 'FAIL', loginStatuses, loginResponseStatus, loginError, authStateEstablished: authenticated });
    if (!authenticated) throw new Error(`AUTH_NOT_ESTABLISHED statuses=${JSON.stringify(loginStatuses)} url=${page.url()}`);
    await page.goto(`${base}/toeic/1`, { waitUntil: 'networkidle' });
    const warning = await page.getByText(/chưa đủ điều kiện.*Full Test/i).count();
    const start = page.getByRole('button', { name: /Bắt đầu làm bài/i });
    const enabled = await start.isEnabled(); await log({ test: 'briefing', route: '/toeic/1', result: warning === 0 && enabled ? 'PASS' : 'FAIL', warning, enabled });
    if (warning || !enabled) throw new Error('BRIEFING_GATE_FAILED');
    await start.click(); await page.waitForURL(/\/toeic\/attempts\//, { timeout: 20000 });
    const attemptId = Number(page.url().match(/attempts\/(\d+)/)?.[1]); if (!attemptId) throw new Error('ATTEMPT_NOT_CREATED');
    const attempt = await prisma.toeicAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { examId: true, mode: true } });
    await log({ test: 'launch', route: page.url(), result: attempt.examId === 1 ? 'PASS' : 'FAIL', attemptId, examId: attempt.examId, mode: attempt.mode });
    if (attempt.examId !== 1) throw new Error('WRONG_EXAM');
    await page.waitForFunction(() => document.querySelectorAll('article').length > 0, undefined, { timeout: 15000 });
    await page.waitForTimeout(300);
    const distribution = (runtimeExam?.groups ?? []).reduce<Record<string, number>>((counts, group) => {
      counts[`P${group.part}`] = (counts[`P${group.part}`] ?? 0) + (group.questions?.length ?? 0);
      return counts;
    }, {});
    const expected = { P1: 6, P2: 25, P3: 39, P4: 30, P5: 30, P6: 16, P7: 54 };
    const distributionPass = Object.entries(expected).every(([part, count]) => distribution[part] === count);
    const p1Groups = (runtimeExam?.groups ?? []).filter((group) => group.part === 1);
    const p1MediaPass = p1Groups.length === 6 && p1Groups.every((group) => Boolean(group.imageUrl) && Boolean(group.audioUrl));
    await log({ test: 'runtime-structure', route: page.url(), result: distributionPass && p1MediaPass ? 'PASS' : 'FAIL', attemptId, distribution, expected, p1GroupCount: p1Groups.length, p1MediaPass });
    if (!distributionPass || !p1MediaPass) throw new Error('RUNTIME_STRUCTURE_FAILED');
    const partOneVisible = await page.getByText(/Part 1.*Câu 1/i).count();
    const visibleP1Image = await page.locator('img[alt="Hình minh họa Part 1"]').count();
    const audioStarted = await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && audio.currentTime > 0 && !audio.error);
    }, undefined, { timeout: 20000 }).then(() => true).catch(() => false);
    await log({ test: 'p1-audio-image-runtime', route: page.url(), result: Boolean(partOneVisible && visibleP1Image && audioStarted) ? 'PASS' : 'FAIL', attemptId, partOneVisible, visibleP1Image, audioStarted });
    if (!partOneVisible || !visibleP1Image || !audioStarted) throw new Error('P1_RUNTIME_MEDIA_FAILED');
    const firstAnswer = page.locator('article button').first();
    await firstAnswer.click();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'networkidle' });
    const answerPersisted = await page.locator('article button.border-amber-500').count() > 0;
    const partNav = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async (part) => ({ part, present: await page.getByRole('button', { name: `Part ${part}`, exact: true }).count() === 1 })));
    const navigationContractPass = partNav.every(({ present }) => present);
    await log({ test: 'p1-answer-and-navigation', route: page.url(), result: answerPersisted && navigationContractPass ? 'PASS' : 'FAIL', attemptId, answerPersisted, partNav, note: 'Full Test intentionally locks future sections while Listening audio is in progress.' });
    if (!answerPersisted || !navigationContractPass) throw new Error('ANSWER_OR_NAVIGATION_FAILED');
    const practiceStart = await page.evaluate(async () => {
      const stored = sessionStorage.getItem('auth-storage-junior') ?? localStorage.getItem('auth-storage-junior');
      const accessToken = stored ? JSON.parse(stored)?.state?.accessToken : null;
      const response = await fetch('http://localhost:3001/toeic/exams/1/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` },
        body: JSON.stringify({ mode: 'PRACTICE' }),
      });
      const body = await response.json().catch(() => null);
      const id = body?.data?.id ?? body?.id ?? null;
      if (!id) return { status: response.status, id: null, beginStatus: null };
      const begin = await fetch(`http://localhost:3001/toeic/attempts/${id}/begin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken ?? ''}` },
      });
      return { status: response.status, id, beginStatus: begin.status };
    });
    if (practiceStart.status !== 201 || !practiceStart.id || ![200, 201].includes(practiceStart.beginStatus ?? 0)) throw new Error(`PRACTICE_START_FAILED:${practiceStart.status}/${practiceStart.beginStatus}`);
    await log({ test: 'practice-start', route: `/toeic/attempts/${practiceStart.id}`, result: 'PASS', practiceAttemptId: practiceStart.id, practiceBeginStatus: practiceStart.beginStatus });
    await page.goto(`${base}/toeic/attempts/${practiceStart.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('article').length > 0, undefined, { timeout: 15000 });
    const partPlayback: Array<{ part: number; audioPlaying: boolean }> = [];
    for (const part of [1, 2, 3, 4]) {
      await page.getByRole('button', { name: `Part ${part}`, exact: true }).click();
      await page.getByText(new RegExp(`Part ${part}.*Câu`, 'i')).first().waitFor({ state: 'visible', timeout: 10000 });
      if (part > 1) await page.getByLabel('Phát audio').click();
      const audioPlaying = await page.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return Boolean(audio && audio.currentTime > 0 && !audio.error);
      }, undefined, { timeout: 20000 }).then(() => true).catch(() => false);
      partPlayback.push({ part, audioPlaying });
    }
    const allPartNavigation = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async (part) => {
      await page.getByRole('button', { name: `Part ${part}`, exact: true }).click();
      return { part, visible: await page.getByText(new RegExp(`Part ${part}.*Câu`, 'i')).first().isVisible() };
    }));
    const listeningRuntimePass = partPlayback.every(({ audioPlaying }) => audioPlaying);
    const practiceNavigationPass = allPartNavigation.every(({ visible }) => visible);
    await log({ test: 'practice-listening-and-navigation', route: page.url(), result: listeningRuntimePass && practiceNavigationPass ? 'PASS' : 'FAIL', practiceAttemptId: practiceStart.id, partPlayback, allPartNavigation });
    if (!listeningRuntimePass || !practiceNavigationPass) throw new Error('PRACTICE_MEDIA_OR_NAVIGATION_FAILED');
  } finally { await browser?.close(); if (userId) await prisma.user.delete({ where: { id: userId } }); await log({ test: 'cleanup', result: 'PASS', userId: userId ?? null }); await prisma.$disconnect(); }
}
main().catch(async error => { await log({ test: 'fatal', result: 'FAIL', failure: error instanceof Error ? error.message : String(error) }); console.error(error); process.exitCode = 1; });
