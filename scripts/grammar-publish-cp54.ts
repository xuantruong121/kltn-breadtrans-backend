/**
 * Checkpoint 54: fix two ambiguous Grammar questions and publish the topics
 * that passed the content review, through GrammarService itself (the same
 * history guard and readiness checks as the Admin API). No SQL status update.
 *
 * Content review (all 60 questions read): 7 items had a second grammatical
 * answer. Q27 (topic 6) and Q40 (topic 8) are fixed here. Q1, Q3, Q4, Q5
 * (topic 1) and Q9 (topic 2) cannot be edited: their topics have attempts and
 * the service refuses structural edits, so topics 1 and 2 stay DRAFT.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/grammar-publish-cp54.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * apply also needs GRAMMAR_PUBLISH_AUTHORIZED=publish.
 */
import { PrismaClient } from '@prisma/client';

import { GrammarService } from '../src/modules/grammar/grammar.service';

const PUBLISH = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HELD = [1, 2];
const EDITS = [
  {
    topicId: 6,
    questionId: 27,
    before: {
      question: 'Employees ______ wear their ID badges inside the building.',
      options: ['might', 'would', 'must', 'could have'],
      correctIndex: 2,
    },
    dto: {
      question:
        'For security reasons, employees ______ wear their ID badges inside the building.',
      options: ['must to', 'are', 'must', 'could have'],
    },
  },
  {
    topicId: 8,
    questionId: 40,
    before: {
      question: 'Which route is the ______ one to the airport?',
      options: ['most fastly', 'faster', 'more fast', 'fastest'],
      correctIndex: 3,
    },
    dto: {
      question: 'Which of the three routes is the ______ one to the airport?',
    },
  },
];

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.GRAMMAR_PUBLISH_AUTHORIZED !== 'publish')
    throw new Error('REFUSED: GRAMMAR_PUBLISH_AUTHORIZED=publish not set');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target ${db} sysid ${sysid}`);
    const topics = await prisma.grammarTopic.findMany({
      include: { _count: { select: { questions: true, attempts: true } } },
      orderBy: { id: 'asc' },
    });
    const ids = topics.map((t) => t.id).join(',');
    if (ids !== '1,2,3,4,5,6,7,8,9,10,11,12')
      throw new Error(`STOP: unexpected topic set ${ids}`);
    for (const t of topics) {
      if (t.publicationStatus !== 'DRAFT' || t._count.questions !== 5)
        throw new Error(
          `STOP: topic ${t.id} is ${t.publicationStatus} with ${t._count.questions} questions`,
        );
    }
    for (const e of EDITS) {
      const q = await prisma.grammarQuestion.findUnique({
        where: { id: e.questionId },
      });
      if (
        !q ||
        q.topicId !== e.topicId ||
        q.question !== e.before.question ||
        JSON.stringify(q.options) !== JSON.stringify(e.before.options) ||
        q.correctIndex !== e.before.correctIndex
      )
        throw new Error(`STOP: question ${e.questionId} is not as reviewed`);
    }
    if (mode === 'dryrun') console.log('(dry run on this target)');
    const service = new GrammarService(
      prisma,
      undefined as any,
      undefined as any,
    );
    for (const e of EDITS) {
      await service.updateQuestion(e.topicId, e.questionId, e.dto);
      console.log(`edited question ${e.questionId} (topic ${e.topicId})`);
    }
    // The history guard must refuse an edit on a held topic.
    try {
      await service.updateQuestion(1, 1, { question: 'probe' });
      throw new Error('STOP: history guard did not refuse topic 1');
    } catch (err: any) {
      if (err?.status !== 409) throw err;
      console.log('topic 1 edit refused by history guard (409), as expected');
    }
    for (const id of PUBLISH) {
      await service.publishTopic(id);
      console.log(`published topic ${id}`);
    }
    const after = await prisma.grammarTopic.findMany({
      select: { id: true, title: true, publicationStatus: true },
      orderBy: { id: 'asc' },
    });
    for (const t of after) {
      const want = HELD.includes(t.id) ? 'DRAFT' : 'PUBLISHED';
      if (t.publicationStatus !== want)
        throw new Error(`STOP: topic ${t.id} is ${t.publicationStatus}`);
    }
    console.log(after.map((t) => `${t.id}:${t.publicationStatus}`).join(' '));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
