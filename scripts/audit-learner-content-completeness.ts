/**
 * General learner content completeness audit (spec §27-§33, §42, §43).
 *
 * Walks every published learner-facing item in the four practice skills plus
 * grammar and vocabulary, checks the fields its own type requires, and probes
 * each required media reference. "Published but missing something it needs" is
 * the condition that must reach zero, so an item is only reported when the
 * missing piece is genuinely required for that type.
 *
 * Read-only. Writes artifacts/learner-content-completeness.json.
 *
 * Usage: npx ts-node scripts/audit-learner-content-completeness.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

type Row = {
  domain: string;
  model: string;
  id: number;
  title: string;
  type: string | null;
  publication: string;
  tier: 'FREE' | 'PREMIUM';
  missingFields: string[];
  requiredMedia: number;
  mediaOk: number;
  mediaBroken: string[];
};

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const mediaCache = new Map<string, boolean>();
async function resolves(url: string): Promise<boolean> {
  if (mediaCache.has(url)) return mediaCache.get(url)!;
  let ok = false;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  mediaCache.set(url, ok);
  return ok;
}

async function main() {
  const prisma = new PrismaClient();
  const rows: Row[] = [];
  try {
    // ------------------------------------------------------------- quizzes
    const quizzes = await prisma.quiz.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      include: {
        questions: {
          include: {
            audioAssets: { where: { isActive: true } },
            diagnosticClips: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    for (const quiz of quizzes) {
      const missing: string[] = [];
      const urls: string[] = [];
      const listening = quiz.type === 'LISTENING_PRACTICE';
      const reading = quiz.type === 'BILINGUAL_READING';
      const writing =
        quiz.type === 'WRITING_EMAIL' || quiz.type === 'WRITING_PICTURE';

      if (!nonEmpty(quiz.title)) missing.push('title');
      // TOEIC paper shells intentionally hold no Quiz questions: their content
      // lives in ToeicExamSet / ToeicAssessment and is audited separately by
      // scripts/audit-toeic-field-completeness.ts.
      const toeicShell =
        quiz.type === 'TOEIC' || quiz.type === 'TOEIC_FOUR_SKILL';
      if (!quiz.questions.length && !toeicShell) missing.push('questions');

      for (const question of quiz.questions) {
        const content = (question.content ?? {}) as Record<string, unknown>;
        const label = `q${question.id}`;

        // Listening items must be playable: audio comes from an active asset,
        // a diagnostic clip, or an inline url on the question content.
        if (listening) {
          const inline = content.audioUrl ?? content.audio;
          // Premium audio lives in the private bucket, so its asset row
          // deliberately carries a storage key and a null public url: it is
          // streamed through the authorized per-question endpoint instead.
          // Presence of the asset is what makes the item complete; only the
          // public urls can be probed over HTTP.
          const hasAsset = question.audioAssets.some(
            (a) => nonEmpty(a.url) || nonEmpty(a.key),
          );
          const publicUrls = [
            ...question.audioAssets.map((a) => a.url),
            ...question.diagnosticClips.map((c) => c.url),
            ...(nonEmpty(inline) ? [inline as string] : []),
          ].filter((u): u is string => nonEmpty(u));
          if (!hasAsset && !publicUrls.length) missing.push(`${label}.audio`);
          urls.push(...publicUrls);
        }

        // Writing tasks need a prompt. An image is only required when the task
        // actually describes a picture: the sentence-builder variants are
        // driven by requiredKeywords instead, so demanding an image there
        // would report complete content as broken.
        if (writing) {
          if (!nonEmpty(content.prompt)) missing.push(`${label}.prompt`);
          const image = content.imageUrl ?? content.image;
          const needsImage =
            content.taskType === 'PICTURE' ||
            content.taskType === 'PICTURE_DESCRIPTION';
          if (needsImage && !nonEmpty(image)) missing.push(`${label}.imageUrl`);
          if (nonEmpty(image)) urls.push(image as string);
        }

        // Reading comprehension needs a passage somewhere on the quiz/question.
        if (reading) {
          const passage =
            content.passage ?? content.passageText ?? content.text ?? null;
          if (!nonEmpty(passage) && !nonEmpty(quiz.description))
            missing.push(`${label}.passage`);
        }

        // Objectively-scored questions need options and a correct answer.
        const options = asArray(content.options);
        const needsOptions =
          question.type === 'MULTIPLE_CHOICE' ||
          (!writing && question.type !== 'SPEAKING' && options.length > 0);
        if (needsOptions) {
          if (options.length < 2) missing.push(`${label}.options`);
          const answer =
            content.correctIndex ?? content.correctAnswer ?? content.answer;
          if (answer === undefined || answer === null)
            missing.push(`${label}.correctAnswer`);
        }
        // A dictation item needs the sentence to be spoken (audioText) and the
        // reference answer to grade against (correctAnswer).
        if (question.type === 'DICTATION') {
          if (!nonEmpty(content.audioText)) missing.push(`${label}.audioText`);
          if (!nonEmpty(content.correctAnswer))
            missing.push(`${label}.correctAnswer`);
        }
      }

      const unique = [...new Set(urls)];
      const broken: string[] = [];
      let ok = 0;
      for (const url of unique) {
        if (await resolves(url)) ok++;
        else broken.push(url);
      }

      rows.push({
        domain: listening
          ? 'LISTENING'
          : reading
            ? 'READING'
            : writing
              ? 'WRITING'
              : 'OTHER_QUIZ',
        model: 'Quiz',
        id: quiz.id,
        title: quiz.title,
        type: quiz.type,
        publication: quiz.publicationStatus,
        tier: quiz.isPremiumContent ? 'PREMIUM' : 'FREE',
        missingFields: missing,
        requiredMedia: unique.length,
        mediaOk: ok,
        mediaBroken: broken,
      });
    }

    // ------------------------------------------------------------ speaking
    const speaking = await prisma.speakingExercise.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      include: { stimulus: true, practiceSet: { select: { scope: true } } },
      orderBy: { id: 'asc' },
    });
    for (const exercise of speaking) {
      // TOEIC exam-internal sets are not standalone learner content.
      if (exercise.practiceSet?.scope === 'EXAM_INTERNAL') continue;
      const missing: string[] = [];
      const urls: string[] = [];
      if (!nonEmpty(exercise.title)) missing.push('title');
      if (!nonEmpty(exercise.targetText)) missing.push('targetText');
      if (!nonEmpty(exercise.difficulty)) missing.push('difficulty');
      if (exercise.taskType === 'DESCRIBE_PICTURE') {
        if (!nonEmpty(exercise.imageUrl)) missing.push('imageUrl');
        else urls.push(exercise.imageUrl!);
      }
      if (nonEmpty(exercise.audioUrl)) urls.push(exercise.audioUrl!);

      const unique = [...new Set(urls)];
      const broken: string[] = [];
      let ok = 0;
      for (const url of unique) {
        if (await resolves(url)) ok++;
        else broken.push(url);
      }

      rows.push({
        domain: 'SPEAKING',
        model: 'SpeakingExercise',
        id: exercise.id,
        title: exercise.title,
        type: exercise.taskType ?? exercise.category,
        publication: exercise.publicationStatus,
        tier: exercise.isPremiumContent ? 'PREMIUM' : 'FREE',
        missingFields: missing,
        requiredMedia: unique.length,
        mediaOk: ok,
        mediaBroken: broken,
      });
    }

    // ------------------------------------------------------------- grammar
    const grammar = await prisma.grammarTopic.findMany({
      include: { questions: true },
      orderBy: { id: 'asc' },
    });
    for (const topic of grammar) {
      const missing: string[] = [];
      if (!nonEmpty(topic.title)) missing.push('title');
      if (!topic.questions.length) missing.push('questions');
      for (const question of topic.questions) {
        const label = `q${question.id}`;
        if (!nonEmpty(question.question)) missing.push(`${label}.question`);
        if (asArray(question.options).length < 2)
          missing.push(`${label}.options`);
        if (
          question.correctIndex === null ||
          question.correctIndex === undefined
        )
          missing.push(`${label}.correctIndex`);
        if (!nonEmpty(question.explanation))
          missing.push(`${label}.explanation`);
      }
      rows.push({
        domain: 'GRAMMAR',
        model: 'GrammarTopic',
        id: topic.id,
        title: topic.title,
        type: 'GRAMMAR',
        publication: 'PUBLISHED',
        tier: 'FREE',
        missingFields: missing,
        requiredMedia: 0,
        mediaOk: 0,
        mediaBroken: [],
      });
    }

    // --------------------------------------------------------- vocabulary
    const topics = await prisma.vocabTopic.findMany({
      include: { _count: { select: { words: true } } },
      orderBy: { id: 'asc' },
    });
    for (const topic of topics) {
      if (topic.publicationStatus !== 'PUBLISHED') continue;
      const missing: string[] = [];
      if (!nonEmpty(topic.title)) missing.push('title');
      if (topic._count.words === 0) missing.push('words');
      // totalWords is denormalized metadata; a drift hides real content.
      if (topic.totalWords !== topic._count.words)
        missing.push(
          `totalWords(${topic.totalWords})!=actual(${topic._count.words})`,
        );
      rows.push({
        domain: 'VOCAB',
        model: 'VocabTopic',
        id: topic.id,
        title: topic.title,
        type: 'VOCAB_TOPIC',
        publication: topic.publicationStatus,
        tier: topic.isPro ? 'PREMIUM' : 'FREE',
        missingFields: missing,
        requiredMedia: 0,
        mediaOk: 0,
        mediaBroken: [],
      });
    }

    // ---------------------------------------------------------- reporting
    const incomplete = rows.filter(
      (row) => row.missingFields.length > 0 || row.mediaBroken.length > 0,
    );
    const byDomain: Record<
      string,
      { items: number; incomplete: number; brokenMedia: number }
    > = {};
    for (const row of rows) {
      byDomain[row.domain] ??= { items: 0, incomplete: 0, brokenMedia: 0 };
      byDomain[row.domain].items++;
      if (row.missingFields.length || row.mediaBroken.length)
        byDomain[row.domain].incomplete++;
      byDomain[row.domain].brokenMedia += row.mediaBroken.length;
    }

    console.log('=== LEARNER CONTENT COMPLETENESS ===');
    for (const [domain, stats] of Object.entries(byDomain))
      console.log(
        `  ${domain.padEnd(12)} items=${String(stats.items).padEnd(4)} incomplete=${String(stats.incomplete).padEnd(4)} brokenMedia=${stats.brokenMedia}`,
      );

    const totalMedia = rows.reduce((sum, row) => sum + row.requiredMedia, 0);
    const totalBroken = rows.reduce(
      (sum, row) => sum + row.mediaBroken.length,
      0,
    );
    console.log(
      `\nrequired media references checked: ${totalMedia} | broken: ${totalBroken}`,
    );
    console.log(`published incomplete items: ${incomplete.length}`);
    for (const row of incomplete.slice(0, 25))
      console.log(
        `  - ${row.domain} ${row.model} ${row.id} "${row.title.slice(0, 40)}" missing=[${row.missingFields.slice(0, 6).join(', ')}]${
          row.mediaBroken.length ? ` brokenMedia=${row.mediaBroken.length}` : ''
        }`,
      );

    const out = join(
      process.cwd(),
      'artifacts',
      'learner-content-completeness.json',
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          byDomain,
          totals: {
            items: rows.length,
            incomplete: incomplete.length,
            requiredMediaChecked: totalMedia,
            brokenActiveMediaReferences: totalBroken,
          },
          rows,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nartifact: ${out}`);
    console.log(`PUBLISHED_INCOMPLETE_CONTENT_COUNT=${incomplete.length}`);
    console.log(`BROKEN_ACTIVE_MEDIA_REFERENCES=${totalBroken}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Content completeness audit failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
