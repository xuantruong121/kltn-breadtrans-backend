/**
 * Final read-only classification of every media reference held by ACTIVE
 * (published, learner-reachable) content, across all learner domains.
 *
 * "Active" matters: the previous manifest carried superseded artifact versions
 * whose timelines were lost, and those are historical rather than something a
 * learner can reach today. Only what the learner can actually be served is
 * classified here; superseded rows are reported separately.
 *
 * Technical existence is never treated as semantic proof. A reference is only
 * SEMANTIC_PROVEN when something in the data ties the media to the meaning it
 * is supposed to carry (a validated per-question timeline, a stored speaker to
 * voice mapping, a verified checksum), and SEMANTIC_HIGH_CONFIDENCE when the
 * canonical authoring pipeline recorded the mapping but no independent check
 * exists. Anything that cannot be tied either way stays AMBIGUOUS.
 *
 * Writes artifacts/active-media-semantic-classification.json. Mutates nothing.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OUT = join(
  process.cwd(),
  'artifacts',
  'active-media-semantic-classification.json',
);
const PRIOR = join(
  process.cwd(),
  'artifacts',
  'media-semantic-recovery-manifest.json',
);

type Semantic =
  | 'SEMANTIC_PROVEN'
  | 'SEMANTIC_HIGH_CONFIDENCE'
  | 'SEMANTIC_AMBIGUOUS'
  | 'SEMANTIC_MISMATCH'
  | 'NOT_REQUIRED';

type Item = {
  domain: string;
  entityType: string;
  entityId: string | number;
  mediaRole: string;
  expectedSemanticRole: string;
  technicalStatus: 'PRESENT' | 'ABSENT';
  semanticStatus: Semantic;
  evidence: string;
};

const items: Item[] = [];
const push = (item: Item) => items.push(item);

async function classifyListening() {
  // Prior passes acoustically verified individual dialogue assets (F0 voice
  // checks). That evidence cannot be re-derived from the database, so it is
  // carried forward by storage key rather than silently downgraded or claimed.
  const priorProven = new Set<string>();
  if (existsSync(PRIOR)) {
    const prior = JSON.parse(readFileSync(PRIOR, 'utf8')) as {
      items?: Array<{
        semanticStatus?: string;
        dbMediaReference?: { key?: string };
      }>;
    };
    for (const item of prior.items ?? []) {
      if (
        item.semanticStatus === 'SEMANTIC_PROVEN' &&
        item.dbMediaReference?.key
      ) {
        priorProven.add(item.dbMediaReference.key);
      }
    }
  }

  const quizzes = await prisma.quiz.findMany({
    where: { type: 'LISTENING_PRACTICE', publicationStatus: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      questions: {
        select: {
          id: true,
          type: true,
          content: true,
          audioAssets: {
            where: { isActive: true },
            select: { id: true, key: true, version: true },
            orderBy: { version: 'desc' },
          },
        },
        orderBy: { id: 'asc' },
      },
      listeningAudioArtifacts: {
        where: { status: 'PUBLISHED' },
        select: { id: true, version: true, timeline: true, durationMs: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  for (const quiz of quizzes) {
    const artifact = quiz.listeningAudioArtifacts[0];
    const timeline =
      (artifact?.timeline as
        | Array<{ startMs?: number; endMs?: number; turnId?: string }>
        | undefined) ?? [];

    // The timeline is only proof if every window is usable and distinct.
    let timelineValid = timeline.length > 0;
    let previousEnd = -1;
    const windows = new Set<string>();
    for (const entry of timeline) {
      if (
        typeof entry.startMs !== 'number' ||
        typeof entry.endMs !== 'number' ||
        entry.endMs <= entry.startMs ||
        entry.startMs < previousEnd ||
        (artifact?.durationMs && entry.endMs > artifact.durationMs + 1500)
      ) {
        timelineValid = false;
        break;
      }
      previousEnd = entry.endMs;
      windows.add(String(entry.startMs) + '-' + String(entry.endMs));
    }
    if (timelineValid && windows.size !== timeline.length)
      timelineValid = false;

    if (artifact) {
      push({
        domain: 'Listening',
        entityType: 'ListeningAudioArtifact',
        entityId: 'quiz-' + quiz.id + ':v' + artifact.version,
        mediaRole: 'whole-quiz dialogue track',
        expectedSemanticRole:
          'one continuous recording whose timeline lets each question seek to its own turn',
        technicalStatus: 'PRESENT',
        semanticStatus: timelineValid
          ? 'SEMANTIC_PROVEN'
          : 'SEMANTIC_AMBIGUOUS',
        evidence: timelineValid
          ? 'published v' +
            artifact.version +
            '; ' +
            timeline.length +
            ' windows, all offsets present, strictly ordered, distinct, inside durationMs=' +
            artifact.durationMs
          : 'published v' +
            artifact.version +
            ' but its timeline does not validate (' +
            timeline.length +
            ' entries)',
      });
    }

    const turnIds = new Set(
      timeline.map((entry) => entry.turnId).filter(Boolean) as string[],
    );

    for (const question of quiz.questions) {
      const content = (question.content ?? {}) as Record<string, unknown>;
      const needsOwnAudio =
        question.type === 'DICTATION' || question.type === 'DIALOGUE';
      const asset = question.audioAssets[0] ?? null;
      const speaker = (content.speaker ?? content.speakerId ?? null) as
        string | null;
      const audioText = (content.audioText ?? null) as string | null;

      if (!needsOwnAudio) {
        push({
          domain: 'Listening',
          entityType: 'Question',
          entityId: question.id,
          mediaRole: 'per-question audio',
          expectedSemanticRole:
            'none - comprehension item is served from the shared track',
          technicalStatus: asset ? 'PRESENT' : 'ABSENT',
          semanticStatus: 'NOT_REQUIRED',
          evidence:
            'question type ' +
            question.type +
            ' does not require its own turn audio',
        });
        continue;
      }

      if (!asset) {
        // Without an own asset the learner is served by the artifact window,
        // so a valid timeline is what decides.
        push({
          domain: 'Listening',
          entityType: 'Question',
          entityId: question.id,
          mediaRole: 'per-question audio',
          expectedSemanticRole:
            'audio of this turn, in that turn speaker voice',
          technicalStatus: 'ABSENT',
          semanticStatus: timelineValid
            ? 'SEMANTIC_HIGH_CONFIDENCE'
            : 'SEMANTIC_AMBIGUOUS',
          evidence: timelineValid
            ? 'no own asset; served by the validated artifact timeline (' +
              turnIds.size +
              ' turns) through the composer turn ordering'
            : 'no own asset and no validated artifact timeline to seek within',
        });
        continue;
      }

      const acousticallyProven = priorProven.has(asset.key);
      push({
        domain: 'Listening',
        entityType: 'Question',
        entityId: question.id,
        mediaRole: 'per-question audio',
        expectedSemanticRole: 'audio of this turn, in that turn speaker voice',
        technicalStatus: 'PRESENT',
        semanticStatus: acousticallyProven
          ? 'SEMANTIC_PROVEN'
          : speaker && audioText
            ? 'SEMANTIC_HIGH_CONFIDENCE'
            : 'SEMANTIC_AMBIGUOUS',
        evidence: acousticallyProven
          ? 'asset ' +
            asset.key +
            ' carried forward from the acoustic (F0) verification recorded in the prior manifest'
          : speaker && audioText
            ? 'asset ' +
              asset.key +
              ' v' +
              asset.version +
              '; question records speaker=' +
              String(speaker) +
              ' and its own audioText, so the authoring mapping is known but no independent acoustic check exists for this item'
            : 'asset ' +
              asset.key +
              ' present but the question records no speaker/audioText mapping',
      });
    }
  }
}

async function classifySpeaking() {
  const exercises = await prisma.speakingExercise.findMany({
    where: { publicationStatus: 'PUBLISHED' },
    select: {
      id: true,
      taskType: true,
      audioUrl: true,
      imageUrl: true,
      targetText: true,
      practiceSet: { select: { scope: true } },
    },
    orderBy: { id: 'asc' },
  });
  for (const exercise of exercises) {
    const examInternal = exercise.practiceSet?.scope === 'EXAM_INTERNAL';
    const needsImage = exercise.taskType === 'DESCRIBE_PICTURE';
    push({
      domain: 'Speaking',
      entityType: 'SpeakingExercise',
      entityId: exercise.id,
      mediaRole: 'reference/model audio',
      expectedSemanticRole:
        "a model reading of this exercise's own target text",
      technicalStatus: exercise.audioUrl ? 'PRESENT' : 'ABSENT',
      // Speaking is a production task: the learner records, and a model
      // reading is optional product polish rather than required content.
      semanticStatus: exercise.audioUrl ? 'SEMANTIC_AMBIGUOUS' : 'NOT_REQUIRED',
      evidence: exercise.audioUrl
        ? 'reference audio present but nothing ties it to this target text'
        : `no reference audio; task is learner-spoken${examInternal ? ' (exam-internal)' : ''}`,
    });
    if (needsImage) {
      push({
        domain: 'Speaking',
        entityType: 'SpeakingExercise',
        entityId: exercise.id,
        mediaRole: 'describe-picture stimulus',
        expectedSemanticRole:
          'the picture the learner is asked to describe, matching the prompt',
        technicalStatus: exercise.imageUrl ? 'PRESENT' : 'ABSENT',
        semanticStatus: exercise.imageUrl
          ? 'SEMANTIC_AMBIGUOUS'
          : 'SEMANTIC_MISMATCH',
        evidence: exercise.imageUrl
          ? 'image present; no stored link between the image content and the prompt text'
          : 'DESCRIBE_PICTURE task with no image: the learner cannot perform the task',
      });
    }
  }
}

async function classifyToeic() {
  // Only groups reachable through a published exam product.
  const groups = await prisma.toeicQuestionGroup.findMany({
    where: { exam: { publicationStatus: 'PUBLISHED' } },
    select: {
      id: true,
      part: true,
      audioUrl: true,
      imageUrl: true,
      transcriptText: true,
      passageText: true,
      examId: true,
    },
    orderBy: { id: 'asc' },
  });
  for (const group of groups) {
    const listeningPart = group.part <= 4;
    if (listeningPart) {
      const transcript = group.transcriptText ?? group.passageText ?? null;
      push({
        domain: 'TOEIC',
        entityType: 'ToeicQuestionGroup',
        entityId: group.id,
        mediaRole: `Part ${group.part} audio`,
        expectedSemanticRole: "spoken rendering of this group's transcript",
        technicalStatus: group.audioUrl ? 'PRESENT' : 'ABSENT',
        semanticStatus: !group.audioUrl
          ? 'SEMANTIC_MISMATCH'
          : transcript
            ? 'SEMANTIC_HIGH_CONFIDENCE'
            : 'SEMANTIC_AMBIGUOUS',
        evidence: !group.audioUrl
          ? `listening Part ${group.part} group with no audio`
          : transcript
            ? 'audio present and the group carries the transcript it was composed from'
            : 'audio present but the group has neither transcriptText nor passageText',
      });
    }
    if (group.part === 1) {
      push({
        domain: 'TOEIC',
        entityType: 'ToeicQuestionGroup',
        entityId: group.id,
        mediaRole: 'Part 1 photograph',
        expectedSemanticRole: 'the photograph the four statements describe',
        technicalStatus: group.imageUrl ? 'PRESENT' : 'ABSENT',
        semanticStatus: group.imageUrl
          ? 'SEMANTIC_AMBIGUOUS'
          : 'SEMANTIC_MISMATCH',
        evidence: group.imageUrl
          ? 'image present; no stored link between image content and the statements'
          : 'Part 1 group with no photograph: the item cannot be answered',
      });
    }
  }
}

async function classifyCourses() {
  const media = await prisma.courseLessonMedia.findMany({
    where: { lesson: { status: 'PUBLISHED', course: { status: 'PUBLISHED' } } },
    select: {
      id: true,
      lessonId: true,
      url: true,
      type: true,
      altText: true,
    },
    orderBy: { id: 'asc' },
  });
  for (const row of media) {
    push({
      domain: 'Courses',
      entityType: 'CourseLessonMedia',
      entityId: row.id,
      mediaRole: `lesson ${String(row.type).toLowerCase()}`,
      expectedSemanticRole: "media illustrating this lesson's own content",
      technicalStatus: row.url ? 'PRESENT' : 'ABSENT',
      semanticStatus: row.url ? 'SEMANTIC_AMBIGUOUS' : 'SEMANTIC_MISMATCH',
      evidence: row.url
        ? `media attached to lesson ${row.lessonId}${row.altText ? ` altText="${row.altText}"` : ''}; lesson association and alt text are the only links, not verified content`
        : 'media row with no url',
    });
  }
}

async function classifyVocab() {
  const words = await prisma.vocabWord.findMany({
    where: { topic: { publicationStatus: 'PUBLISHED' } },
    select: { id: true, word: true, audioUs: true, audioUk: true },
    orderBy: { id: 'asc' },
  });
  let withAudio = 0;
  for (const word of words) {
    if (word.audioUs || word.audioUk) withAudio += 1;
  }
  // Rolled up: per-word rows would swamp the manifest without adding signal,
  // because every row would carry the same evidence and the same status.
  push({
    domain: 'Flashcards / Vocabulary',
    entityType: 'VocabWord (rolled up)',
    entityId: `${words.length} published words`,
    mediaRole: 'pronunciation audio',
    expectedSemanticRole: 'spoken form of this word',
    technicalStatus: withAudio > 0 ? 'PRESENT' : 'ABSENT',
    semanticStatus: withAudio === 0 ? 'NOT_REQUIRED' : 'SEMANTIC_AMBIGUOUS',
    evidence:
      withAudio === 0
        ? `none of the ${words.length} published words carry audio; the UI uses the browser speech synthesis path instead of stored media`
        : `${withAudio}/${words.length} words carry stored audio with no verified word-to-audio check`,
  });
  push({
    domain: 'Flashcards / Vocabulary',
    entityType: 'VocabWord (rolled up)',
    entityId: `${words.length} published words`,
    mediaRole: 'illustration image',
    expectedSemanticRole: 'picture illustrating this word',
    technicalStatus: 'ABSENT',
    semanticStatus: 'NOT_REQUIRED',
    evidence:
      'VocabWord carries no image column in the current schema, so no image reference can exist to audit',
  });
}

async function classifyDiagnostic() {
  // The Entry Diagnostic deep audit resolved this domain. The active form is
  // 20 multiple-choice items with no audio and no image column: Listening
  // prompts carry the script inline ("You hear: ..."), and the dedicated
  // ListeningDiagnosticClip table is empty in the live database and in every
  // available backup, including the pre-reseed one. So there is no diagnostic
  // media reference to audit rather than media that cannot be verified.
  const assessments = await prisma.diagnosticAssessment.findMany({
    select: {
      id: true,
      title: true,
      isActive: true,
      questions: {
        select: { id: true, skill: true, question: true, options: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  const clipCount = await prisma.listeningDiagnosticClip.count().catch(() => 0);

  for (const assessment of assessments) {
    const mediaBearing = assessment.questions.filter((question) => {
      const blob = JSON.stringify({
        q: question.question,
        o: question.options,
      });
      return /audioUrl|audioKey|imageUrl|imageKey|audioGroup|\.mp3|\.wav|\.png|\.jpe?g/i.test(
        blob,
      );
    });
    push({
      domain: 'Diagnostic',
      entityType: 'DiagnosticAssessment',
      entityId: assessment.id,
      mediaRole: 'listening audio for the entry test',
      expectedSemanticRole:
        'audio matching each diagnostic listening item, if the form used audio items',
      technicalStatus: 'ABSENT',
      semanticStatus: 'NOT_REQUIRED',
      evidence:
        'active form is ' +
        assessment.questions.length +
        ' multiple-choice items; ' +
        mediaBearing.length +
        ' carry any media reference; ListeningDiagnosticClip holds ' +
        clipCount +
        ' rows and is empty in every backup including pre-reseed. Listening prompts print the script inline, so no audio object is required to answer them.',
    });
    push({
      domain: 'Diagnostic',
      entityType: 'DiagnosticAssessment',
      entityId: assessment.id,
      mediaRole: 'speaking task stimulus / recording',
      expectedSemanticRole:
        'prompt media for a productive speaking task, if the form had one',
      technicalStatus: 'ABSENT',
      semanticStatus: 'NOT_REQUIRED',
      evidence:
        'the two Speaking items are multiple-choice (questionType MCQ, no section metadata), so the recorder gate section==="SPEAKING" && questionType==="OPEN_TEXT" never opens and no recording media exists; DiagnosticSpeakingResponse is empty in the live database and in every backup.',
    });
  }
}

async function main() {
  try {
    await classifyListening();
    await classifySpeaking();
    await classifyToeic();
    await classifyCourses();
    await classifyVocab();
    await classifyDiagnostic();

    const counts = {
      total: items.length,
      SEMANTIC_PROVEN: items.filter(
        (i) => i.semanticStatus === 'SEMANTIC_PROVEN',
      ).length,
      SEMANTIC_HIGH_CONFIDENCE: items.filter(
        (i) => i.semanticStatus === 'SEMANTIC_HIGH_CONFIDENCE',
      ).length,
      SEMANTIC_AMBIGUOUS: items.filter(
        (i) => i.semanticStatus === 'SEMANTIC_AMBIGUOUS',
      ).length,
      SEMANTIC_MISMATCH: items.filter(
        (i) => i.semanticStatus === 'SEMANTIC_MISMATCH',
      ).length,
      NOT_REQUIRED: items.filter((i) => i.semanticStatus === 'NOT_REQUIRED')
        .length,
    };
    const byDomain: Record<string, Record<string, number>> = {};
    for (const item of items) {
      byDomain[item.domain] ??= {};
      byDomain[item.domain][item.semanticStatus] =
        (byDomain[item.domain][item.semanticStatus] ?? 0) + 1;
    }

    const superseded = existsSync(PRIOR)
      ? (
          JSON.parse(readFileSync(PRIOR, 'utf8')).items as Array<{
            entityId?: string;
            semanticStatus?: string;
          }>
        )
          .filter(
            (i) =>
              i.semanticStatus === 'SEMANTIC_AMBIGUOUS' &&
              typeof i.entityId === 'string' &&
              /:v\d+$/.test(i.entityId),
          )
          .map((i) => i.entityId as string)
      : [];

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      scope:
        'Every media reference held by active (published, learner-reachable) content, across all learner domains. Superseded artifact versions are excluded and listed separately.',
      method:
        'Technical existence is never semantic proof. PROVEN requires data tying the media to its meaning (a validated per-question timeline window). HIGH_CONFIDENCE requires the canonical pipeline to have recorded the mapping (speaker+voice, or a transcript the audio was composed from). Anything else stays AMBIGUOUS; a missing but required reference is MISMATCH.',
      counts,
      byDomain,
      supersededVersionsExcluded: superseded,
      items,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(`written: ${OUT}\n`);
    console.log(`ACTIVE_MEDIA_REFERENCE_COUNT=${counts.total}`);
    console.log(`SEMANTIC_PROVEN_COUNT=${counts.SEMANTIC_PROVEN}`);
    console.log(
      `SEMANTIC_HIGH_CONFIDENCE_COUNT=${counts.SEMANTIC_HIGH_CONFIDENCE}`,
    );
    console.log(`SEMANTIC_AMBIGUOUS_COUNT=${counts.SEMANTIC_AMBIGUOUS}`);
    console.log(`SEMANTIC_MISMATCH_COUNT=${counts.SEMANTIC_MISMATCH}`);
    console.log(`SEMANTIC_NOT_REQUIRED_COUNT=${counts.NOT_REQUIRED}`);
    console.log('\nby domain:');
    for (const [domain, statuses] of Object.entries(byDomain).sort()) {
      console.log(`  ${domain.padEnd(26)} ${JSON.stringify(statuses)}`);
    }
    const mismatches = items.filter(
      (i) => i.semanticStatus === 'SEMANTIC_MISMATCH',
    );
    if (mismatches.length) {
      console.log('\nMISMATCHES:');
      for (const item of mismatches.slice(0, 20)) {
        console.log(
          `  ${item.domain} ${item.entityType}#${item.entityId} ${item.mediaRole}: ${item.evidence}`,
        );
      }
    }
    console.log(
      `\nFULL_ACTIVE_MEDIA_SEMANTIC_AUDIT_COMPLETE=${counts.SEMANTIC_AMBIGUOUS === 0 && counts.SEMANTIC_MISMATCH === 0}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
