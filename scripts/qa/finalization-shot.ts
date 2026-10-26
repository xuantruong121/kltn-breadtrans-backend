/**
 * Harness-only helper: log in a STUDENT (fresh by default) and save
 * screenshots plus the links/buttons of the given routes.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-shot.ts <outDir> <route> [route...]
 *   HARNESS_EMAIL / HARNESS_PASSWORD reuse an existing harness account.
 *   HARNESS_WIDTH sets the viewport width (default 1366).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const FE = 'http://localhost:3100';
const BE = 'http://localhost:3101';

async function main() {
  const [outDir, ...routes] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  let email = process.env.HARNESS_EMAIL;
  let password = process.env.HARNESS_PASSWORD;
  if (!email || !password) {
    email = `shot-${randomUUID().slice(0, 8)}@harness.local`;
    password = `Harness-${randomUUID().slice(0, 8)}-Aa1!`;
    const reg = await fetch(`${BE}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, fullName: 'Harness Learner' }),
    });
    if (!reg.ok) throw new Error(`register ${reg.status}`);
  }
  const width = Number(process.env.HARNESS_WIDTH ?? 1366);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  const index: any[] = [];
  for (const route of routes) {
    await page
      .goto(FE + route, { waitUntil: 'networkidle', timeout: 90_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1500);
    const name =
      route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
    await page.screenshot({
      path: join(outDir, `${name}.png`),
      fullPage: true,
    });
    const links = await page.$$eval('a[href]', (as) =>
      [...new Set(as.map((a) => a.getAttribute('href')))].slice(0, 80),
    );
    const buttons = await page.$$eval('button', (bs) =>
      bs
        .map((b) => (b.textContent ?? '').trim())
        .filter(Boolean)
        .slice(0, 60),
    );
    index.push({ route, finalUrl: page.url().replace(FE, ''), links, buttons });
  }
  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify({ email, index }, null, 2),
  );
  await browser.close();
  console.log(`saved ${routes.length} pages to ${outDir} (account ${email})`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
