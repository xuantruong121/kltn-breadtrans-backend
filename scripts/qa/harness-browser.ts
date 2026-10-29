/** Shared Playwright login for the disposable harness (FE :3100). */
import { chromium, type Browser, type Page } from 'playwright';

import { newProStudent, newStudent } from './harness-api';

export const FE = 'http://localhost:3100';

/**
 * Opt-in UI text sampler (UI_TEXT_SCAN=<file.jsonl>): while a scripted flow
 * runs, the visible text is sampled every second and any internal wording
 * (module versions, engineering terms, raw enums, raw errors, English
 * workflow words) is appended to the file with the URL. This reaches states a
 * route crawl cannot: open modals, an exam in progress, a result dialog.
 */
const UI_TEXT_RULES: Array<[string, RegExp]> = [
  [
    'version',
    /\b(?:Course|Lesson|Assessment|Diagnostic|Speaking|Quiz|Exam|Module)\s?V\d(?:\.\d)?\b/g,
  ],
  ['legacy', /\b(?:Legacy|legacy)\b/g],
  [
    'engineering',
    /\b(?:Runtime|runtime|Mock|MOCK|Provider|provider|Pipeline|pipeline|Payload|payload|DTO|Prisma|Redis|Queue|Worker|Backend|backend|Schema|artifact|Artifact|endpoint|Gemini|Azure|R2|Cloudflare)\b/g,
  ],
  [
    'raw-enum',
    /\b(?:BEGINNER|INTERMEDIATE|ADVANCED|PUBLISHED|DRAFT|PENDING|PROCESSING|COMPLETED|FAILED|SUBMITTED|IN_PROGRESS|PENDING_START|PENDING_GRADING|QUEUED|SUCCEEDED|CANCELLED|EXPIRED|READ_ALOUD|DESCRIBE_PICTURE|RESPOND_TO_QUESTION|EXPRESS_OPINION|FULL_TEST|PRACTICE_BY_PART|MULTIPLE_CHOICE|WRITING_EMAIL|WRITING_PICTURE|TOEIC_4_SKILLS|TOEIC_SW|TOEIC_LR)\b/g,
  ],
  [
    'raw-error',
    /(?:Request failed|status code \d|AxiosError|\w+Exception\b|Internal Server Error|Cannot read prop|\bundefined\b|\bNaN\b|\[object Object\]|not found\b|is required\b)/g,
  ],
  [
    'english-ui',
    /\b(?:Readiness|Candidate|Composer|Publish|Unpublish|Apply|Retry|Loading\.\.\.|Submit)\b/g,
  ],
];

export function attachUiTextSampler(page: Page, label: string) {
  const out = process.env.UI_TEXT_SCAN;
  if (!out) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appendFileSync } = require('node:fs') as typeof import('node:fs');
  const seen = new Set<string>();
  const timer = setInterval(() => {
    void page
      .evaluate(() => document.body?.innerText ?? '')
      .then((raw) => {
        const text = raw.replace(/\s+/g, ' ');
        for (const [rule, re] of UI_TEXT_RULES) {
          for (const m of text.matchAll(re)) {
            const i = m.index ?? 0;
            const context = text.slice(Math.max(0, i - 60), i + 60);
            // Generated harness account names are test data, not UI copy.
            if (/harness/i.test(context)) continue;
            const key = `${rule}|${m[0]}|${context}`;
            if (seen.has(key)) continue;
            seen.add(key);
            appendFileSync(
              out,
              `${JSON.stringify({ label, url: page.url().replace(FE, ''), rule, match: m[0], context })}\n`,
            );
          }
        }
      })
      .catch(() => undefined);
  }, 1000);
  page.on('close', () => clearInterval(timer));
  page.context().on('close', () => clearInterval(timer));
}

export async function studentPage(
  label: string,
  width = 1366,
  pro = false,
  // e.g. Chromium's fake microphone for recording tests
  launchArgs: string[] = [],
): Promise<{
  browser: Browser;
  page: Page;
  account: Awaited<ReturnType<typeof newStudent>>;
  issues: string[];
}> {
  const account = pro ? await newProStudent(label) : await newStudent(label);
  const browser = await chromium.launch({ args: launchArgs });
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    ...(launchArgs.length ? { permissions: ['microphone'] } : {}),
  });
  attachUiTextSampler(page, label);
  const issues: string[] = [];
  page.on('pageerror', (e) =>
    issues.push(`pageerror: ${e.message.slice(0, 200)}`),
  );
  page.on('console', (m) => {
    if (m.type() === 'error') issues.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost:3101') && r.status() >= 500)
      issues.push(
        `api ${r.status()} ${r.request().method()} ${r.url().slice(21)}`,
      );
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click('#email-login-panel button[type="submit"]');
  // 'commit': the redirect is the signal; a slow asset on the next page
  // must not fail the login.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
  return { browser, page, account, issues };
}

/** Hide the floating companion pet so it cannot cover controls. */
export async function hidePet(page: Page) {
  await page
    .addStyleTag({
      content:
        '[data-companion-pet], [aria-label*="thú cưng" i] { display:none !important }',
    })
    .catch(() => undefined);
}
