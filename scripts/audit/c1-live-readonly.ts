/**
 * Phase C1 read-only checks on the real development database.
 *
 * Session opened with default_transaction_read_only=on and asserted before any
 * query; PostgreSQL rejects any write with SQLSTATE 25006. Only methods that
 * were read and found to issue no write are called: getCurrentAssessment,
 * getLatestResult and the pure readiness evaluator. Nothing that can create an
 * attempt is invoked here.
 */
import { PrismaClient } from '@prisma/client';

import { evaluateAssessmentReadiness } from '../../src/modules/diagnostic/diagnostic.logic';
import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';

const LIVE_SYSID = '7674533776495505443';

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};

async function main() {
  const u = new URL(process.env.C1_LIVE_URL ?? '');
  u.searchParams.set('options', '-c default_transaction_read_only=on');
  const prisma = new PrismaClient({
    datasources: { db: { url: u.toString() } },
  });
  const [id] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db,
            (SELECT system_identifier::text FROM pg_control_system()) AS sysid,
            current_setting('default_transaction_read_only') AS ro`,
  );
  console.log(`target ${u.port}/${id.db} sysid=${id.sysid} read_only=${id.ro}`);
  if (id.db !== 'kltn_db' || id.sysid !== LIVE_SYSID || u.port !== '5432')
    throw new Error('REFUSED: not the recorded kltn_db cluster');
  if (id.ro !== 'on')
    throw new Error('REFUSED: read-only session not in effect');

  const service = new DiagnosticService(
    prisma,
    new Proxy(
      {},
      {
        get: () => {
          throw new Error('gamification reached');
        },
      },
    ) as any,
  );
  const user = await prisma.user.findFirst({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  const served: any = await service.getCurrentAssessment(user!.id);
  ok(
    'getCurrentAssessment serves the ACTIVE id=1 with the new code',
    served.id === 1,
    `(served=${served.id}, questions=${served.questions.length})`,
  );
  const keys = new Set(served.questions.flatMap((q: any) => Object.keys(q)));
  ok(
    'new delivery fields present',
    [
      'taskType',
      'instructions',
      'mediaStatus',
      'prepSeconds',
      'responseSeconds',
      'wordMin',
      'wordMax',
      'productive',
    ].every((k) => keys.has(k)),
  );
  ok(
    'no confidential field served',
    [
      'correctIndex',
      'explanation',
      'sourceKey',
      'intendedLevel',
      'difficulty',
    ].every((k) => !keys.has(k)),
  );
  const again: any = await service.getCurrentAssessment(user!.id);
  ok(
    'served order is stable across requests',
    JSON.stringify(again.questions.map((q: any) => q.options)) ===
      JSON.stringify(served.questions.map((q: any) => q.options)),
  );
  ok(
    'getLatestResult returns the no-result state',
    (await service.getLatestResult(user!.id)) === null,
  );

  for (const aid of [1, 5]) {
    const a = await prisma.diagnosticAssessment.findUnique({
      where: { id: aid },
      include: { questions: true },
    });
    const r = evaluateAssessmentReadiness(a!, a!.questions);
    console.log(
      `READINESS id=${aid} status=${a!.status} content=${r.content.valid} ` +
        `runtime=${r.runtime.ready}(${r.runtime.defects.length}) activation=${r.activation.ready} ` +
        `blockers=${JSON.stringify(r.activation.blockers)}`,
    );
    if (aid === 1)
      ok(
        'id=1 passes content, runtime and activation',
        r.content.valid && r.runtime.ready && r.activation.ready,
      );
    else
      ok(
        'id=5 content valid, runtime NOT ready (10 audio), activation blocked',
        r.content.valid &&
          !r.runtime.ready &&
          r.runtime.defects.length === 10 &&
          !r.activation.ready,
      );
  }

  let blocked = '';
  try {
    await prisma.$executeRawUnsafe(
      `SELECT 1 FROM "DiagnosticAttempt" FOR UPDATE`,
    );
  } catch (e: any) {
    blocked = String(e?.message ?? e);
  }
  ok(
    'the session really is read-only (a locking read is refused)',
    /25006|read-only/.test(blocked),
  );

  console.log(`\nC1_LIVE_READONLY_FAILURES=${failures}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'C1 LIVE ERROR:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-2)
      .join(' '),
  );
  process.exit(2);
});
