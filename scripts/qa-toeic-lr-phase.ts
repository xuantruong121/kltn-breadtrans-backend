import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role } from '@prisma/client';

const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8);
if (!['p2-audio', 'p3-audio', 'p4-audio', 'part-navigation'].includes(phase ?? '')) throw new Error('Use --phase=p2-audio|p3-audio|p4-audio|part-navigation');
const prisma = new PrismaClient(); const marker = `qa-toeic-lr-${randomUUID()}`;
const evidence = resolve('artifacts/learner-runtime-qa.jsonl'); const base = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
let userId: number | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function log(value: Record<string, unknown>) { await mkdir(dirname(evidence), { recursive: true }); await appendFile(evidence, `${JSON.stringify({ timestamp: new Date().toISOString(), marker, phase, ...value })}\n`); }
async function main() {
  const email = `${marker}@breadtrans.local`, password = `Qa-${randomUUID()}-Aa1!`;
  try {
    const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA TOEIC LR phase' } } } }); userId = user.id;
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' }); await page.locator('[aria-controls="email-login-panel"]').click(); await page.locator('#emailInput').waitFor({ state: 'visible' }); await page.locator('#emailInput').fill(email); await page.locator('#passwordInput').fill(password);
    const login = page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST'); await page.locator('#email-login-panel button[type="submit"]').click(); const loginStatus = (await login).status();
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15000 });
    const started = await page.evaluate(async () => { const raw = sessionStorage.getItem('auth-storage-junior') ?? localStorage.getItem('auth-storage-junior'); const token = raw ? JSON.parse(raw)?.state?.accessToken : ''; const r = await fetch('http://localhost:3001/toeic/exams/1/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ mode: 'PRACTICE' }) }); const b = await r.json(); const id = b?.data?.id ?? b?.id; const begin = id ? await fetch(`http://localhost:3001/toeic/attempts/${id}/begin`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }) : null; return { id, status: r.status, beginStatus: begin?.status ?? null }; });
    if (loginStatus !== 200 || started.status !== 201 || !started.id || ![200,201].includes(Number(started.beginStatus))) throw new Error('QA_AUTH_OR_PRACTICE_START_FAILED');
    const practiceAttemptId = started.id;
    await page.goto(`${base}/toeic/attempts/${practiceAttemptId}`, { waitUntil: 'domcontentloaded' }); await page.getByText(/Part 1.*Câu/i).first().waitFor({ state: 'visible', timeout: 15000 });
    if (phase === 'part-navigation') {
      const transitions: unknown[] = [];
      for (const part of [2,3,4,5,6,7]) { await page.getByRole('button', { name: `Part ${part}`, exact: true }).click(); const header = page.getByText(new RegExp(`Part ${part}.*Câu`, 'i')).first(); await header.waitFor({ state: 'visible', timeout: 10000 }); transitions.push({ toPart: part, header: await header.textContent(), url: page.url() }); }
      await log({ test:'inter-part-navigation', route:page.url(), examId:1, attemptType:'PRACTICE', attemptId:practiceAttemptId, result:'PASS', transitions });
    } else {
      const part = Number(phase?.[1]); await page.getByRole('button', { name: `Part ${part}`, exact: true }).click(); const header = page.getByText(new RegExp(`Part ${part}.*Câu`, 'i')).first(); await header.waitFor({ state: 'visible', timeout:10000 }); await page.getByLabel('Phát audio').click();
      await page.waitForFunction(() => { const a=document.querySelector('audio'); return Boolean(a && a.currentTime>0 && !a.error); }, undefined, { timeout:20000 });
      const playback = await page.locator('audio').evaluate((node) => { const audio = node as HTMLAudioElement; return ({ started:audio.currentTime>0, currentTime:audio.currentTime, paused:audio.paused, error:!!audio.error }); });
      if (!playback.started) throw new Error(`PART_${part}_AUDIO_DID_NOT_START`);
      await log({ test:`p${part}-audio-runtime`, route:page.url(), examId:1, attemptType:'PRACTICE', attemptId:practiceAttemptId, result:'PASS', part, header:await header.textContent(), playback });
    }
  } finally { await browser?.close(); if (userId) await prisma.user.delete({ where:{id:userId} }); const orphans=await prisma.user.count({where:{email:{startsWith:'qa-toeic-lr-'}}}); await log({test:'cleanup',result:orphans===0?'PASS':'FAIL',orphanRecords:orphans,userId:userId??null}); await prisma.$disconnect(); }
}
main().catch(async (error) => { await log({test:'fatal',result:'FAIL',failure:error instanceof Error?error.message:String(error)}); console.error(error); process.exitCode=1; });
