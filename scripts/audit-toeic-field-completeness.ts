/**
 * Exhaustive field-level TOEIC audit (spec §21-§26).
 *
 * The earlier passes validated structure (counts and contracts). This one
 * checks every field each Part actually requires, using the Phase-0 semantic
 * contract rather than mere URL presence:
 *
 *   Part 1  image + 4 spoken statements + correctIndex, group audio
 *   Part 2  spoken prompt + 3 responses + correctIndex, group audio
 *   Part 3  conversation transcript + a spoken question prompt per question
 *   Part 4  talk transcript + a spoken question prompt per question
 *   Part 5  sentence text + 4 options + correctIndex
 *   Part 6  passage + 4 options + correctIndex per blank
 *   Part 7  passage + question text + 4 options + correctIndex
 *
 * Optional-by-design fields are not demanded: Part 1/2 questions legitimately
 * carry no `text` (the content is spoken), and reading parts carry no audio.
 *
 * Read-only. Writes artifacts/toeic-field-completeness.json.
 *
 * Usage: npx ts-node scripts/audit-toeic-field-completeness.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../src/modules/speaking/toeic-speaking-contract';

type Issue = {
  scope: string;
  id: number | string;
  code: string;
  detail: string;
};

const EXPECTED_PART_COUNTS: Record<number, number> = {
  1: 6,
  2: 25,
  3: 39,
  4: 30,
  5: 30,
  6: 16,
  7: 54,
};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const nonEmpty = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

async function auditListeningReading(prisma: PrismaClient, issues: Issue[]) {
  const exam = await prisma.toeicExamSet.findUnique({
    where: { id: 1 },
    include: {
      groups: {
        orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
        include: { questions: { orderBy: { questionNumber: 'asc' } } },
      },
    },
  });
  if (!exam) {
    issues.push({
      scope: 'LR',
      id: 1,
      code: 'EXAM_MISSING',
      detail: 'ToeicExamSet 1 not found',
    });
    return { total: 0, byPart: {} as Record<number, number> };
  }

  const byPart: Record<number, number> = {};
  const seenNumbers = new Set<number>();
  let total = 0;

  for (const group of exam.groups) {
    const part = group.part;
    const questions = group.questions;
    byPart[part] = (byPart[part] ?? 0) + questions.length;
    total += questions.length;

    const listening = part <= 4;
    if (listening && !nonEmpty(group.audioUrl))
      issues.push({
        scope: `P${part} group`,
        id: group.id,
        code: 'MISSING_AUDIO',
        detail: 'listening group has no audioUrl',
      });
    if (part === 1 && !nonEmpty(group.imageUrl))
      issues.push({
        scope: 'P1 group',
        id: group.id,
        code: 'MISSING_IMAGE',
        detail: 'Part 1 group has no imageUrl',
      });
    // The canonical composer resolves the spoken script as
    // `transcriptText || passageText` (see toeic-listening-audio.ts), so a
    // Part 3/4 group carrying only passageText is valid: either field is a
    // legitimate source of truth for the generated audio.
    if (
      (part === 3 || part === 4) &&
      !nonEmpty(group.transcriptText) &&
      !nonEmpty(group.passageText)
    )
      issues.push({
        scope: `P${part} group`,
        id: group.id,
        code: 'MISSING_SPOKEN_SCRIPT',
        detail:
          'conversation/talk has neither transcriptText nor passageText to drive audio',
      });
    if ((part === 6 || part === 7) && !nonEmpty(group.passageText))
      issues.push({
        scope: `P${part} group`,
        id: group.id,
        code: 'MISSING_PASSAGE',
        detail: 'reading group has no passageText',
      });
    if (!listening && nonEmpty(group.audioUrl))
      issues.push({
        scope: `P${part} group`,
        id: group.id,
        code: 'UNEXPECTED_AUDIO',
        detail: 'reading group carries audio',
      });
    if (!questions.length)
      issues.push({
        scope: `P${part} group`,
        id: group.id,
        code: 'EMPTY_GROUP',
        detail: 'group has no questions',
      });

    for (const question of questions) {
      const options = asArray(question.options);
      const expectedOptions = part === 2 ? 3 : 4;
      if (options.length !== expectedOptions)
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'OPTION_COUNT',
          detail: `expected ${expectedOptions} options, found ${options.length}`,
        });
      if (options.some((option) => !nonEmpty(option)))
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'BLANK_OPTION',
          detail: 'at least one option is blank',
        });
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= options.length
      )
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'CORRECT_INDEX_RANGE',
          detail: `correctIndex ${question.correctIndex} outside 0..${options.length - 1}`,
        });
      if (
        !Number.isInteger(question.questionNumber) ||
        question.questionNumber <= 0
      )
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'BAD_QUESTION_NUMBER',
          detail: `questionNumber=${question.questionNumber}`,
        });
      if (seenNumbers.has(question.questionNumber))
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'DUPLICATE_QUESTION_NUMBER',
          detail: `questionNumber ${question.questionNumber} repeats`,
        });
      seenNumbers.add(question.questionNumber);

      // Parts 3-7 must carry readable question text. Parts 1 and 2 are spoken
      // only, so `text` is legitimately absent there.
      if (part >= 3 && !nonEmpty(question.text))
        issues.push({
          scope: `P${part} question`,
          id: question.id,
          code: 'MISSING_QUESTION_TEXT',
          detail:
            part === 3 || part === 4
              ? 'Part 3/4 needs a spoken question prompt'
              : 'reading question needs text',
        });
    }
  }

  for (const [part, expected] of Object.entries(EXPECTED_PART_COUNTS)) {
    const actual = byPart[Number(part)] ?? 0;
    if (actual !== expected)
      issues.push({
        scope: 'LR distribution',
        id: `P${part}`,
        code: 'PART_COUNT',
        detail: `expected ${expected}, found ${actual}`,
      });
  }
  if (total !== 200)
    issues.push({
      scope: 'LR distribution',
      id: 'total',
      code: 'TOTAL_COUNT',
      detail: `expected 200, found ${total}`,
    });

  return { total, byPart };
}

async function auditSpeakingWriting(prisma: PrismaClient, issues: Issue[]) {
  const assessments = await prisma.toeicAssessment.findMany({
    include: {
      components: {
        orderBy: { order: 'asc' },
        include: {
          lrExamSet: { select: { id: true } },
          speakingPracticeSet: {
            include: {
              exercises: {
                orderBy: { order: 'asc' },
                include: { stimulus: true },
              },
            },
          },
          writingSet: { include: { items: { orderBy: { order: 'asc' } } } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const summary: Array<Record<string, unknown>> = [];

  for (const assessment of assessments) {
    const scope = `${assessment.productFamily} #${assessment.id}`;
    const speaking = assessment.components.find(
      (c) => c.speakingPracticeSet,
    )?.speakingPracticeSet;
    const writing = assessment.components.find((c) => c.writingSet)?.writingSet;

    if (speaking) {
      const exercises = speaking.exercises;
      if (exercises.length !== TOEIC_SPEAKING_TASK_SEQUENCE.length)
        issues.push({
          scope,
          id: speaking.id,
          code: 'SPEAKING_TASK_COUNT',
          detail: `expected ${TOEIC_SPEAKING_TASK_SEQUENCE.length}, found ${exercises.length}`,
        });
      exercises.forEach((exercise, index) => {
        const expectedType = TOEIC_SPEAKING_TASK_SEQUENCE[index];
        if (expectedType && exercise.taskType !== expectedType)
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_TASK_ORDER',
            detail: `slot ${index + 1} expected ${expectedType}, found ${exercise.taskType}`,
          });
        if (!nonEmpty(exercise.title))
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_MISSING_TITLE',
            detail: 'exercise has no title',
          });
        if (!nonEmpty(exercise.targetText))
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_MISSING_PROMPT',
            detail: 'exercise has no targetText prompt/script',
          });
        if (
          exercise.taskType === 'DESCRIBE_PICTURE' &&
          !nonEmpty(exercise.imageUrl)
        )
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_MISSING_IMAGE',
            detail: 'DESCRIBE_PICTURE needs an image',
          });
        if (
          exercise.taskType === 'RESPOND_USING_INFORMATION' &&
          !exercise.stimulusId
        )
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_MISSING_STIMULUS',
            detail: 'RESPOND_USING_INFORMATION needs an information stimulus',
          });
        if (exercise.order === null || exercise.order === undefined)
          issues.push({
            scope,
            id: exercise.id,
            code: 'SPEAKING_MISSING_ORDER',
            detail: 'exercise has no order',
          });
      });
      summary.push({
        assessment: scope,
        speakingSetId: speaking.id,
        speakingTasks: exercises.length,
        speakingWithImage: exercises.filter((e) => nonEmpty(e.imageUrl)).length,
        speakingWithStimulus: exercises.filter((e) => e.stimulusId).length,
      });
    }

    if (writing) {
      const items = writing.items;
      if (items.length !== 8)
        issues.push({
          scope,
          id: writing.id,
          code: 'WRITING_TASK_COUNT',
          detail: `expected 8, found ${items.length}`,
        });
      // A writing slot's learner-facing prompt lives on the linked Quiz, so
      // the slot is only complete when that quiz resolves and has questions.
      for (const [index, item] of items.entries()) {
        if (!nonEmpty(item.taskKind))
          issues.push({
            scope,
            id: item.id,
            code: 'WRITING_MISSING_TASK_KIND',
            detail: `slot ${index + 1} has no taskKind`,
          });
        if (item.order === null || item.order === undefined)
          issues.push({
            scope,
            id: item.id,
            code: 'WRITING_MISSING_ORDER',
            detail: `slot ${index + 1} has no order`,
          });
        const quiz = await prisma.quiz.findUnique({
          where: { id: item.writingQuizId },
          select: {
            id: true,
            title: true,
            publicationStatus: true,
            _count: { select: { questions: true } },
          },
        });
        if (!quiz) {
          issues.push({
            scope,
            id: item.id,
            code: 'WRITING_QUIZ_MISSING',
            detail: `slot ${index + 1} references absent Quiz ${item.writingQuizId}`,
          });
          continue;
        }
        if (quiz._count.questions === 0)
          issues.push({
            scope,
            id: item.id,
            code: 'WRITING_QUIZ_EMPTY',
            detail: `slot ${index + 1} Quiz ${quiz.id} has no questions`,
          });
        if (!nonEmpty(quiz.title))
          issues.push({
            scope,
            id: item.id,
            code: 'WRITING_QUIZ_UNTITLED',
            detail: `slot ${index + 1} Quiz ${quiz.id} has no title`,
          });
      }
      summary.push({
        assessment: scope,
        writingSetId: writing.id,
        writingTasks: items.length,
      });
    }

    const dangling = assessment.components.filter(
      (c) => !c.lrExamSet && !c.speakingPracticeSet && !c.writingSet,
    );
    for (const component of dangling)
      issues.push({
        scope,
        id: component.id,
        code: 'DANGLING_COMPONENT',
        detail: 'component resolves to no child source',
      });
  }

  return summary;
}

async function main() {
  const prisma = new PrismaClient();
  const issues: Issue[] = [];
  try {
    const lr = await auditListeningReading(prisma, issues);
    const sw = await auditSpeakingWriting(prisma, issues);

    const byCode = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.code] = (acc[issue.code] ?? 0) + 1;
      return acc;
    }, {});

    console.log('=== TOEIC L&R FIELD AUDIT (all questions) ===');
    console.log(`  total questions : ${lr.total}`);
    console.log(
      `  distribution    : ${Object.entries(lr.byPart)
        .map(([part, count]) => `P${part}=${count}`)
        .join(' ')}`,
    );
    console.log('\n=== SPEAKING / WRITING ===');
    for (const row of sw) console.log(`  ${JSON.stringify(row)}`);
    console.log(`\nissues: ${issues.length} ${JSON.stringify(byCode)}`);
    for (const issue of issues.slice(0, 40))
      console.log(
        `  - [${issue.code}] ${issue.scope} ${issue.id}: ${issue.detail}`,
      );

    const out = join(
      process.cwd(),
      'artifacts',
      'toeic-field-completeness.json',
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          listeningReading: lr,
          speakingWriting: sw,
          issueCount: issues.length,
          issuesByCode: byCode,
          issues,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nartifact: ${out}`);
    console.log(
      `TOEIC_LR_CONTENT_COMPLETE=${issues.filter((i) => i.scope.startsWith('P') || i.scope.startsWith('LR')).length === 0}`,
    );
    console.log(
      `TOEIC_SW_CONTENT_COMPLETE=${issues.filter((i) => i.code.startsWith('SPEAKING') || i.code.startsWith('WRITING') || i.code === 'DANGLING_COMPONENT').length === 0}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'TOEIC field audit failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
