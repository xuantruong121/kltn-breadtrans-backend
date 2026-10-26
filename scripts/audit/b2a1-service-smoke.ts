/**
 * Phase B2A.1 in-process smoke test of the two endpoints that returned 500.
 *
 * Calls the REAL DiagnosticService.getCurrentAssessment and getLatestResult,
 * backed by the REAL PrismaService, against kltn_db. This is the code the HTTP
 * controller delegates to, minus the JWT guard. It is not an authenticated HTTP
 * request and is not reported as one.
 *
 * Read-only by construction: both methods were inspected and issue no write.
 * GamificationService is replaced by a stub that throws on any access, so a
 * path that reached it would fail loudly instead of acting. Row counts and the
 * assessment row's xmin are compared before and after.
 */
import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';
import { PrismaService } from '../../src/prisma/prisma.service';

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};

const LEAK_KEYS = [
  'correctIndex',
  'explanation',
  'difficulty',
  'intendedLevel',
  'sourceKey',
];

async function snapshot(prisma: PrismaService) {
  const [r] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM "DiagnosticAssessment") AS a,
           (SELECT count(*) FROM "DiagnosticQuestion") AS q,
           (SELECT count(*) FROM "DiagnosticAttempt") AS t,
           (SELECT xmin::text FROM "DiagnosticAssessment" WHERE id = 1) AS xmin1`);
  return {
    a: Number(r.a),
    q: Number(r.q),
    t: Number(r.t),
    xmin1: String(r.xmin1),
  };
}

async function main() {
  const prisma = new PrismaService();
  const [{ db }] = await prisma.$queryRawUnsafe<any[]>(
    'SELECT current_database() AS db',
  );
  if (db !== 'kltn_db') throw new Error(`unexpected target ${db}`);

  const gamificationTrap = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`GamificationService.${String(prop)} was reached`);
      },
    },
  );
  const service = new DiagnosticService(prisma, gamificationTrap as any);

  // A real, existing learner id, read rather than invented.
  const user = await prisma.user.findFirst({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!user) throw new Error('no STUDENT user to run as');

  const before = await snapshot(prisma);
  console.log(
    `target=${db} userId=${user.id} before=${JSON.stringify(before)}`,
  );

  // ------------------------------------------------ getCurrentAssessment
  let current: any;
  let currentErr = '';
  try {
    current = await service.getCurrentAssessment(user.id);
  } catch (e: any) {
    currentErr = `${e?.code ?? e?.name}: ${String(e?.message).split('\n').pop()}`;
  }
  ok(
    'getCurrentAssessment does not throw',
    !currentErr,
    currentErr ? `-> ${currentErr}` : '',
  );
  const assessmentId = current?.id ?? current?.assessment?.id;
  ok(
    'returns the existing active assessment id=1',
    assessmentId === 1,
    `(id=${assessmentId})`,
  );
  const questions: any[] =
    current?.questions ?? current?.assessment?.questions ?? [];
  ok(
    'returns 20 sanitized questions',
    questions.length === 20,
    `(${questions.length})`,
  );
  const leaked = LEAK_KEYS.filter((k) => questions.some((q) => k in q));
  ok(
    'no answer or hidden field in the served questions',
    leaked.length === 0,
    leaked.length ? `(leaked: ${leaked.join(',')})` : '',
  );
  console.log(
    `      top-level keys: ${Object.keys(current ?? {})
      .sort()
      .join(', ')}`,
  );

  // ----------------------------------------------------- getLatestResult
  let latest: any;
  let latestErr = '';
  try {
    latest = await service.getLatestResult(user.id);
  } catch (e: any) {
    latestErr = `${e?.code ?? e?.name}: ${String(e?.message).split('\n').pop()}`;
  }
  ok(
    'getLatestResult does not throw',
    !latestErr,
    latestErr ? `-> ${latestErr}` : '',
  );
  ok(
    'getLatestResult returns the legitimate no-result state (0 attempts exist)',
    latest === null,
    `(value=${JSON.stringify(latest)})`,
  );

  // ------------------------------------------------------- no mutation
  const after = await snapshot(prisma);
  ok(
    'database unchanged (counts and assessment xmin)',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );

  console.log(`\nB2A1_SMOKE_FAILURES=${failures}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'SMOKE ERROR:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-2)
      .join(' '),
  );
  process.exit(2);
});
