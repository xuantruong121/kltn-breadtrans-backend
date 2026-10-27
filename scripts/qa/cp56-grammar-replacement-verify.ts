/**
 * Checkpoint 56 verification for scripts/grammar-replace-cp56.ts, run through
 * GrammarService on a disposable database.
 *   before <file>  saves how existing attempts render (getMyAttempts, staff
 *                  topic detail of topics 1-2).
 *   after  <file>  compares those renderings, then checks the learner view:
 *                  only replacements listed, corrected items served, a FREE
 *                  learner scores 100 with zero XP/Bread/ledger/quest.
 * Usage: npx ts-node --transpile-only scripts/qa/cp56-grammar-replacement-verify.ts <before|after> <file> --target <url>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { GrammarService } from '../../src/modules/grammar/grammar.service';

const HISTORY_USERS = [18, 19, 148];
const FREE_USER = 148;

async function main() {
  const [mode, file] = process.argv.slice(2);
  const i = process.argv.indexOf('--target');
  const url = process.argv[i + 1];
  if (!url || /kltn_db|kltn_shadow/.test(url))
    throw new Error('disposable --target required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const service = new GrammarService(
    prisma,
    undefined as any,
    undefined as any,
  );
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  try {
    const render = async () => ({
      attempts: Object.fromEntries(
        await Promise.all(
          HISTORY_USERS.map(async (u) => [u, await service.getMyAttempts(u)]),
        ),
      ),
      staffTopic1: await service.getTopicDetail(1, undefined, true),
      staffTopic2: await service.getTopicDetail(2, undefined, true),
    });
    if (mode === 'before') {
      writeFileSync(file, JSON.stringify(await render()));
      console.log(`saved ${file}`);
      return;
    }
    const before = readFileSync(file, 'utf8');
    check(
      'existing attempts and original topics render exactly as before',
      JSON.stringify(await render()) === before,
    );

    const learnerTopics = (await service.getTopics(FREE_USER, false)) as any[];
    const titles = learnerTopics.map((t) => `${t.id}:${t.title}`);
    check(
      'learner catalog has 12 topics, originals 1-2 hidden',
      learnerTopics.length === 12 &&
        !learnerTopics.some((t) => t.id === 1 || t.id === 2),
      titles.join(' | '),
    );
    const replacements = learnerTopics.filter((t) => t.id > 12);
    const orders = await prisma.grammarTopic.findMany({
      where: { id: { in: replacements.map((t) => t.id) } },
      select: { id: true, order: true },
      orderBy: { id: 'asc' },
    });
    check(
      'two replacement topics lead the catalog at the original positions 1-2',
      replacements.length === 2 &&
        learnerTopics.slice(0, 2).every((t) => t.id > 12) &&
        orders.map((o) => o.order).join(',') === '1,2',
      orders.map((o) => `${o.id}@${o.order}`).join(','),
    );
    for (const t of replacements) {
      const d: any = await service.getTopicDetail(t.id, FREE_USER, false);
      const opts = JSON.stringify(d.questions.map((q: any) => q.options));
      check(
        `topic ${t.id} serves 5 questions without the answer key`,
        d.questions.length === 5 &&
          !d.questions.some(
            (q: any) => 'correctIndex' in q || 'explanation' in q,
          ),
      );
      check(
        `topic ${t.id} no longer offers the ambiguous options`,
        !/"opened"|"Did"|"had"|"left"/.test(opts) || t.title.startsWith('Past'),
        opts.slice(0, 200),
      );
      const staff: any = await service.getTopicDetail(t.id, undefined, true);
      const answers = Object.fromEntries(
        staff.questions.map((q: any) => [q.id, q.correctIndex]),
      );
      const ledger = async () =>
        (
          await prisma.$queryRawUnsafe<any[]>(
            `select coalesce((select sum(points) from "PointHistory" where "userId"=${FREE_USER}),0)::text || '/' || coalesce((select "totalBanhRan" from "UserStats" where "userId"=${FREE_USER}),0)::text || '/' || (select count(*) from "BanhTransaction" where "userId"=${FREE_USER})::text || '/' || (select count(*) from "UserQuestProgress" where "userId"=${FREE_USER})::text v`,
          )
        )[0].v;
      const b = await ledger();
      const r = await service.submitAttempt(t.id, FREE_USER, answers);
      check(
        `FREE learner completes topic ${t.id} with every key → 100`,
        r.score === 100 &&
          r.questionsResult.every((q) => q.isCorrect && !!q.explanation),
      );
      check(
        `topic ${t.id} awards 0 XP / 0 Bread, no ledger or quest change`,
        r.rewardXP === 0 && r.rewardBanh === 0 && (await ledger()) === b,
        `${b}`,
      );
    }
    if (mode === 'after') console.log(`FAILURES=${fails}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
