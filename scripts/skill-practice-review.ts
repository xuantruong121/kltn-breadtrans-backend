/**
 * Applies the review of the 48 F8 skill practice drafts (F8.2.6, owner request
 * 2026-10-31: review them and publish what is sound). Every draft was read.
 *
 * Modes (artifacts/skill-practice-v1/):
 *   fix      corrects text only, on DRAFT items (rollback file first): wrong
 *            answer keys, a Listening question about something never said,
 *            sample answers under their own word limit.
 *   publish  validates everything first through the CMS rules, then approves
 *            and publishes the current Listening audio and publishes the
 *            content. Nothing is generated: no Azure or Gemini call.
 *
 * Held as DRAFT, because a fix there changes what the audio was made from and
 * needs new Azure audio: quizzes 52, 57, 58 and the A1 library speaking set.
 * A non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply.
 *
 * Usage: npx ts-node --transpile-only scripts/skill-practice-review.ts <fix|publish> --target <url|env:DATABASE_URL>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, QuizPublicationStatus, Role } from '@prisma/client';

import { SkillCmsService } from '../src/modules/content/skill-cms.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';

const DIR = join('artifacts', 'skill-practice-v1');
const ADMIN = { id: 17, role: Role.ADMIN };

const HELD_QUIZZES = [52, 57, 58];
const HELD_SET_PREFIX = 'speaking-d611b13e';
const LISTENING = [47, 48, 49, 50, 51, 53, 54, 55, 56];
const READING = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];
const WRITING = [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82];

type Content = Record<string, any>;

function replaceOption(c: Content, from: string, to: string) {
  const index = c.options.indexOf(from);
  if (index < 0) throw new Error(`option not found: ${from}`);
  c.options[index] = to;
}

function setKey(c: Content, answer: string, index: number) {
  if (c.options[index] !== answer)
    throw new Error(`option ${index} is not: ${answer}`);
  c.correctIndex = index;
}

/** The key must be the option the passage and the explanation support. */
const QUESTION_FIXES: Record<number, (c: Content) => void> = {
  328: (c) => setKey(c, 'Communication and teamwork', 1),
  332: (c) =>
    setKey(
      c,
      "It has occasionally diverted the clinician's attention away from the patient.",
      2,
    ),
  326: (c) => {
    c.text = 'What negative behavior do regular group meetings help reduce?';
  },
  // The customer never asks to change a side dish.
  265: (c) => {
    c.text = 'What side dishes come with the steak?';
    c.options = [
      'Truffle fries and a green salad',
      'Steamed rice and carrots',
      'Roasted potatoes and green beans',
      'Garlic herb mashed potatoes and asparagus',
    ];
    c.correctIndex = 3;
    c.explanation = {
      en: 'The waiter says the steak is served with garlic herb mashed potatoes and asparagus.',
      vi: 'Nhân viên phục vụ cho biết món bít tết được dùng kèm khoai tây nghiền tỏi thảo mộc và măng tây.',
      evidence: 'It is served with garlic herb mashed potatoes and asparagus.',
    };
  },
  233: (c) => {
    c.text = 'What does the student need to show to borrow books?';
  },
  238: (c) => {
    c.text = 'Where can the customer find the milk?';
  },
  246: (c) =>
    replaceOption(
      c,
      'His company email address and domain password',
      'His company email address and standard network password',
    ),
  247: (c) =>
    replaceOption(
      c,
      'To apply the automated security updates',
      'To finish the initial updates',
    ),
  253: (c) =>
    replaceOption(
      c,
      'It is the heart of the office and vital for survival',
      'It is essential for survival around the office',
    ),
  268: (c) =>
    replaceOption(
      c,
      'Participating in an informal interview and vetting process',
      'Going through an informal vetting process',
    ),
  271: (c) =>
    replaceOption(
      c,
      "They are politely asked to step down to maintain the group's equilibrium.",
      "They are politely asked to step down to preserve the group's momentum.",
    ),
};

const CITY_TOUR_PASSAGE = [
  'Customer: Hello! I want to book a city tour for tomorrow. Do you have any English tours available?',
  'Agent: Yes, we do! Our classic bus tour starts at 10:00 AM and 2:00 PM. It takes two hours and costs 25 euros per person.',
  'Customer: That sounds great. Can I pay with a credit card?',
  'Agent: Of course. Here is your ticket and receipt. Enjoy your tour!',
].join('\n');

/** Sample answers shorter than their own wordRange, and one typo. */
const SAMPLE_FIXES: Record<number, Array<[string, string]>> = {
  79: [
    [
      'In conclusion, although online doctors',
      'A doctor who meets a patient face to face can also notice small changes that a camera may miss. In conclusion, although online doctors',
    ],
  ],
  80: [
    [
      'In conclusion, while poorly managed',
      'Holding the meeting at the same time each morning also helps people plan their focused work around it. In conclusion, while poorly managed',
    ],
  ],
  81: [
    [
      'prevent inventory waste.',
      'prevent inventory waste. We would also receive a single monthly invoice, which would simplify budget reconciliation for the finance team and give department heads a clear view of their spending. A three-month trial would allow us to measure these savings before committing to a longer contract.',
    ],
  ],
  82: [
    ['a 30-no-questions-asked refund', 'a 30-day, no-questions-asked refund'],
    [
      'rebuild trust.',
      'rebuild trust. Clear wording on our website and in our stores would also reduce the number of complaints handled by support staff.',
    ],
  ],
};

const countWords = (text: string) => text.trim().split(/\s+/).length;

function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2) throw new Error(`not once: ${from}`);
  return text.replace(from, to);
}

async function fix(prisma: PrismaClient, harness: boolean) {
  const ids = Object.keys(QUESTION_FIXES).map(Number);
  const writing = Object.keys(SAMPLE_FIXES).map(Number);
  const rows = await prisma.question.findMany({
    where: {
      OR: [{ id: { in: ids } }, { quizId: 61 }, { quizId: { in: writing } }],
    },
    include: { quiz: { select: { publicationStatus: true } } },
  });
  const expected = ids.length + 5 + writing.length;
  if (rows.length !== expected)
    throw new Error(`expected ${expected} questions, found ${rows.length}`);
  const refused = rows.find(
    (q) => q.quiz.publicationStatus !== QuizPublicationStatus.DRAFT,
  );
  if (refused) throw new Error(`question ${refused.id} is not on a DRAFT`);

  const next = rows.map((row) => {
    const content = structuredClone(row.content) as Content;
    QUESTION_FIXES[row.id]?.(content);
    if (row.quizId === 61) content.passage = CITY_TOUR_PASSAGE;
    for (const [from, to] of SAMPLE_FIXES[row.quizId] ?? [])
      content.sampleResponse = replaceOnce(content.sampleResponse, from, to);
    if (SAMPLE_FIXES[row.quizId]) {
      const words = countWords(content.sampleResponse);
      const [min, max] = content.wordRange;
      if (words < min || words > max)
        throw new Error(`quiz ${row.quizId} sample has ${words} words`);
      console.log(`quiz ${row.quizId} sample: ${words} words (${min}-${max})`);
    }
    return { id: row.id, content };
  });

  mkdirSync(DIR, { recursive: true });
  const rollback = join(
    DIR,
    `review-rollback-${harness ? 'harness' : 'target'}-${Date.now()}.json`,
  );
  writeFileSync(
    rollback,
    JSON.stringify(
      rows.map((q) => ({ id: q.id, content: q.content })),
      null,
      1,
    ),
  );
  await prisma.$transaction(
    next.map((q) =>
      prisma.question.update({
        where: { id: q.id },
        data: { content: q.content },
      }),
    ),
  );
  console.log(`fixed ${next.length} questions; rollback ${rollback}`);
}

async function publish(prisma: PrismaClient, harness: boolean) {
  // The harness has no audio objects, so existence is assumed there only.
  const upload = harness
    ? ({
        objectExists: () => Promise.resolve(true),
        privateObjectExists: () => Promise.resolve(true),
        isPrivateStorageConfigured: () => true,
      } as unknown as UploadService)
    : new UploadService(new R2Service());
  const audio = new ListeningAudioAuthoringService(prisma, upload);
  const cms = new SkillCmsService(prisma, audio);

  const sets = await prisma.speakingPracticeSet.findMany({
    where: { scope: 'SKILL_PRACTICE', publicationStatus: 'DRAFT' },
    select: { id: true },
  });
  const setIds = sets
    .map((s) => s.id)
    .filter((id) => !id.startsWith(HELD_SET_PREFIX));
  if (setIds.length !== 11) throw new Error(`${setIds.length} speaking sets`);

  const items: Array<[string, string]> = [
    ...LISTENING.map((id): [string, string] => ['listening', String(id)]),
    ...READING.map((id): [string, string] => ['reading', String(id)]),
    ...WRITING.map((id): [string, string] => ['writing', String(id)]),
    ...setIds.map((id): [string, string] => ['speaking', id]),
  ];
  // Listening passes the CMS rules only once its audio is published.
  for (const [domain, id] of items) {
    if (domain === 'listening') continue;
    const check = await cms.validate(domain, id, ADMIN);
    if (!check.valid)
      throw new Error(`${domain} ${id}: ${check.errors.join('; ')}`);
  }

  const artifacts = new Map<number, { id: number; status: string }>();
  for (const quizId of LISTENING) {
    const { synthesisHash, speakers } = await audio.validateContent(quizId);
    const artifact = await prisma.listeningAudioArtifact.findFirst({
      where: { quizId, synthesisHash },
      orderBy: { id: 'desc' },
      select: { id: true, status: true },
    });
    if (!artifact) throw new Error(`quiz ${quizId}: no current audio`);
    if (speakers.length < 2) throw new Error(`quiz ${quizId}: one speaker`);
    artifacts.set(quizId, artifact);
  }
  console.log(`validated content and ${artifacts.size} audio`);

  for (const [quizId, artifact] of artifacts) {
    if (artifact.status === 'PREVIEW_READY')
      await audio.approve(quizId, artifact.id, ADMIN.id);
    if (artifact.status !== 'PUBLISHED')
      await audio.publish(quizId, artifact.id, ADMIN.id);
  }
  for (const [domain, id] of items)
    await cms.publish(domain, id, QuizPublicationStatus.PUBLISHED, ADMIN);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    join(DIR, `review-published-${harness ? 'harness' : 'target'}.json`),
    JSON.stringify(
      { items, audio: [...artifacts], held: HELD_QUIZZES },
      null,
      1,
    ),
  );
  console.log(
    `published ${items.length}; held ${HELD_QUIZZES.join(', ')} and ${HELD_SET_PREFIX}`,
  );
}

async function main() {
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const raw = i > 0 ? process.argv[i + 1] : undefined;
  const url = raw === 'env:DATABASE_URL' ? process.env.DATABASE_URL : raw;
  if (!url || !['fix', 'publish'].includes(mode))
    throw new Error('usage: <fix|publish> --target <url|env:DATABASE_URL>');
  const harness = /@127\.0\.0\.1:5460\//.test(url);
  if (!harness && process.env.SKILL_PRACTICE_APPLY_AUTHORIZED !== 'apply')
    throw new Error(
      'REFUSED: non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply',
    );
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await (mode === 'fix' ? fix : publish)(prisma, harness);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
