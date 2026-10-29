/**
 * CP60.2 post-integration check of the OWNER app API (:3001, kltn_db).
 * Read-only apart from the three logins (POST /auth/login writes a session):
 * every other request is a GET. Needs QA_OWNER_READONLY=owner-approved.
 *
 * Run: QA_OWNER_READONLY=owner-approved npx ts-node --transpile-only scripts/qa/cp602-owner-postmerge-api.ts
 */
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn(
  'QA_OWNER_READONLY',
  'cp602-owner-postmerge-api reads the owner API (:3001, kltn_db); logins write sessions',
);

const BE = 'http://localhost:3001';
const ACCOUNTS = {
  FREE: ['qa-cp51-free@breadtrans.local', 'Cp51-Free-Qa-2026!'],
  PLUS: ['student3@breadtrans.com', 'Password123!'],
  PRO: ['student2@breadtrans.com', 'Password123!'],
} as const;

let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
};
async function login(email: string, password: string) {
  const r = await fetch(`${BE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((x) => x.json());
  return (r.data?.accessToken ?? r.data?.access_token) as string;
}
async function get(path: string, token?: string) {
  const r = await fetch(`${BE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, data: body?.data ?? body };
}

void (async () => {
  const tokens = {
    FREE: await login(...ACCOUNTS.FREE),
    PLUS: await login(...ACCOUNTS.PLUS),
    PRO: await login(...ACCOUNTS.PRO),
  };
  check('three owner accounts log in', Object.values(tokens).every(Boolean));

  const catalog = await get('/public/courses');
  const courseIds: number[] = (catalog.data ?? []).map((c: any) => c.id);
  check(
    'public catalog lists published courses',
    catalog.status === 200 && courseIds.length > 0,
    `(${courseIds.join(',')})`,
  );
  const leaks = JSON.stringify([
    catalog.data,
    (await get(`/public/courses/${courseIds[0]}`)).data,
    (await get('/courses', tokens.PRO)).data,
  ]);
  check(
    'course responses carry no classes, enrollments or tuition',
    !/tuitionFeeVnd|"classes"|upcomingClassCount|remainingSeats|enrollment/i.test(
      leaks,
    ),
  );

  for (const id of courseIds) {
    const s = await Promise.all(
      (['FREE', 'PLUS', 'PRO'] as const).map(
        async (p) => (await get(`/courses/${id}/learning`, tokens[p])).status,
      ),
    );
    check(
      `course ${id}: FREE/PLUS 403, PRO 200`,
      s[0] === 403 && s[1] === 403 && s[2] === 200,
      `(${s.join('/')})`,
    );
  }
  const overview = await get(`/courses/${courseIds[0]}/learning`, tokens.PRO);
  check(
    'PRO learning overview reports progress (read only)',
    overview.status === 200 &&
      typeof overview.data?.progress?.completedLessons === 'number',
    JSON.stringify(overview.data?.progress ?? {}),
  );

  const retired = [
    '/classes',
    '/classes/my-classes',
    '/classes/1',
    '/classes/watch-tracking',
    '/courses/classes/1/assignments',
    '/courses/assignments/1',
    '/payments/me',
    '/admin/classes',
    '/admin/payments',
  ];
  const statuses = await Promise.all(
    retired.map(async (p) => `${p}=${(await get(p, tokens.PRO)).status}`),
  );
  check(
    'retired classroom/tuition GET routes answer 404',
    statuses.every((s) => s.endsWith('=404')),
    statuses.filter((s) => !s.endsWith('=404')).join(' '),
  );

  check('plan catalog is served', (await get('/plans/catalog')).status === 200);
  check(
    'TOEIC assessments list answers',
    (await get('/toeic/assessments', tokens.PRO)).status === 200,
  );
  const diag = await get('/diagnostic/current', tokens.FREE);
  check(
    'diagnostic current assessment answers',
    diag.status === 200,
    `(${diag.status})`,
  );
  const latest = await get('/diagnostic/results/latest', tokens.PRO);
  check(
    'diagnostic latest result answers',
    [200, 404].includes(latest.status),
    `(${latest.status})`,
  );

  console.log(`\nCP602_OWNER_POSTMERGE_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
