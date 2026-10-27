/**
 * Owner policy for standalone skill practice, applied to authored data:
 *  - Speaking practice is regrouped from title-prefix "cards" into real
 *    SpeakingPracticeSet rows: one task type and one level group per set
 *    (Cơ bản A1–A2 / Trung cấp B1–B2 / Nâng cao C1–C2), at least five tasks.
 *    Short groups get original tasks (EXTRA below). Untagged titles get their
 *    CEFR tag, so the level is visible and auditable.
 *  - isPremiumContent of every standalone practice item is synced with the
 *    policy (A1/A2 free, B1+ PLUS) that the access services enforce.
 *  - Media of items that became premium move to private keys; new tasks get
 *    reference/question audio (Azure neural TTS, F0, cached by slug).
 *
 * Modes (each guarded; target is a database URL or env:DATABASE_URL):
 *   plan      read-only report.
 *   apply     sets, regrouping, retitles, flags, new tasks (DRAFT), backup
 *             first. PRACTICE_LEVEL_APPLY_AUTHORIZED=apply.
 *   tts       synthesize missing clips for new tasks into
 *             artifacts/speaking-practice-new (cached).
 *             SPEAKING_PRACTICE_TTS_AUTHORIZED=generate.
 *   media     upload new-task clips; copy public media of now-premium items
 *             to private keys and repoint them (verified sha256, never
 *             overwrites a different object). PRACTICE_MEDIA_AUTHORIZED=publish.
 *   revoke    delete the old public copies recorded by `media`.
 *             PRACTICE_MEDIA_REVOKE_AUTHORIZED=delete.
 *   ready     publish new tasks that have audio and sets that are complete.
 *   validate  read-only acceptance checks; exits 1 on any failure.
 *
 * Usage: npx ts-node --transpile-only scripts/practice-level-normalization.ts <mode> --target <url|env:DATABASE_URL>
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

import {
  escapeXml,
  LISTENING_VOICE_REGISTRY,
} from '../src/modules/quiz/listening-audio-authoring.service';
import {
  levelGroup,
  parseCefrRange,
  practiceRequiresPlus,
} from '../src/modules/subscription/practice-level';

const IMG = 'catalog/toeic/shared/images';

/** Reviewed grouping of the 30 authored items, with the reason for each level. */
const SETS = [
  {
    id: 'practice-read-aloud-a1-a2',
    title: 'Đọc thành tiếng — Cơ bản',
    description:
      'Đọc to câu thông báo và tin nhắn đời thường với nhịp điệu rõ ràng.',
    category: 'GENERAL',
    level: 'A1-A2',
    taskType: 'READ_ALOUD',
    members: [1, 2, 3, 4, 5],
  },
  {
    id: 'practice-read-aloud-b1-b2',
    title: 'Đọc thành tiếng — Ngữ cảnh công việc',
    description:
      'Đọc thông báo công sở và dịch vụ có câu ghép, số liệu và từ chuyên ngành.',
    category: 'BUSINESS',
    level: 'B1-B2',
    taskType: 'READ_ALOUD',
    members: [6, 7, 8, 9, 10, 25, 26],
  },
  {
    id: 'practice-pronunciation-b1',
    title: 'Nền tảng phát âm — Trung cấp',
    description:
      'Âm cuối, đuôi -ed, trọng âm, số liệu và nối âm trong câu công việc.',
    category: 'GENERAL',
    level: 'B1',
    taskType: 'PRONUNCIATION_DRILL',
    members: [11, 12, 13, 14, 15],
  },
  {
    id: 'practice-describe-picture-b1',
    title: 'Mô tả tranh — Trung cấp',
    description:
      'Mô tả người, hành động và bối cảnh trong ảnh bằng câu hoàn chỉnh.',
    category: 'TOEIC',
    level: 'B1',
    taskType: 'DESCRIBE_PICTURE',
    members: [27, 28],
  },
  {
    id: 'practice-information-response-b1-b2',
    title: 'Trả lời dựa trên thông tin — Trung cấp',
    description:
      'Đọc lịch, bảng giờ hoặc thông báo rồi trả lời câu hỏi bằng thông tin chính xác.',
    category: 'TOEIC',
    level: 'B1-B2',
    taskType: 'RESPOND_USING_INFORMATION',
    members: [29],
  },
  {
    id: 'practice-question-response-a2',
    title: 'Phản hồi câu hỏi — Đời sống (Cơ bản)',
    description:
      'Trả lời câu hỏi quen thuộc về sinh hoạt hằng ngày bằng câu ngắn, rõ ý.',
    category: 'DAILY_LIFE',
    level: 'A2',
    taskType: 'RESPOND_TO_QUESTION',
    members: [16, 17],
  },
  {
    id: 'practice-question-response-b1-b2',
    title: 'Phản hồi câu hỏi — Học tập & Công việc',
    description:
      'Trả lời câu hỏi về học tập và công việc, có giải thích và ví dụ.',
    category: 'GENERAL',
    level: 'B1-B2',
    taskType: 'RESPOND_TO_QUESTION',
    members: [18, 19, 20],
  },
  {
    id: 'practice-opinion-b1-b2',
    title: 'Trình bày quan điểm — Trung cấp',
    description:
      'Nêu ý kiến có lý do và ví dụ về chủ đề đời sống và công việc.',
    category: 'GENERAL',
    level: 'B1-B2',
    taskType: 'EXPRESS_OPINION',
    members: [21, 22, 23, 24, 30],
  },
  {
    id: 'practice-opinion-c1',
    title: 'Trình bày quan điểm — Nâng cao',
    description:
      'Lập luận nhiều chiều, cân nhắc lợi hại và bảo vệ quan điểm về vấn đề xã hội, nghề nghiệp.',
    category: 'ACADEMIC',
    level: 'C1',
    taskType: 'EXPRESS_OPINION',
    members: [] as number[],
  },
] as const;

/** Authored items whose title had no CEFR tag; the tag is added (old → new). */
const RETITLE: Record<number, [string, string]> = {
  11: [
    'Pronunciation — Final Consonants',
    'Pronunciation B1 — Final Consonants',
  ],
  12: ['Pronunciation — -ed Endings', 'Pronunciation B1 — -ed Endings'],
  13: ['Pronunciation — Word Stress', 'Pronunciation B1 — Word Stress'],
  14: ['Pronunciation — Numbers & Dates', 'Pronunciation B1 — Numbers & Dates'],
  15: ['Pronunciation — Linking', 'Pronunciation B1 — Linking'],
  25: ['TOEIC Speaking — Read Aloud 1', 'Read Aloud B1 — Conference Center'],
  26: ['TOEIC Speaking — Read Aloud 2', 'Read Aloud B1 — Parking Notice'],
  27: [
    'TOEIC Speaking — Describe Office Scene',
    'Describe a Picture B1 — Office Meeting',
  ],
  28: [
    'TOEIC Speaking — Describe Station Scene',
    'Describe a Picture B1 — Train Station',
  ],
  29: [
    'TOEIC Speaking — Information Response',
    'Information Response B2 — Seminar Schedule',
  ],
  30: ['TOEIC Speaking — Express Opinion', 'Opinion B2 — Free Staff Lunches'],
};

/** Original tasks that bring each short set to five. */
const EXTRA = [
  {
    slug: 'qr-a2-free-time',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Free Time',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'What do you like to do in your free time, and who do you usually do it with?',
  },
  {
    slug: 'qr-a2-favourite-meal',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Favourite Meal',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'What is your favourite meal, and when do you usually eat it?',
  },
  {
    slug: 'qr-a2-home-area',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Where You Live',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Describe the area where you live. What do you like about it?',
  },
  {
    slug: 'qr-b1-new-skill',
    set: 'practice-question-response-b1-b2',
    title: 'Question Response B1 — Learning a Skill',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Tell me about a skill you learned recently. How did you learn it, and how long did it take?',
  },
  {
    slug: 'qr-b2-adapting-to-change',
    set: 'practice-question-response-b1-b2',
    title: 'Question Response B2 — Adapting to Change',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Describe a change at your school or workplace that affected you. How did you adapt to it, and what did you learn?',
  },
  {
    slug: 'dp-b1-checkout',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Supermarket Checkout',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/grocery-checkout.png`,
    text: 'Describe a supermarket checkout where a customer is paying by card while a cashier scans a jar. Talk about the people, what they are doing and the items on the counter.',
  },
  {
    slug: 'dp-b1-bicycle-rack',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Office Entrance',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/bicycle-rack.png`,
    text: 'Describe the entrance of an office building where several bicycles are parked in a metal rack near a large glass door.',
  },
  {
    slug: 'dp-b1-delivery',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Shop Delivery',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/delivery-boxes.png`,
    text: 'Describe a delivery worker carrying three cardboard boxes into a small shop while a van with its back door open is parked outside.',
  },
  {
    slug: 'ir-b2-office-move',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Office Move',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Office move — Friday',
      content:
        '8:00 Pack your desk and label the boxes. 11:00 Movers arrive. 1:00 Lunch is provided in the break room. 3:00 IT sets up computers in the new office on the fourth floor.',
    },
    text: 'A colleague asks what will happen after lunch on moving day. Using the schedule, explain the afternoon plan and what they need to do.',
  },
  {
    slug: 'ir-b2-evening-course',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Evening Course',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Course: Customer Service Skills',
      content:
        'Mondays and Wednesdays, 6:00 to 8:00 p.m. Room 210. Fee: 45 dollars, materials included. Register by May 3.',
    },
    text: 'A caller wants to join the course but finishes work at 5:30 p.m. Using the information, tell them when and where it meets, what it costs and when they must register.',
  },
  {
    slug: 'ir-b1-library-hours',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B1 — Library Hours',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'City Library — Opening hours',
      content:
        'Monday to Thursday 9:00 to 20:00. Friday 9:00 to 17:00. Saturday 10:00 to 16:00. Sunday closed. Study rooms can be booked online up to seven days ahead.',
    },
    text: 'Someone wants to study at the library on Friday evening with two friends. Using the information, explain whether this is possible and suggest another time.',
  },
  {
    slug: 'ir-b2-airport-shuttle',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Airport Shuttle',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Hotel shuttle to the airport',
      content:
        'Departures: 6:00, 8:30, 11:00 and 15:30. The trip takes 40 minutes. Free for hotel guests, 12 dollars for visitors. Book at the front desk.',
    },
    text: 'A guest has a 2:00 p.m. flight and must be at the airport two hours early. Using the timetable, recommend a shuttle and explain why.',
  },
  {
    slug: 'op-c1-ai-hiring',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — AI in Hiring',
    taskType: 'EXPRESS_OPINION',
    text: 'To what extent should companies rely on artificial intelligence when deciding whom to hire? Weigh the benefits against the risks and explain your position.',
  },
  {
    slug: 'op-c1-urban-development',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Urban Development',
    taskType: 'EXPRESS_OPINION',
    text: 'Rapid urban development often improves infrastructure but can push long-standing communities out of their neighbourhoods. How should city planners balance these competing priorities?',
  },
  {
    slug: 'op-c1-university-purpose',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Purpose of University',
    taskType: 'EXPRESS_OPINION',
    text: 'Some argue that universities should prepare students for specific careers rather than provide a broad education. Evaluate both views and justify your conclusion.',
  },
  {
    slug: 'op-c1-environmental-responsibility',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Environmental Responsibility',
    taskType: 'EXPRESS_OPINION',
    text: 'Should individuals or governments bear greater responsibility for reducing environmental damage? Build a reasoned argument and support it with examples.',
  },
  {
    slug: 'op-c1-remote-collaboration',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Remote Collaboration',
    taskType: 'EXPRESS_OPINION',
    text: 'Remote collaboration has become routine in many industries. Assess its long-term impact on team culture and on how junior employees develop professionally.',
  },
] as const;

const PRACTICE_QUIZ_TYPES = [
  'LISTENING_PRACTICE',
  'BILINGUAL_READING',
  'WRITING_PICTURE',
  'WRITING_EMAIL',
];
/** Quiz whose title range overstated its demand (three A2 keyword sentences). */
const QUIZ_RETITLE: Record<number, [string, string]> = {
  3: ['Writing A2–B1 — Sentence Builder', 'Writing A2 — Sentence Builder'],
};
const CATEGORY_IDS: Record<string, number> = {
  GENERAL: 1,
  TOEIC: 2,
  BUSINESS: 3,
  ACADEMIC: 4,
  DAILY_LIFE: 5,
};
const DIFFICULTY: Record<string, string> = {
  BASIC: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
};
const AUDIO_DIR = 'artifacts/speaking-practice-new';
const MEDIA_LOG = 'artifacts/speaking-practice-new/media-moves.json';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function setLevel(levelText: string) {
  const range = parseCefrRange(levelText)!;
  return {
    range,
    group: levelGroup(range)!,
    premium: practiceRequiresPlus(range),
  };
}

function storage() {
  const e = process.env;
  const pub = new S3Client({
    region: 'auto',
    endpoint:
      e.R2_ENDPOINT || `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: e.R2_ACCESS_KEY_ID!,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: e.R2_FORCE_PATH_STYLE === 'true',
  });
  const priv = new S3Client({
    region: 'auto',
    endpoint:
      e.R2_PRIVATE_ENDPOINT ||
      e.R2_ENDPOINT ||
      `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: e.R2_PRIVATE_ACCESS_KEY_ID || e.R2_ACCESS_KEY_ID!,
      secretAccessKey:
        e.R2_PRIVATE_SECRET_ACCESS_KEY || e.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: e.R2_PRIVATE_FORCE_PATH_STYLE === 'true',
  });
  return {
    pub,
    priv,
    pubBucket: e.R2_BUCKET_NAME!,
    privBucket: e.R2_PRIVATE_BUCKET_NAME!,
    pubBase: e.R2_PUBLIC_URL!.replace(/\/$/, ''),
  };
}

async function read(client: S3Client, Bucket: string, Key: string) {
  const res = await client.send(new GetObjectCommand({ Bucket, Key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
async function exists(client: S3Client, Bucket: string, Key: string) {
  return client
    .send(new HeadObjectCommand({ Bucket, Key }))
    .then(() => true)
    .catch(() => false);
}
/** Writes body at key unless an identical object exists; refuses a different one. */
async function putOnce(
  client: S3Client,
  Bucket: string,
  Key: string,
  body: Buffer,
  ContentType: string,
) {
  if (await exists(client, Bucket, Key)) {
    if (sha(await read(client, Bucket, Key)) !== sha(body))
      throw new Error(`REFUSED: ${Key} exists with different content`);
    return 'same';
  }
  await client.send(
    new PutObjectCommand({ Bucket, Key, Body: body, ContentType }),
  );
  if (sha(await read(client, Bucket, Key)) !== sha(body))
    throw new Error(`STOP: ${Key} read-back mismatch`);
  return 'uploaded';
}

async function guardExisting(prisma: PrismaClient) {
  const rows = await prisma.speakingExercise.findMany({
    where: { id: { in: SETS.flatMap((s) => [...s.members]) } },
  });
  for (const set of SETS)
    for (const id of set.members) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`STOP: speaking exercise ${id} missing`);
      const allowed = RETITLE[id] ? RETITLE[id] : [row.title, row.title];
      if (!allowed.includes(row.title))
        throw new Error(
          `STOP: exercise ${id} title "${row.title}" not as reviewed`,
        );
      if (row.taskType !== set.taskType)
        throw new Error(
          `STOP: exercise ${id} is ${row.taskType}, set ${set.id} is ${set.taskType}`,
        );
      const tagged = parseCefrRange(RETITLE[id]?.[1] ?? row.title);
      if (!tagged) throw new Error(`STOP: exercise ${id} has no CEFR tag`);
      if (levelGroup(tagged) !== setLevel(set.level).group)
        throw new Error(
          `STOP: exercise ${id} (${tagged.min}) outside set ${set.id}`,
        );
      if (row.practiceSetId && row.practiceSetId !== set.id)
        throw new Error(
          `STOP: exercise ${id} already in set ${row.practiceSetId}`,
        );
    }
  return rows;
}

async function standaloneQuizzes(prisma: PrismaClient) {
  return prisma.quiz.findMany({
    where: {
      type: { in: PRACTICE_QUIZ_TYPES as never },
      courseId: null,
      publicationStatus: 'PUBLISHED',
      toeicWritingSetItems: { none: {} },
      courseActivities: { none: {} },
    },
    select: { id: true, title: true, type: true, isPremiumContent: true },
    orderBy: { id: 'asc' },
  });
}

async function plan(prisma: PrismaClient) {
  await guardExisting(prisma);
  console.log('Speaking sets:');
  for (const set of SETS) {
    const extra = EXTRA.filter((x) => x.set === set.id).length;
    const lvl = setLevel(set.level);
    console.log(
      `  ${set.id}: ${set.level} ${lvl.group} ${set.taskType} existing ${set.members.length} + new ${extra} = ${set.members.length + extra} ${lvl.premium ? 'PLUS' : 'FREE'}`,
    );
  }
  console.log('Quiz flags:');
  for (const q of await standaloneQuizzes(prisma)) {
    const title = QUIZ_RETITLE[q.id]?.[1] ?? q.title;
    const range = parseCefrRange(title);
    if (!range)
      throw new Error(
        `STOP: standalone practice quiz ${q.id} "${q.title}" has no CEFR tag`,
      );
    const want = practiceRequiresPlus(range);
    if (want !== q.isPremiumContent || title !== q.title)
      console.log(
        `  quiz ${q.id} "${q.title}" → ${title !== q.title ? `"${title}" ` : ''}${want ? 'PLUS' : 'FREE'} (was ${q.isPremiumContent ? 'PLUS' : 'FREE'})`,
      );
  }
}

async function apply(prisma: PrismaClient, label: string) {
  if (process.env.PRACTICE_LEVEL_APPLY_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: PRACTICE_LEVEL_APPLY_AUTHORIZED=apply not set');
  const rows = await guardExisting(prisma);
  const quizzes = await standaloneQuizzes(prisma);
  for (const [id, [from, to]] of Object.entries(QUIZ_RETITLE)) {
    const q = quizzes.find((x) => x.id === Number(id));
    if (!q || (q.title !== from && q.title !== to))
      throw new Error(`STOP: quiz ${id} not as reviewed`);
  }
  const dir = resolve('..', '..', '.local-backups', 'practice-level');
  mkdirSync(dir, { recursive: true });
  const file = join(
    dir,
    `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        speakingExercises: rows,
        quizzes,
        sets: await prisma.speakingPracticeSet.findMany({
          where: { id: { in: SETS.map((s) => s.id) } },
        }),
      },
      null,
      2,
    ),
  );
  console.log(`backup: ${file}`);
  await prisma.$transaction(async (tx) => {
    for (const set of SETS) {
      const lvl = setLevel(set.level);
      const data = {
        title: set.title,
        description: set.description,
        category: set.category,
        categoryId: CATEGORY_IDS[set.category],
        level: set.level,
        scope: 'SKILL_PRACTICE' as const,
      };
      await tx.speakingPracticeSet.upsert({
        where: { id: set.id },
        update: data,
        create: { id: set.id, ...data, publicationStatus: 'DRAFT' },
      });
      let order = 1;
      for (const id of set.members) {
        const changed = await tx.speakingExercise.updateMany({
          where: {
            id,
            OR: [{ practiceSetId: null }, { practiceSetId: set.id }],
          },
          data: {
            practiceSetId: set.id,
            order: order++,
            difficulty: DIFFICULTY[lvl.group],
            isPremiumContent: lvl.premium,
            ...(RETITLE[id] ? { title: RETITLE[id][1] } : {}),
          },
        });
        if (changed.count !== 1)
          throw new Error(`STOP: exercise ${id} not updated`);
      }
      for (const x of EXTRA.filter((e) => e.set === set.id)) {
        const stimulusId =
          'stimulus' in x
            ? (
                (await tx.speakingStimulus.findFirst({
                  where: { title: x.stimulus.title, kind: 'INFORMATION' },
                })) ??
                (await tx.speakingStimulus.create({
                  data: {
                    kind: 'INFORMATION',
                    title: x.stimulus.title,
                    content: x.stimulus.content,
                  },
                }))
              ).id
            : null;
        const fields = {
          title: x.title,
          targetText: x.text,
          taskType: x.taskType,
          difficulty: DIFFICULTY[lvl.group],
          category: set.category,
          isPremiumContent: lvl.premium,
          imageUrl:
            'image' in x
              ? `${process.env.R2_PUBLIC_URL!.replace(/\/$/, '')}/${x.image}`
              : null,
          stimulusId,
        };
        const found = await tx.speakingExercise.findFirst({
          where: { practiceSetId: set.id, title: x.title },
        });
        if (found)
          await tx.speakingExercise.update({
            where: { id: found.id },
            data: { ...fields, order: order++ },
          });
        else
          await tx.speakingExercise.create({
            data: {
              ...fields,
              practiceSetId: set.id,
              order: order++,
              publicationStatus: 'DRAFT',
            },
          });
      }
    }
    for (const q of quizzes) {
      const title = QUIZ_RETITLE[q.id]?.[1] ?? q.title;
      const range = parseCefrRange(title);
      if (!range)
        throw new Error(
          `STOP: standalone practice quiz ${q.id} has no CEFR tag`,
        );
      await tx.quiz.update({
        where: { id: q.id },
        data: { title, isPremiumContent: practiceRequiresPlus(range) },
      });
    }
  });
  console.log('applied');
}

/** Prompts and model readings use one steady voice per accent. */
function voiceFor(uk: boolean) {
  return LISTENING_VOICE_REGISTRY[uk ? 'en-gb-female-01' : 'en-us-female-01']
    .providerVoice;
}

function synthesize(text: string, uk: boolean): Promise<Buffer> {
  const config = SpeechSDK.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY!,
    process.env.AZURE_SPEECH_REGION!,
  );
  config.speechSynthesisOutputFormat =
    SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
  const synth = new SpeechSDK.SpeechSynthesizer(config, null);
  const ssml = `<speak version="1.0" xml:lang="${uk ? 'en-GB' : 'en-US'}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voiceFor(uk)}">${escapeXml(text)}</voice></speak>`;
  return new Promise((ok, fail) =>
    synth.speakSsmlAsync(
      ssml,
      (r) => {
        synth.close();
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted)
          ok(Buffer.from(r.audioData));
        else fail(new Error(`synthesis failed: ${r.errorDetails ?? ''}`));
      },
      (err) => {
        synth.close();
        fail(new Error(String(err).slice(0, 200)));
      },
    ),
  );
}

async function tts() {
  if (process.env.SPEAKING_PRACTICE_TTS_AUTHORIZED !== 'generate')
    throw new Error(
      'REFUSED: SPEAKING_PRACTICE_TTS_AUTHORIZED=generate not set',
    );
  mkdirSync(AUDIO_DIR, { recursive: true });
  let calls = 0;
  let chars = 0;
  for (const x of EXTRA)
    for (const uk of [false, true]) {
      const file = join(AUDIO_DIR, `${x.slug}.${uk ? 'en-gb' : 'en-us'}.mp3`);
      if (existsSync(file)) continue;
      if (calls >= 40) throw new Error('STOP: call cap reached');
      writeFileSync(file, await synthesize(x.text, uk));
      calls += 1;
      chars += x.text.length;
    }
  console.log(`tts calls: ${calls}; characters: ${chars}`);
}

async function media(prisma: PrismaClient) {
  if (process.env.PRACTICE_MEDIA_AUTHORIZED !== 'publish')
    throw new Error('REFUSED: PRACTICE_MEDIA_AUTHORIZED=publish not set');
  const s = storage();
  const moves: Array<{
    table: string;
    id: number;
    from: string;
    to: string;
    bytes: number;
    sha256: string;
  }> = existsSync(MEDIA_LOG) ? JSON.parse(readFileSync(MEDIA_LOG, 'utf8')) : [];
  // New tasks: their own clips, at the id-based key the API expects.
  for (const x of EXTRA) {
    const ex = await prisma.speakingExercise.findFirst({
      where: { practiceSetId: x.set, title: x.title },
    });
    if (!ex || ex.audioUrl) continue;
    const us = readFileSync(join(AUDIO_DIR, `${x.slug}.en-us.mp3`));
    const gb = readFileSync(join(AUDIO_DIR, `${x.slug}.en-gb.mp3`));
    const prefix = ex.isPremiumContent ? 'premium' : 'catalog';
    const client = ex.isPremiumContent ? s.priv : s.pub;
    const bucket = ex.isPremiumContent ? s.privBucket : s.pubBucket;
    await putOnce(
      client,
      bucket,
      `${prefix}/speaking/reference/${ex.id}.v1.mp3`,
      us,
      'audio/mpeg',
    );
    await putOnce(
      client,
      bucket,
      `${prefix}/speaking/reference/${ex.id}.en-gb.v1.mp3`,
      gb,
      'audio/mpeg',
    );
    const audioUrl = ex.isPremiumContent
      ? `premium/speaking/reference/${ex.id}.v1.mp3`
      : `${s.pubBase}/catalog/speaking/reference/${ex.id}.v1.mp3`;
    await prisma.speakingExercise.updateMany({
      where: { id: ex.id, audioUrl: null },
      data: { audioUrl },
    });
    console.log(`new task ${ex.id} ${x.slug}: clips uploaded (${prefix})`);
  }
  // Premium Speaking items still pointing at a public clip.
  const exposed = await prisma.speakingExercise.findMany({
    where: {
      isPremiumContent: true,
      audioUrl: { startsWith: s.pubBase },
      practiceSetId: { in: SETS.map((x) => x.id) },
    },
  });
  for (const ex of exposed) {
    for (const suffix of ['v1.mp3', 'en-gb.v1.mp3']) {
      const from = `catalog/speaking/reference/${ex.id}.${suffix}`;
      if (!(await exists(s.pub, s.pubBucket, from))) {
        if (suffix === 'v1.mp3') throw new Error(`STOP: ${from} missing`);
        continue;
      }
      const body = await read(s.pub, s.pubBucket, from);
      const to = `premium/speaking/reference/${ex.id}.${suffix}`;
      await putOnce(s.priv, s.privBucket, to, body, 'audio/mpeg');
      moves.push({
        table: 'SpeakingExercise',
        id: ex.id,
        from,
        to,
        bytes: body.length,
        sha256: sha(body),
      });
    }
    const changed = await prisma.speakingExercise.updateMany({
      where: { id: ex.id, audioUrl: ex.audioUrl },
      data: { audioUrl: `premium/speaking/reference/${ex.id}.v1.mp3` },
    });
    if (changed.count !== 1)
      throw new Error(`STOP: exercise ${ex.id} repoint failed`);
    console.log(`speaking ${ex.id}: clip moved to private`);
  }
  // Premium Listening quizzes whose audio is still public.
  const quizzes = await prisma.quiz.findMany({
    where: {
      type: 'LISTENING_PRACTICE',
      isPremiumContent: true,
      courseId: null,
    },
    select: { id: true },
  });
  const ids = quizzes.map((q) => q.id);
  const assets = await prisma.quizAudioAsset.findMany({
    where: {
      key: { startsWith: 'catalog/' },
      question: { quizId: { in: ids } },
    },
  });
  for (const a of assets) {
    const to = a.key.replace(/^catalog\//, 'premium/');
    const body = await read(s.pub, s.pubBucket, a.key);
    await putOnce(s.priv, s.privBucket, to, body, 'audio/mpeg');
    const changed = await prisma.quizAudioAsset.updateMany({
      where: { id: a.id, key: a.key },
      data: { key: to, url: '' },
    });
    if (changed.count !== 1)
      throw new Error(`STOP: asset ${a.id} repoint failed`);
    moves.push({
      table: 'QuizAudioAsset',
      id: a.id,
      from: a.key,
      to,
      bytes: body.length,
      sha256: sha(body),
    });
  }
  const artifacts = await prisma.listeningAudioArtifact.findMany({
    where: { quizId: { in: ids }, r2Key: { startsWith: 'catalog/' } },
  });
  for (const a of artifacts) {
    const to = a.r2Key!.replace(/^catalog\//, 'premium/');
    const body = await read(s.pub, s.pubBucket, a.r2Key!);
    await putOnce(s.priv, s.privBucket, to, body, 'audio/mpeg');
    const changed = await prisma.listeningAudioArtifact.updateMany({
      where: { id: a.id, r2Key: a.r2Key },
      data: { r2Key: to, r2Url: null },
    });
    if (changed.count !== 1)
      throw new Error(`STOP: artifact ${a.id} repoint failed`);
    moves.push({
      table: 'ListeningAudioArtifact',
      id: a.id,
      from: a.r2Key!,
      to,
      bytes: body.length,
      sha256: sha(body),
    });
  }
  mkdirSync(AUDIO_DIR, { recursive: true });
  writeFileSync(MEDIA_LOG, JSON.stringify(moves, null, 2));
  console.log(
    `moved to private: speaking ${exposed.length}, listening assets ${assets.length}, artifacts ${artifacts.length}; log ${MEDIA_LOG}`,
  );
}

async function revoke() {
  if (process.env.PRACTICE_MEDIA_REVOKE_AUTHORIZED !== 'delete')
    throw new Error('REFUSED: PRACTICE_MEDIA_REVOKE_AUTHORIZED=delete not set');
  const s = storage();
  const moves: Array<{ from: string; to: string; sha256: string }> = JSON.parse(
    readFileSync(MEDIA_LOG, 'utf8'),
  );
  let deleted = 0;
  for (const m of moves) {
    if (sha(await read(s.priv, s.privBucket, m.to)) !== m.sha256)
      throw new Error(`STOP: private copy ${m.to} does not match`);
    if (!(await exists(s.pub, s.pubBucket, m.from))) continue;
    await s.pub.send(
      new DeleteObjectCommand({ Bucket: s.pubBucket, Key: m.from }),
    );
    deleted += 1;
  }
  let stillPublic = 0;
  for (const m of moves)
    if (
      (
        await fetch(`${s.pubBase}/${m.from}`, { method: 'HEAD' }).catch(
          () => null,
        )
      )?.status === 200
    )
      stillPublic += 1;
  console.log(
    `revoked public copies: ${deleted} of ${moves.length}; still public: ${stillPublic}`,
  );
}

async function ready(prisma: PrismaClient) {
  for (const set of SETS) {
    await prisma.speakingExercise.updateMany({
      where: {
        practiceSetId: set.id,
        publicationStatus: 'DRAFT',
        audioUrl: { not: null },
      },
      data: { publicationStatus: 'PUBLISHED' },
    });
    const members = await prisma.speakingExercise.findMany({
      where: { practiceSetId: set.id },
    });
    const playable = members.filter(
      (m) => m.publicationStatus === 'PUBLISHED' && m.audioUrl,
    );
    const status =
      playable.length >= 5 && playable.length === members.length
        ? 'PUBLISHED'
        : 'DRAFT';
    await prisma.speakingPracticeSet.update({
      where: { id: set.id },
      data: { publicationStatus: status },
    });
    console.log(
      `${set.id}: ${playable.length}/${members.length} playable → ${status}`,
    );
  }
}

async function validate(prisma: PrismaClient) {
  const failures: string[] = [];
  const sets = await prisma.speakingPracticeSet.findMany({
    where: { scope: 'SKILL_PRACTICE', publicationStatus: 'PUBLISHED' },
    include: { exercises: true },
  });
  for (const set of sets) {
    const items = set.exercises.filter(
      (e) => e.publicationStatus === 'PUBLISHED',
    );
    const range = parseCefrRange(set.level);
    if (items.length < 5)
      failures.push(`${set.id}: ${items.length} published tasks`);
    if (!range || !levelGroup(range))
      failures.push(`${set.id}: level "${set.level}" is not one group`);
    if (new Set(items.map((i) => i.taskType)).size !== 1)
      failures.push(`${set.id}: mixed task types`);
    if (
      new Set(items.map((i) => i.targetText.trim().toLowerCase())).size !==
      items.length
    )
      failures.push(`${set.id}: duplicate task text`);
    for (const i of items) {
      const tag = parseCefrRange(i.title);
      if (!tag || !range || levelGroup(tag) !== levelGroup(range))
        failures.push(`${set.id}: task ${i.id} level outside the set`);
      if (!i.audioUrl) failures.push(`${set.id}: task ${i.id} has no audio`);
      if (range && i.isPremiumContent !== practiceRequiresPlus(range))
        failures.push(`${set.id}: task ${i.id} flag disagrees with policy`);
      if (
        i.isPremiumContent &&
        i.audioUrl &&
        !i.audioUrl.startsWith('premium/')
      )
        failures.push(`${set.id}: premium task ${i.id} has a public clip`);
      if (i.taskType === 'DESCRIBE_PICTURE' && !i.imageUrl)
        failures.push(`${set.id}: task ${i.id} has no picture`);
      if (i.taskType === 'RESPOND_USING_INFORMATION' && !i.stimulusId)
        failures.push(`${set.id}: task ${i.id} has no information`);
    }
  }
  const loose = await prisma.speakingExercise.count({
    where: { practiceSetId: null, publicationStatus: 'PUBLISHED' },
  });
  if (loose)
    failures.push(`${loose} published Speaking items outside a practice set`);
  for (const q of await standaloneQuizzes(prisma)) {
    const range = parseCefrRange(q.title);
    if (!range) failures.push(`quiz ${q.id}: no CEFR tag`);
    else if (q.isPremiumContent !== practiceRequiresPlus(range))
      failures.push(
        `quiz ${q.id}: flag disagrees with ${range.min}–${range.max}`,
      );
  }
  const publicPremiumListening = await prisma.quizAudioAsset.count({
    where: {
      key: { startsWith: 'catalog/' },
      question: {
        quiz: {
          type: 'LISTENING_PRACTICE',
          isPremiumContent: true,
          courseId: null,
        },
      },
    },
  });
  if (publicPremiumListening)
    failures.push(
      `${publicPremiumListening} premium listening assets on public keys`,
    );
  console.log(
    `speaking sets published: ${sets.length}; tasks: ${sets.reduce((n, s) => n + s.exercises.filter((e) => e.publicationStatus === 'PUBLISHED').length, 0)}`,
  );
  console.log(
    failures.length
      ? `VALIDATION FAILED:\n  ${failures.join('\n  ')}`
      : 'VALIDATION PASSED',
  );
  if (failures.length) process.exitCode = 1;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const target = arg('target');
  if (mode === 'tts') return tts();
  if (mode === 'revoke') return revoke();
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (mode === 'plan') await plan(prisma);
    else if (mode === 'apply')
      await apply(prisma, new URL(url).pathname.slice(1));
    else if (mode === 'media') await media(prisma);
    else if (mode === 'ready') await ready(prisma);
    else if (mode === 'validate') await validate(prisma);
    else
      throw new Error(
        'mode: plan | apply | tts | media | revoke | ready | validate',
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
