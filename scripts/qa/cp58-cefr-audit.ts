/**
 * Checkpoint 58 CEFR audit (read-only, any API): for every published practice
 * item in the four skill catalogs, compare the level the catalog exposes with
 * the level the entitlement policy reads (practice-level.ts) and the plan the
 * API requires. Prints one row per item and a mismatch count.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-cefr-audit.ts [BE] [email] [password]
 */
import {
  parseCefrRange,
  requiredPracticePlan,
  type CefrRange,
  type PracticeSkill,
} from '../../src/modules/subscription/practice-level';

const BE = process.argv[2] ?? 'http://127.0.0.1:3001';
const EMAIL = process.argv[3] ?? 'student2@breadtrans.com';
const PASSWORD = process.argv[4] ?? 'Password123!';

const span = (r: CefrRange | null) =>
  r ? (r.min === r.max ? r.min : `${r.min}-${r.max}`) : '?';

void (async () => {
  const login = (await fetch(`${BE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json())) as any;
  const token = login.data?.accessToken ?? login.data?.access_token;
  const get = async (p: string) =>
    ((await fetch(`${BE}${p}`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json())) as any).data;

  type Row = {
    skill: PracticeSkill;
    id: number | string;
    title: string;
    exposed: string;
    policy: CefrRange | null;
    requiredPlan?: string;
    cefrLevel?: string;
  };
  const rows: Row[] = [];
  for (const q of (await get('/quizzes/listening-practice')) ?? [])
    rows.push({
      skill: 'LISTENING',
      id: q.id,
      title: q.title,
      exposed: JSON.stringify(q.levels ?? null),
      policy: parseCefrRange(q.title),
      requiredPlan: q.requiredPlan,
      cefrLevel: q.cefrLevel,
    });
  for (const e of (await get('/reading/exercises')) ?? [])
    rows.push({
      skill: 'READING',
      id: e.quizId ?? e.id,
      title: e.title,
      exposed: `${e.level}/${e.difficulty}`,
      policy: parseCefrRange(e.title),
      requiredPlan: e.requiredPlan,
      cefrLevel: e.cefrLevel,
    });
  for (const s of (await get('/speaking/exercises')) ?? [])
    rows.push({
      skill: 'SPEAKING',
      id: s.id,
      title: s.title,
      exposed: `${s.difficulty}/${s.practiceSet?.level}`,
      policy: parseCefrRange(s.practiceSet?.level) ?? parseCefrRange(s.title),
      requiredPlan: s.requiredPlan,
      cefrLevel: s.cefrLevel,
    });
  for (const w of (await get('/writing/topics'))?.quizzes ?? [])
    rows.push({
      skill: 'WRITING',
      id: w.id,
      title: w.title,
      exposed: `${w.level ?? '(none)'}`,
      policy: parseCefrRange(w.title),
      requiredPlan: w.requiredPlan,
      cefrLevel: w.cefrLevel,
    });

  let mismatches = 0;
  for (const r of rows) {
    const plan = r.policy ? requiredPracticePlan(r.skill, r.policy) : 'UNKNOWN';
    const problems: string[] = [];
    if (!r.policy) problems.push('no CEFR tag');
    if (r.requiredPlan && r.requiredPlan !== plan)
      problems.push(`API plan ${r.requiredPlan} ≠ policy ${plan}`);
    if (r.cefrLevel !== undefined && r.cefrLevel !== span(r.policy))
      problems.push(`cefrLevel ${r.cefrLevel} ≠ ${span(r.policy)}`);
    if (problems.length) mismatches++;
    console.log(
      [r.skill, r.id, span(r.policy), plan, r.requiredPlan ?? '-', r.cefrLevel ?? '-', r.exposed, r.title, problems.join('; ')].join(' | '),
    );
  }
  console.log(`\nITEMS=${rows.length}`);
  console.log(`CEFR_MISMATCHES=${mismatches}`);
})();
