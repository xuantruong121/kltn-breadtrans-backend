/**
 * CP61 compact audit: open every Admin page on the harness (FE :3100) at 1440
 * and 390 px and record console errors, failed API calls, horizontal overflow,
 * internal wording and retired-style classes. It finds what shows on load, not
 * what only appears after a click, so a clean row is not proof a page works.
 *
 * Detail pages are reached through links on the list pages. One no link leads
 * to is NOT_RUN, or is set by hand: QA_EXTRA="/admin/exams/[id]=/admin/exams/2".
 * In Git Bash also set MSYS2_ENV_CONV_EXCL=QA_EXTRA.
 *
 * Usage:
 *   QA_FE_DIR=<frontend checkout> QA_OUT=<file.json> \
 *     npx ts-node --transpile-only scripts/qa/cp61-admin-crawl.ts
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { chromium, type Page } from 'playwright';

import { BE, newAdmin } from './harness-api';
import { FE } from './harness-browser';

const INTERNAL_WORDING: Array<[string, RegExp]> = [
  ['raw-enum', /\b[A-Z]{3,}(?:_[A-Z]{2,})+\b/g],
  [
    'english-ui',
    /\b(?:Loading\.\.\.|Submit|Cancel|Save|Delete|Edit|Search|Publish|Unpublish|Retry|Unauthorized|Forbidden|No data)\b/g,
  ],
  [
    'raw-error',
    /(?:Request failed|status code \d|AxiosError|Internal Server Error|undefined|\bNaN\b)/g,
  ],
];
const SLOP_SELECTOR =
  '[class*="rounded-[2.5rem]"],[class*="border-4"],.lucide-sparkles,.lucide-wand-2,.lucide-bot';

function adminRoutes(root: string): string[] {
  const base = join(root, 'src', 'app', '(admin)');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx')
        found.push(
          `/${relative(base, dir).split(sep).join('/')}`.replace(/\/$/, ''),
        );
    }
  };
  walk(base);
  return found.sort();
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 180_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
}

void (async () => {
  const feDir = process.env.QA_FE_DIR;
  const out = process.env.QA_OUT;
  if (!feDir || !out) throw new Error('QA_FE_DIR and QA_OUT are required');
  if (!FE.includes('localhost:3100') || !BE.includes('localhost:3101'))
    throw new Error('REFUSED: this crawl only runs on the harness');

  const routes = adminRoutes(feDir);
  const fixed = routes.filter((r) => !r.includes('['));
  const dynamic = routes.filter((r) => r.includes('['));
  const admin = await newAdmin('cp61-crawl');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await login(page, admin.email, admin.password);

  let current: { console: string[]; api: string[] } = { console: [], api: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') current.console.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) =>
    current.console.push(`pageerror ${e.message.slice(0, 200)}`),
  );
  page.on('response', (r) => {
    if (r.url().startsWith(BE) && r.status() >= 400)
      current.api.push(`${r.status()} ${r.url().replace(BE, '')}`);
  });

  const hrefs = new Set<string>();
  const results: unknown[] = [];
  const visit = async (route: string, url: string, width: number) => {
    current = { console: [], api: [] };
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${FE}${url}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    });
    await page
      .waitForLoadState('networkidle', { timeout: 12_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    const state = await page.evaluate((selector) => {
      const text = document.body.innerText.replace(/\s+/g, ' ');
      return {
        text,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        slop: [...document.querySelectorAll(selector)]
          .slice(0, 4)
          .map((e) => (e.getAttribute('class') ?? '').slice(0, 80)),
        links: [...document.querySelectorAll('a[href^="/admin"]')].map(
          (a) => a.getAttribute('href') as string,
        ),
      };
    }, SLOP_SELECTOR);
    state.links.forEach((link) => hrefs.add(link));
    const wording: string[] = [];
    for (const [rule, re] of INTERNAL_WORDING)
      for (const m of state.text.matchAll(re)) wording.push(`${rule}: ${m[0]}`);
    results.push({
      route,
      url,
      width,
      landed: new URL(page.url()).pathname,
      console: [...new Set(current.console)],
      api: [...new Set(current.api)],
      overflow: state.overflow,
      slop: state.slop,
      wording: [...new Set(wording)],
    });
    console.log(
      `${width} ${url}: console ${current.console.length} api ${current.api.length} overflow ${state.overflow}`,
    );
  };

  for (const width of [1440, 390])
    for (const route of fixed) await visit(route, route, width);

  const extra = new Map(
    (process.env.QA_EXTRA ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string]),
  );
  const notRun: string[] = [];
  for (const route of dynamic) {
    const pattern = new RegExp(
      `^${route.replace(/\[[^\]]+\]/g, '[^/?#]+')}(?:[?#].*)?$`,
    );
    // Edit pages also serve "new", which is not a detail page.
    const url =
      extra.get(route) ??
      [...hrefs].find((h) => pattern.test(h) && !h.endsWith('/new'));
    if (!url) {
      notRun.push(route);
      continue;
    }
    for (const width of [1440, 390]) await visit(route, url, width);
  }

  writeFileSync(out, JSON.stringify({ routes, notRun, results }, null, 2));
  console.log(
    `routes ${routes.length}, visits ${results.length}, NOT_RUN ${notRun.length}: ${notRun.join(' ')}`,
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
