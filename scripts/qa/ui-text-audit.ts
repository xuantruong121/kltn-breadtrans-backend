/**
 * Rendered-text audit of the learner app and Admin CMS on the disposable
 * harness (FE :3100, BE :3101). Reads what Chromium actually shows (not the
 * source) and flags internal implementation wording: module versions,
 * engineering terms, raw enum values, raw errors and placeholders such as
 * "undefined". Educational content may legitimately contain some of these
 * words; every hit is printed with its context for review, and known
 * legitimate contexts are allowed explicitly below.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/ui-text-audit.ts [out.json]
 */
import { writeFileSync } from 'node:fs';

import { chromium, type Page } from 'playwright';

import { newAdmin, newProStudent } from './harness-api';
import { FE } from './harness-browser';

const LEARNER = [
  '/dashboard',
  '/student-home',
  '/hub',
  '/learn',
  '/diagnostic',
  '/listening',
  '/reading',
  '/speaking',
  '/writing',
  '/exams',
  '/toeic/assessments',
  '/toeic/history',
  '/toeic/stats',
  '/courses',
  '/my-courses',
  '/flashcard',
  '/grammar',
  '/vocabulary/saved',
  '/vocabulary/study',
  '/arena',
  '/market',
  '/pet',
  '/plans',
  '/notifications',
  '/profile',
  '/change-password',
  '/listening/10',
  '/listening/24',
  '/reading/13',
  '/speaking/16',
  '/speaking/11',
  '/writing/17',
  '/exams/1',
  '/toeic/1',
  '/courses/1',
  '/my-courses/1',
];
const ADMIN = [
  '/admin',
  '/admin/ai-tools',
  '/admin/assignments',
  '/admin/costs',
  '/admin/courses',
  '/admin/currency',
  '/admin/enroll',
  '/admin/exams',
  '/admin/grammar',
  '/admin/issue-reports',
  '/admin/listening',
  '/admin/market',
  '/admin/messages',
  '/admin/payments',
  '/admin/plan-purchases',
  '/admin/practice',
  '/admin/quizzes',
  '/admin/reading',
  '/admin/speaking',
  '/admin/suggestions',
  '/admin/toeic/assessments',
  '/admin/toeic/writing-sets',
  '/admin/users',
  '/admin/vocab',
  '/admin/writing',
];

const RULES: Array<[string, RegExp]> = [
  ['version', /\b(?:V|v)(?:[1-9])(?:\.\d)?\b(?![-/])/g],
  ['legacy', /\b(?:Legacy|legacy|LEGACY)\b/g],
  [
    'engineering',
    /\b(?:Runtime|runtime|Mock|MOCK|mock|Provider|provider|Pipeline|pipeline|Payload|payload|DTO|Prisma|Redis|Queue|queue|Worker|worker|Backend|backend|Frontend|frontend|Schema|schema|Debug|debug|artifact|Artifact|endpoint|Endpoint|R2|Cloudflare|Azure|Gemini|LLM|token)\b/g,
  ],
  [
    'raw-enum',
    /\b(?:BEGINNER|INTERMEDIATE|ADVANCED|PUBLISHED|DRAFT|ARCHIVED|PENDING|PROCESSING|COMPLETED|FAILED|SUBMITTED|IN_PROGRESS|PENDING_START|READY_FOR_REVIEW|GRADING|QUEUED|RUNNING|SUCCEEDED|CANCELLED|EXPIRED|ACTIVE|INACTIVE|APPROVED|REJECTED|SKILL_PRACTICE|EXAM_INTERNAL|READ_ALOUD|DESCRIBE_PICTURE|RESPOND_TO_QUESTION|EXPRESS_OPINION|RESPOND_USING_INFORMATION|PRONUNCIATION_DRILL|LISTENING_PRACTICE|BILINGUAL_READING|WRITING_EMAIL|WRITING_PICTURE|FULL_TEST|PRACTICE_BY_PART|MULTIPLE_CHOICE|DICTATION)\b/g,
  ],
  [
    'raw-error',
    /(?:Request failed|status code \d|AxiosError|Exception\b|Internal Server Error|Cannot read prop|\bundefined\b|\bnull\b|\bNaN\b|\[object Object\])/g,
  ],
  // Promotional filler that overstates the product.
  [
    'slop',
    /(?:thông minh|tối ưu hóa|toàn diện|hiện đại nhất|đột phá|cá nhân hóa tối đa|vượt trội|chinh phục mọi|hàng đầu)/gi,
  ],
  // English workflow words left in Vietnamese UI copy.
  [
    'english-ui',
    /\b(?:Review|Submit|Loading|Readiness|Candidate|Composer|Publish|Unpublish|Ready|Draft|Apply|Preview|Settings|Upload|Retry)\b/g,
  ],
];

async function login(page: Page, email: string, password: string) {
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
}

async function audit(page: Page, route: string) {
  await page
    .goto(FE + route, { waitUntil: 'networkidle', timeout: 120_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1500);
  const text = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  const title = await page.title().catch(() => '');
  const hits: Array<{ rule: string; match: string; context: string }> = [];
  for (const source of [text, `[title] ${title}`]) {
    for (const [rule, re] of RULES) {
      for (const m of source.matchAll(re)) {
        const i = m.index ?? 0;
        hits.push({
          rule,
          match: m[0],
          context: source.slice(Math.max(0, i - 50), i + 50),
        });
      }
    }
  }
  return { route, finalUrl: page.url().replace(FE, ''), hits };
}

(async () => {
  const out: any[] = [];
  const browser = await chromium.launch();
  for (const [role, routes] of [
    ['learner', LEARNER],
    ['admin', ADMIN],
  ] as const) {
    const acct =
      role === 'admin'
        ? await newAdmin('ui-audit-admin')
        : await newProStudent('ui-audit-pro');
    const width = Number(process.env.UI_AUDIT_WIDTH ?? 1366);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await login(page, acct.email, acct.password);
    for (const r of routes) {
      const res = await audit(page, r);
      out.push({ role, ...res });
      const byRule = res.hits.reduce<Record<string, number>>(
        (m, h) => ((m[h.rule] = (m[h.rule] ?? 0) + 1), m),
        {},
      );
      console.log(`${role} ${r} -> ${res.finalUrl}  ${JSON.stringify(byRule)}`);
      for (const h of res.hits.slice(0, 12))
        console.log(`    [${h.rule}] ${h.match} :: …${h.context}…`);
    }
    await page.close();
  }
  await browser.close();
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  console.log(`TOTAL_HITS=${out.reduce((n, r) => n + r.hits.length, 0)}`);
})();
