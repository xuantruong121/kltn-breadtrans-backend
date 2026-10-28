/**
 * Checkpoint 59 pre-freeze smoke of the owner app (:3000 / :3001, kltn_db) in
 * desktop Chromium as FREE, PLUS and PRO learners. Read-only by construction:
 * every non-GET API request other than login/refresh is aborted in the browser
 * and reported, so no learner data can change. Picture Writing and Grammar
 * have their own owner checks (cp58-owner-picture-browser,
 * cp58-grammar-owner-browser).
 * Usage: npx ts-node --transpile-only scripts/qa/cp59-owner-final-smoke-browser.ts
 */
import { chromium, type Page } from 'playwright';

const FE = 'http://localhost:3000';
const BE = 'http://127.0.0.1:3001';
const ACCOUNTS = {
  FREE: ['qa-cp51-free@breadtrans.local', 'Cp51-Free-Qa-2026!'],
  PLUS: ['student3@breadtrans.com', 'Password123!'],
  PRO: ['student2@breadtrans.com', 'Password123!'],
} as const;
/** Text that must never reach a learner screen. */
const INTERNAL =
  /\b(undefined|NaN|\[object Object\]|PICTURE_SENTENCE|WRITING_EMAIL|WRITING_PICTURE|LISTENING_PRACTICE|BILINGUAL_READING|BEGINNER|INTERMEDIATE|ADVANCED|PUBLISHED|DRAFT)\b|Entry Diagnostic v2|Mở khóa với PLUS(?=.*Nói)/;

let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
};

async function apiToken(email: string, password: string) {
  const r = await fetch(`${BE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((x) => x.json());
  return (r.data?.accessToken ?? r.data?.access_token) as string;
}
const apiStatus = async (token: string, path: string) =>
  (
    await fetch(`${BE}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).status;

async function session(plan: keyof typeof ACCOUNTS) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const blocked: string[] = [];
  const errors: string[] = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (
      req.url().startsWith('http://localhost:3001') ||
      req.url().startsWith(BE)
    ) {
      if (
        req.method() !== 'GET' &&
        req.method() !== 'OPTIONS' &&
        !/\/auth\/(login|refresh)/.test(req.url())
      ) {
        blocked.push(`${req.method()} ${req.url().replace(/^.*:3001/, '')}`);
        return route.abort();
      }
    }
    return route.continue();
  });
  page.on('response', (r) => {
    if (r.url().includes(':3001') && r.status() >= 500)
      errors.push(`${r.status()} ${r.url().replace(/^.*:3001/, '')}`);
  });
  page.on('pageerror', (e) =>
    errors.push(`pageerror ${e.message.slice(0, 120)}`),
  );
  const [email, password] = ACCOUNTS[plan];
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 120_000,
  });
  await page
    .addStyleTag({
      content:
        '[data-companion-pet], [aria-label*="thú cưng" i] { display:none !important }',
    })
    .catch(() => undefined);
  return { browser, page, blocked, errors };
}

async function visit(page: Page, path: string) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

const brokenImages = (page: Page) =>
  page.locator('img').evaluateAll(
    (imgs) =>
      imgs.filter((i) => {
        const img = i as HTMLImageElement;
        const r = img.getBoundingClientRect();
        // only images the learner can see now, after they had time to load
        return (
          img.complete &&
          img.naturalWidth === 0 &&
          r.top < innerHeight &&
          r.width > 0
        );
      }).length,
  );

void (async () => {
  // ---------- FREE learner: most journeys ----------
  console.log('\n== FREE 1440px');
  const free = await session('FREE');
  const p = free.page;
  const pages: Array<[string, string, (t: string) => boolean]> = [
    ['dashboard', '/dashboard', (t) => /XP|Bánh|Tiến độ/.test(t)],
    [
      'listening catalog',
      '/listening',
      (t) => t.includes('Nghe chép: du lịch và chỉ đường (A2)'),
    ],
    [
      'reading catalog',
      '/reading',
      (t) => t.includes('Văn bản đời thường (A1–A2)'),
    ],
    [
      'speaking catalog',
      '/speaking',
      (t) => t.includes('Đọc thành tiếng câu đời thường (A1–A2)'),
    ],
    [
      'writing catalog',
      '/writing',
      (t) => t.includes('Viết email công việc (B1)'),
    ],
    [
      'flashcard catalog',
      '/flashcard',
      (t) => /Chưa học|Đang học|Đã thuộc|bộ từ/i.test(t),
    ],
    [
      'grammar catalog',
      '/reading?category=grammar',
      (t) => t.includes('Từ loại') && t.includes('Luyện ngẫu nhiên'),
    ],
    [
      'plans page',
      '/plans',
      (t) => t.includes('69.000') && t.includes('149.000'),
    ],
    ['arena', '/arena', (t) => /Đấu trường|Arena|Bánh/i.test(t)],
    ['TOEIC', '/toeic', (t) => /TOEIC/.test(t)],
    ['diagnostic', '/diagnostic', (t) => /đầu vào|Kiểm tra/i.test(t)],
    ['courses', '/my-courses', (t) => /Khóa học|khóa học/.test(t)],
  ];
  for (const [name, path, ok] of pages) {
    const text = await visit(p, path);
    const internal = INTERNAL.exec(text)?.[0];
    const broken = await brokenImages(p);
    check(
      `${name} (${path}) renders, no internal labels, no broken visible media`,
      ok(text) && !internal && broken === 0,
      `${internal ? `internal="${internal}"` : ''} ${broken ? `broken=${broken}` : ''}`.trim(),
    );
    if (['/listening', '/reading', '/speaking', '/writing'].includes(path)) {
      const sort = await p.getByLabel('Sắp xếp theo độ khó').inputValue();
      check(`${name}: default Dễ → Khó`, sort === 'EASY_TO_HARD');
    }
    if (path === '/listening')
      check(
        'listening: B1 locked with PLUS, A2 dictation open',
        text.includes('Mở khóa với PLUS') &&
          text.includes('Nghe chép: du lịch và chỉ đường (A2)'),
      );
    if (path === '/speaking')
      check(
        'speaking: B1+ locked with PRO, never PLUS',
        text.includes('Mở khóa với PRO') && !text.includes('Mở khóa với PLUS'),
      );
    if (path === '/arena')
      check('arena: no XP promised for a win', !/\+\s*\d+\s*XP/.test(text));
  }
  // Dictation and Speaking Practice entries (already demonstrated): open, do not answer.
  const dict = await visit(p, '/listening/24');
  check(
    'Listening Dictation A2 (quiz 24) opens its workspace',
    /Nghe chép|Câu 1/.test(dict) && !INTERNAL.test(dict),
  );
  const spkId = 1;
  const spk = await visit(p, `/speaking/${spkId}`);
  check(
    'Speaking Practice A1–A2 (exercise 1) opens its workspace',
    /Đọc thành tiếng|Ghi âm|Nghe mẫu/.test(spk) && !INTERNAL.test(spk),
  );
  // Opening a listening quiz starts an attempt (normal behaviour); it is
  // aborted here, so it is reported but not counted as unexpected.
  const unexpected = free.blocked.filter(
    (b) => !/^POST \/quizzes\/\d+\/listening-attempts$/.test(b),
  );
  check(
    'FREE: no unexpected write request (listening attempt start aborted)',
    unexpected.length === 0,
    free.blocked.join(' | '),
  );
  check(
    'FREE: no page error or 5xx',
    free.errors.length === 0,
    free.errors.join(' | '),
  );
  await free.browser.close();

  // ---------- PLUS learner ----------
  console.log('\n== PLUS 1440px');
  const plus = await session('PLUS');
  const pl = await visit(plus.page, '/listening');
  check('PLUS: Listening B1+ open (no lock)', !pl.includes('Mở khóa với'));
  const ps = await visit(plus.page, '/speaking');
  check(
    'PLUS: Speaking B1+ says "Mở khóa với PRO"',
    ps.includes('Mở khóa với PRO') && !ps.includes('Mở khóa với PLUS'),
  );
  check(
    'PLUS: no write request, no error',
    plus.blocked.length === 0 && plus.errors.length === 0,
    [...plus.blocked, ...plus.errors].join(' | '),
  );
  await plus.browser.close();

  // ---------- PRO learner ----------
  console.log('\n== PRO 1440px');
  const pro = await session('PRO');
  for (const path of ['/listening', '/reading', '/speaking', '/writing']) {
    const t = await visit(pro.page, path);
    check(`PRO ${path}: nothing locked`, !t.includes('Mở khóa với'));
  }
  const courses = await visit(pro.page, '/my-courses');
  check(
    'PRO: courses page renders',
    /Khóa học|khóa học/.test(courses) && !INTERNAL.test(courses),
  );
  check(
    'PRO: no write request, no error',
    pro.blocked.length === 0 && pro.errors.length === 0,
    [...pro.blocked, ...pro.errors].join(' | '),
  );
  await pro.browser.close();

  // ---------- Server-side access (GET only) ----------
  console.log('\n== API access (GET only)');
  const tFree = await apiToken(...ACCOUNTS.FREE);
  const tPlus = await apiToken(...ACCOUNTS.PLUS);
  const tPro = await apiToken(...ACCOUNTS.PRO);
  check(
    'courses: FREE 403, PLUS 403, PRO 200',
    (await apiStatus(tFree, '/courses/1/learning')) === 403 &&
      (await apiStatus(tPlus, '/courses/1/learning')) === 403 &&
      (await apiStatus(tPro, '/courses/1/learning')) === 200,
  );
  check(
    'Listening B1 (quiz 11): FREE 403, PLUS 200',
    (await apiStatus(tFree, '/quizzes/11')) === 403 &&
      (await apiStatus(tPlus, '/quizzes/11')) === 200,
  );
  check(
    'Writing B1 picture (quiz 46): FREE 403, PLUS 403, PRO 200',
    (await apiStatus(tFree, '/writing/quizzes/46')) === 403 &&
      (await apiStatus(tPlus, '/writing/quizzes/46')) === 403 &&
      (await apiStatus(tPro, '/writing/quizzes/46')) === 200,
  );
  check(
    'Grammar topic (12): FREE 200',
    (await apiStatus(tFree, '/grammar/topics/12')) === 200,
  );

  console.log(`\nCP59_OWNER_FINAL_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
