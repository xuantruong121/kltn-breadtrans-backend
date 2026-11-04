/**
 * The "AI kiểm định đáp án" block on /admin/costs against
 * GET /admin/system-costs/ai-review, on the disposable harness.
 *
 * Fixture: today's telemetry hash in the harness Redis gets 1,000,000 input
 * and 1,000,000 output Groq tokens, which must price at $0.7500. The fields
 * are put back to their earlier values afterwards.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/ai-review-costs-browser.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { FE, hidePet } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/ai-costs`;
const KEY = `ai:answer-review:telemetry:${new Date().toISOString().slice(0, 10)}`;
const PREFIX = 'openai-compatible|openai/gpt-oss-120b';
const FIXTURE: Record<string, number> = {
  requests: 4,
  ok: 3,
  unavailable: 1,
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  latency_ms: 8_000,
};

const redis = (...args: string[]) =>
  execFileSync('docker', ['exec', 'harness-redis', 'redis-cli', ...args], {
    encoding: 'utf8',
  }).trim();

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const before = Object.fromEntries(
    Object.keys(FIXTURE).map((m) => [m, redis('HGET', KEY, `${PREFIX}|${m}`)]),
  );
  check(
    'no earlier Groq counters today (so the fixture alone sets the figures)',
    Object.values(before).every((v) => v === ''),
    JSON.stringify(before),
  );
  for (const [metric, value] of Object.entries(FIXTURE))
    redis('HINCRBY', KEY, `${PREFIX}|${metric}`, String(value));

  try {
    const learner = await newStudent('ai-costs');
    const denied = await call(
      'GET',
      '/admin/system-costs/ai-review',
      learner.token,
    );
    check(
      'a learner cannot read AI costs',
      denied.status === 403,
      String(denied.status),
    );

    const admin = await newAdmin('ai-costs-admin');
    const res = await call(
      'GET',
      '/admin/system-costs/ai-review?days=1',
      admin.token,
    );
    check('admin reads AI costs', res.status === 200, String(res.status));
    const groq = res.data?.models?.find(
      (m: any) =>
        m.provider === 'openai-compatible' && m.model === 'openai/gpt-oss-120b',
    );
    check(
      'the Groq row sums the fixture',
      groq?.requests === 4 && groq?.ok === 3,
      JSON.stringify(groq),
    );
    check(
      'it prices at 0.15 + 0.60 USD',
      Math.abs((groq?.costUsd ?? 0) - 0.75) < 1e-9,
      String(groq?.costUsd),
    );
    const missing = (res.data?.models ?? []).filter(
      (m: any) => m.tokensMissing,
    );
    check(
      'a model without token counts has no cost',
      missing.every((m: any) => m.costUsd === null),
      String(missing.length),
    );

    const browser = await chromium.launch();
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${FE}/login`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      await page.click('button[aria-controls="email-login-panel"]');
      await page.fill('input[name="email"]', admin.email);
      await page.fill('input[name="password"]', admin.password);
      await page.click('#email-login-panel button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
        timeout: 60_000,
        waitUntil: 'commit',
      });
      await page.goto(`${FE}/admin/costs`);
      await hidePet(page);
      const section = page.getByRole('region', {
        name: 'AI kiểm định đáp án theo nhà cung cấp',
      });
      await section.waitFor({ timeout: 60_000 });
      const refetch = page.waitForResponse((r) =>
        r.url().includes('ai-review?days=1'),
      );
      await section.getByRole('button', { name: 'Hôm nay' }).click();
      check(`${width}px: "Hôm nay" refetches`, (await refetch).ok());
      await section
        .getByText('Groq (OpenAI-compatible)')
        .waitFor({ timeout: 30_000 });
      const text = await section.innerText();
      check(
        `${width}px: the Groq row is shown`,
        text.includes('openai/gpt-oss-120b'),
      );
      check(`${width}px: its cost is $0.7500`, text.includes('$0.7500'));
      if (missing.length)
        check(
          `${width}px: missing token counts are named`,
          text.includes('không có số liệu'),
        );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      check(
        `${width}px: no sideways page scroll`,
        overflow <= 0,
        String(overflow),
      );
      await section.screenshot({ path: `${SHOTS}/ai-costs-${width}.png` });
      await page.close();
    }
    await browser.close();
  } finally {
    for (const metric of Object.keys(FIXTURE)) {
      const field = `${PREFIX}|${metric}`;
      if (before[metric] === '') redis('HDEL', KEY, field);
      else redis('HSET', KEY, field, before[metric]);
    }
  }

  const failed = failureCount();
  console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
