/**
 * One continuous Listening recording for a TOEIC L&R exam set, assembled from
 * the exam's existing approved group clips plus original BreadTrans narration
 * (an introduction, Part directions and question-number cues). Nothing in the
 * approved clips is re-synthesized or edited.
 *
 * Modes (all write only under artifacts/toeic-listening-master/exam-<id>/):
 *   inventory  read-only DB + public GET of each clip; ffprobe durations;
 *              writes inventory.json (ordered clip -> question manifest).
 *   narration  Azure neural TTS (Speech F0), ONE request with SSML bookmarks,
 *              cut into segments locally. Needs TOEIC_MASTER_TTS_AUTHORIZED=generate.
 *   build      ffmpeg: intro + per-Part directions + cues + clips + response
 *              gaps -> master.mp3 (mono 24 kHz 64 kb/s CBR, loudness
 *              normalized) and timeline.json (segment offsets per group).
 *   registry   writes src/modules/toeic/listening-master/exam-<id>.ts from
 *              timeline.json.
 *   publish    upload master.mp3 + timeline.json to an S3-compatible bucket
 *              under a content-hashed key, refusing to overwrite a different
 *              object. --bucket harness (local fake S3) needs nothing else;
 *              --bucket r2 needs TOEIC_MASTER_PUBLISH_AUTHORIZED=publish;
 *              --bucket r2-private (the P05 location) needs it too.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/toeic-listening-master.ts <mode> --exam 1 --target env:DATABASE_URL
 *   (FFMPEG / FFPROBE env vars point at the binaries.)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
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
  isPrivateListeningMediaKey,
  R2Service,
} from '../src/modules/upload/r2.service';
import {
  type ListeningMaster,
  privateListeningMasterKey,
} from '../src/modules/toeic/toeic-listening-master';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';
const RATE = 24000;

/** Seconds of silence the learner gets to answer, after the clip ends. */
const RESPONSE_GAP: Record<number, number> = { 1: 5, 2: 5, 3: 8, 4: 8 };
/**
 * Original BreadTrans narration. Written for this product; it follows the
 * usual shape of a standardized listening section (an introduction, then one
 * direction per Part) without reproducing any official test's wording.
 */
export const NARRATION = {
  // Short sentences: the owner found the first, longer intro rushed and
  // hard to follow in places (2026-10-30).
  intro:
    'Welcome to the BreadTrans TOEIC Listening practice test. This test was written by BreadTrans. It is not an official TOEIC test. ' +
    'In this section, you will hear short recordings in English: statements, questions, conversations, and talks. ' +
    'There are one hundred questions in four parts. For each question, choose the best answer: A, B, C, or D. Listen carefully. Part One will begin now.',
  part1:
    'Part One. Photographs. Questions one to six. For each question, look at the photograph on your page. You will hear four short statements about it. The statements are not printed. Choose the statement that best describes what you see.',
  part2:
    'Part Two. Question and response. Questions seven to thirty-one. You will hear a question or a statement, followed by three spoken responses, A, B, and C. Nothing is printed for this part. Choose the response that fits best.',
  part3:
    'Part Three. Conversations. Questions thirty-two to seventy. You will hear short conversations between two or more people. After each conversation, you will hear three questions. The questions and answer choices are printed on your page.',
  part4:
    'Part Four. Talks. Questions seventy-one to one hundred. You will hear short talks by one speaker, such as announcements, messages, or broadcasts. After each talk, you will hear three questions. The questions and answer choices are printed on your page.',
  end: 'This is the end of the Listening section. You may now continue with the Reading section.',
} as const;

/** Pause after a sentence, after a colon, and between answer letters. */
export const NARRATION_BREAKS = { sentence: 200, colon: 350, letter: 300 };

/**
 * Narration text as SSML. The voice spells an all-caps word letter by letter
 * ("T O E I C"), so brand and test names get a pronunciation. The voice's
 * own pauses were about 0.2 s inside lists and "A, B, C, or D", which ran the
 * letters together, so explicit breaks are added.
 */
export function narrationSsml(text: string): string {
  const b = (ms: number) => `<break time="${ms}ms"/>`;
  return (
    escapeXml(text)
      .replace(
        /\bTOEIC\b/g,
        '<phoneme alphabet="ipa" ph="ˈtoʊ.ɪk">TOEIC</phoneme>',
      )
      .replace(/\bBreadTrans\b/g, '<sub alias="Bread Trans">BreadTrans</sub>')
      // "A, B, C, or D" / "A, B, and C": each letter on its own
      .replace(
        /\b([A-D]), (?=(?:and |or )?[A-D]\b)/g,
        `$1,${b(NARRATION_BREAKS.letter)} `,
      )
      .replace(/: /g, `:${b(NARRATION_BREAKS.colon)} `)
      .replace(/([.?!]) (?=\S)/g, `$1${b(NARRATION_BREAKS.sentence)} `)
  );
}

const numberWords = (n: number): string => {
  const ones = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];
  if (n === 100) return 'one hundred';
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : '');
};

/** The cue read before a group: "Number 7." or "Questions 32 to 34 refer to the following conversation." */
function cueFor(part: number, numbers: number[]) {
  if (part <= 2) return `Number ${numberWords(numbers[0])}.`;
  const what = part === 3 ? 'conversation' : 'talk';
  return `Questions ${numberWords(numbers[0])} to ${numberWords(numbers[numbers.length - 1])} refer to the following ${what}.`;
}

type InventoryClip = {
  groupId: number;
  part: number;
  groupOrder: number;
  questionNumbers: number[];
  audioUrl: string;
  file: string;
  bytes: number;
  sha256: string;
  durationSeconds: number;
  codec: string;
  sampleRate: number;
  channels: number;
};

function probe(file: string) {
  const out = JSON.parse(
    execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        file,
      ],
      { encoding: 'utf8' },
    ),
  );
  const stream = out.streams.find((s: any) => s.codec_type === 'audio');
  return {
    durationSeconds: Number(out.format.duration),
    codec: stream.codec_name as string,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
  };
}

async function inventory(examId: number, dir: string) {
  const url =
    arg('target') === 'env:DATABASE_URL'
      ? process.env.DATABASE_URL
      : arg('target');
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const groups = await prisma.toeicQuestionGroup.findMany({
    where: { examId, part: { lte: 4 } },
    orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    select: {
      id: true,
      part: true,
      groupOrder: true,
      audioUrl: true,
      questions: {
        select: { questionNumber: true },
        orderBy: { questionNumber: 'asc' },
      },
    },
  });
  await prisma.$disconnect();
  mkdirSync(join(dir, 'clips'), { recursive: true });
  const clips: InventoryClip[] = [];
  let r2: R2Service | undefined;
  for (const g of groups) {
    if (!g.audioUrl)
      throw new Error(`group ${g.id} (Part ${g.part}) has no audioUrl`);
    const file = join(
      dir,
      'clips',
      `${String(g.part)}-${String(g.groupOrder).padStart(3, '0')}-g${g.id}.mp3`,
    );
    if (!existsSync(file)) {
      // Since P05 a group stores a private key; older rows hold a public URL.
      if (isPrivateListeningMediaKey(g.audioUrl)) {
        r2 ??= new R2Service();
        writeFileSync(file, await r2.downloadPrivateFileBuffer(g.audioUrl));
      } else {
        const res = await fetch(g.audioUrl);
        if (!res.ok) throw new Error(`GET ${g.audioUrl} -> ${res.status}`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
    }
    const buf = readFileSync(file);
    clips.push({
      groupId: g.id,
      part: g.part,
      groupOrder: g.groupOrder,
      questionNumbers: g.questions.map((q) => q.questionNumber),
      audioUrl: g.audioUrl,
      file,
      bytes: buf.length,
      sha256: sha256(buf),
      ...probe(file),
    });
  }
  // Integrity: question numbers 1..100 exactly once, in order; no clip used twice.
  const numbers = clips.flatMap((c) => c.questionNumbers);
  const expected = Array.from({ length: 100 }, (_, i) => i + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected))
    throw new Error(`question sequence is not 1..100: ${numbers.join(',')}`);
  const dupes = clips.filter(
    (c, i) => clips.findIndex((o) => o.sha256 === c.sha256) !== i,
  );
  if (dupes.length)
    throw new Error(
      `duplicate clip audio for groups ${dupes.map((d) => d.groupId).join(',')}`,
    );
  const byPart = [1, 2, 3, 4].map((part) => {
    const list = clips.filter((c) => c.part === part);
    return {
      part,
      clips: list.length,
      questions: list.reduce((n, c) => n + c.questionNumbers.length, 0),
      seconds: +list.reduce((n, c) => n + c.durationSeconds, 0).toFixed(1),
    };
  });
  const total = clips.reduce((n, c) => n + c.durationSeconds, 0);
  writeFileSync(
    join(dir, 'inventory.json'),
    JSON.stringify(
      {
        examId,
        generatedAt: new Date().toISOString(),
        clipCount: clips.length,
        clipSeconds: +total.toFixed(1),
        byPart,
        clips,
      },
      null,
      2,
    ),
  );
  console.table(byPart);
  console.log(
    `clips ${clips.length}, raw clip runtime ${(total / 60).toFixed(2)} min, formats ${[...new Set(clips.map((c) => `${c.codec}/${c.sampleRate}/${c.channels}ch`))].join(' ')}`,
  );
}

/** All narration in ONE TTS request; bookmarks give each segment's offset for local cutting. */
async function narration(examId: number, dir: string) {
  if (process.env.TOEIC_MASTER_TTS_AUTHORIZED !== 'generate')
    throw new Error('REFUSED: TOEIC_MASTER_TTS_AUTHORIZED=generate not set');
  const inv = JSON.parse(readFileSync(join(dir, 'inventory.json'), 'utf8'));
  const segments: Array<{ id: string; text: string }> = [
    { id: 'intro', text: NARRATION.intro },
    ...[1, 2, 3, 4].flatMap((part) => [
      { id: `part${part}`, text: NARRATION[`part${part}` as 'part1'] },
      ...inv.clips
        .filter((c: InventoryClip) => c.part === part)
        .map((c: InventoryClip) => ({
          id: `cue-${c.groupId}`,
          text: cueFor(part, c.questionNumbers),
        })),
    ]),
    { id: 'end', text: NARRATION.end },
  ];
  const voice = LISTENING_VOICE_REGISTRY['en-us-female-01'].providerVoice;
  const body = segments
    .map(
      (s) =>
        `${narrationSsml(s.text)}<bookmark mark="${s.id}"/><break time="1200ms"/>`,
    )
    .join('');
  const ssml = `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}"><prosody rate="-8%">${body}</prosody></voice></speak>`;
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  console.log(
    `narration: ${segments.length} segments, ${chars} characters, 1 TTS request, voice ${voice}`,
  );
  mkdirSync(join(dir, 'narration'), { recursive: true });
  const whole = join(dir, 'narration', 'narration.wav');
  const marksFile = join(dir, 'narration', 'bookmarks.json');
  const cached = existsSync(marksFile)
    ? JSON.parse(readFileSync(marksFile, 'utf8'))
    : null;
  let audio: Buffer;
  let marks: Record<string, number>;
  if (cached?.ssmlSha256 === sha256(ssml) && existsSync(whole)) {
    // Same text as the cached synthesis: no TTS request.
    audio = readFileSync(whole);
    marks = cached.marks;
    console.log('reusing cached narration (0 TTS requests)');
  } else {
    ({ audio, marks } = await synthesizeWithMarks(ssml));
    writeFileSync(whole, audio);
    writeFileSync(
      marksFile,
      JSON.stringify({ ssmlSha256: sha256(ssml), marks }, null, 2),
    );
  }
  const totalSeconds = probe(whole).durationSeconds;
  let start = 0;
  const cut: Array<{
    id: string;
    text: string;
    file: string;
    seconds: number;
  }> = [];
  for (const s of segments) {
    // The service reports no bookmark at the very end of the audio.
    const end =
      marks[s.id] ??
      (s === segments[segments.length - 1] ? totalSeconds : undefined);
    if (end === undefined) throw new Error(`bookmark ${s.id} not reported`);
    const file = join(dir, 'narration', `${s.id}.wav`);
    // Cut, then trim surrounding silence in a second pass (the filter has no
    // effect when combined with -ss/-to in one command), so the build
    // controls every pause.
    const raw = join(dir, 'narration', `${s.id}.raw.wav`);
    execFileSync(FFMPEG, [
      '-y',
      '-v',
      'error',
      '-i',
      whole,
      '-ss',
      start.toFixed(3),
      '-to',
      end.toFixed(3),
      '-ar',
      String(RATE),
      '-ac',
      '1',
      raw,
    ]);
    execFileSync(FFMPEG, [
      '-y',
      '-v',
      'error',
      '-i',
      raw,
      '-af',
      'silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse',
      file,
    ]);
    rmSync(raw);
    cut.push({
      id: s.id,
      text: s.text,
      file,
      seconds: probe(file).durationSeconds,
    });
    start = end;
  }
  writeFileSync(
    join(dir, 'narration', 'narration.json'),
    JSON.stringify(
      {
        voice,
        characters: chars,
        requests: 1,
        audioSha256: sha256(audio),
        segments: cut,
      },
      null,
      2,
    ),
  );
  console.log(
    `narration cut into ${cut.length} segments, ${(cut.reduce((n, c) => n + c.seconds, 0) / 60).toFixed(2)} min of speech`,
  );
}

function synthesizeWithMarks(
  ssml: string,
): Promise<{ audio: Buffer; marks: Record<string, number> }> {
  const config = SpeechSDK.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY as string,
    process.env.AZURE_SPEECH_REGION as string,
  );
  config.speechSynthesisOutputFormat =
    SpeechSDK.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
  const synth = new SpeechSDK.SpeechSynthesizer(config, null);
  const marks: Record<string, number> = {};
  synth.bookmarkReached = (_s, e) => {
    marks[e.text] = e.audioOffset / 1e7;
  };
  return new Promise((resolve, reject) =>
    synth.speakSsmlAsync(
      ssml,
      (r) => {
        synth.close();
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted)
          resolve({ audio: Buffer.from(r.audioData), marks });
        else reject(new Error(`synthesis failed: ${r.errorDetails ?? ''}`));
      },
      (e) => {
        synth.close();
        reject(new Error(`synthesis failed: ${String(e).slice(0, 200)}`));
      },
    ),
  );
}

function silence(dir: string, seconds: number) {
  const file = join(dir, 'build', `silence-${seconds}.wav`);
  if (!existsSync(file))
    execFileSync(FFMPEG, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${RATE}:cl=mono`,
      '-t',
      String(seconds),
      file,
    ]);
  return file;
}

function build(examId: number, dir: string) {
  const inv = JSON.parse(readFileSync(join(dir, 'inventory.json'), 'utf8'));
  const nar = JSON.parse(
    readFileSync(join(dir, 'narration', 'narration.json'), 'utf8'),
  );
  const seg = (id: string) => {
    const s = nar.segments.find((x: any) => x.id === id);
    if (!s) throw new Error(`narration segment ${id} missing`);
    return s as { file: string; seconds: number };
  };
  mkdirSync(join(dir, 'build'), { recursive: true });
  // Normalize each approved clip to the same format first (no content change).
  const norm = (c: InventoryClip) => {
    const file = join(dir, 'build', `clip-g${c.groupId}.wav`);
    if (!existsSync(file))
      execFileSync(FFMPEG, [
        '-y',
        '-v',
        'error',
        '-i',
        c.file,
        '-ar',
        String(RATE),
        '-ac',
        '1',
        file,
      ]);
    return file;
  };
  const list: Array<{ file: string; seconds: number }> = [];
  const timeline: Array<{
    kind: string;
    part?: number;
    groupId?: number;
    questionNumbers?: number[];
    start: number;
    end: number;
  }> = [];
  let t = 0;
  const push = (
    file: string,
    seconds: number,
    entry?: Omit<(typeof timeline)[number], 'start' | 'end'>,
  ) => {
    list.push({ file, seconds });
    if (entry)
      timeline.push({
        ...entry,
        start: +t.toFixed(3),
        end: +(t + seconds).toFixed(3),
      });
    t += seconds;
  };
  const intro = seg('intro');
  push(intro.file, intro.seconds, { kind: 'INTRO' });
  push(silence(dir, 2), 2);
  for (const part of [1, 2, 3, 4]) {
    const d = seg(`part${part}`);
    push(d.file, d.seconds, { kind: 'DIRECTIONS', part });
    push(silence(dir, 2), 2);
    for (const c of inv.clips.filter((x: InventoryClip) => x.part === part)) {
      const cue = seg(`cue-${c.groupId}`);
      const groupStart = t;
      push(cue.file, cue.seconds);
      push(silence(dir, 1), 1);
      push(norm(c), probe(norm(c)).durationSeconds);
      // Part 3/4 clips read their three questions back to back, so the
      // answer time of every question follows the clip: 8 s per question.
      const gap =
        RESPONSE_GAP[part] * (part >= 3 ? c.questionNumbers.length : 1);
      push(silence(dir, gap), gap);
      timeline.push({
        kind: 'GROUP',
        part,
        groupId: c.groupId,
        questionNumbers: c.questionNumbers,
        start: +groupStart.toFixed(3),
        end: +t.toFixed(3),
      });
    }
  }
  const end = seg('end');
  push(end.file, end.seconds, { kind: 'END' });
  timeline.sort((a, b) => a.start - b.start);
  const concat = join(dir, 'build', 'concat.txt');
  writeFileSync(
    concat,
    list
      .map(
        (x) =>
          `file '${resolve(x.file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
      )
      .join('\n'),
  );
  const wav = join(dir, 'build', 'master.wav');
  execFileSync(FFMPEG, [
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-c',
    'copy',
    wav,
  ]);
  const out = join(dir, 'master.mp3');
  // EBU R128 loudness normalization (speech target -16 LUFS), constant bitrate for exact seeking.
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-v',
      'error',
      '-i',
      wav,
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-write_xing',
      '1',
      out,
    ],
    { maxBuffer: 1 << 26 },
  );
  const final = probe(out);
  const buf = readFileSync(out);
  const result = {
    examId,
    builtAt: new Date().toISOString(),
    file: 'master.mp3',
    bytes: buf.length,
    sha256: sha256(buf),
    durationSeconds: +final.durationSeconds.toFixed(3),
    plannedSeconds: +t.toFixed(3),
    format: `${final.codec} ${final.sampleRate} Hz ${final.channels}ch 64 kb/s CBR`,
    responseGapSeconds: RESPONSE_GAP,
    clipSeconds: inv.clipSeconds,
    narrationSeconds: +nar.segments
      .reduce((n: number, s: any) => n + s.seconds, 0)
      .toFixed(1),
    timeline,
  };
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(result, null, 2));
  console.log(
    `master.mp3 ${(buf.length / 1e6).toFixed(1)} MB, ${(final.durationSeconds / 60).toFixed(2)} min (planned ${(t / 60).toFixed(2)}), ${timeline.filter((x) => x.kind === 'GROUP').length} groups, sha ${result.sha256.slice(0, 16)}`,
  );
}

async function publish(examId: number, dir: string) {
  const bucket = arg('bucket');
  const tl = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
  const prefix = `catalog/toeic/exam-${examId}/listening-master/${tl.sha256.slice(0, 16)}`;
  if (bucket === 'r2-private') {
    // Since P05 exam audio lives only in the private bucket, under the
    // registry key's file name (privateListeningMasterKey).
    if (process.env.TOEIC_MASTER_PUBLISH_AUTHORIZED !== 'publish')
      throw new Error(
        'REFUSED: TOEIC_MASTER_PUBLISH_AUTHORIZED=publish not set',
      );
    const key = privateListeningMasterKey({
      examId,
      key: `${prefix}.v1.mp3`,
    } as ListeningMaster);
    const body = readFileSync(join(dir, 'master.mp3'));
    const r2 = new R2Service();
    if (await r2.privateObjectExists(key)) {
      if (sha256(await r2.downloadPrivateFileBuffer(key)) !== tl.sha256)
        throw new Error(`REFUSED: ${key} exists with other content`);
      console.log(`exists (same sha256), skipped: ${key}`);
      return;
    }
    await r2.putPrivateObjectAtKey(key, body, 'audio/mpeg');
    if (sha256(await r2.downloadPrivateFileBuffer(key)) !== tl.sha256)
      throw new Error(`${key}: sha256 mismatch after write`);
    console.log(`uploaded ${key} (${body.length} bytes) to the private bucket`);
    return;
  }
  let client: S3Client;
  let name: string;
  if (bucket === 'harness') {
    client = new S3Client({
      region: 'auto',
      endpoint: 'http://127.0.0.1:9460',
      forcePathStyle: true,
      credentials: { accessKeyId: 'harness', secretAccessKey: 'harness' },
    });
    name = 'harness-public';
  } else if (bucket === 'r2') {
    if (process.env.TOEIC_MASTER_PUBLISH_AUTHORIZED !== 'publish')
      throw new Error(
        'REFUSED: TOEIC_MASTER_PUBLISH_AUTHORIZED=publish not set',
      );
    client = new S3Client({
      region: 'auto',
      endpoint:
        process.env.R2_ENDPOINT ||
        `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    name = process.env.R2_BUCKET_NAME!;
  } else throw new Error('--bucket harness | r2 | r2-private');
  const timeline = Buffer.from(
    JSON.stringify({ ...tl, file: `${prefix}.v1.mp3` }, null, 2),
  );
  for (const [key, body, type] of [
    [`${prefix}.v1.mp3`, readFileSync(join(dir, 'master.mp3')), 'audio/mpeg'],
    [`${prefix}.v1.timeline.json`, timeline, 'application/json'],
  ] as const) {
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: name, Key: key }),
      );
      if (Number(head.ContentLength) === body.length) {
        console.log(`exists (same size), skipped: ${key}`);
        continue;
      }
      throw new Error(
        `REFUSED: ${key} exists with a different size; never overwrite`,
      );
    } catch (e: any) {
      if (e?.message?.startsWith('REFUSED')) throw e;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: name,
        Key: key,
        Body: body,
        ContentType: type,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    console.log(`uploaded ${key} (${body.length} bytes) to ${bucket}`);
  }
}

/** Writes the registry module the API reads (src/modules/toeic/listening-master). */
function registry(examId: number, dir: string) {
  const tl = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
  const master: ListeningMaster = {
    examId,
    key: `catalog/toeic/exam-${examId}/listening-master/${tl.sha256.slice(0, 16)}.v1.mp3`,
    sha256: tl.sha256,
    bytes: tl.bytes,
    durationSeconds: tl.durationSeconds,
    format: tl.format,
    responseGapSeconds: tl.responseGapSeconds,
    timeline: tl.timeline,
  };
  const file = join(
    'src',
    'modules',
    'toeic',
    'listening-master',
    `exam-${examId}.ts`,
  );
  writeFileSync(
    file,
    `/**
 * Generated by scripts/toeic-listening-master.ts (registry) for exam set ${examId}.
 * Do not edit by hand: rebuild the master and regenerate this file.
 */
import type { ListeningMaster } from '../toeic-listening-master';

export const EXAM_${examId}_LISTENING_MASTER: ListeningMaster = ${JSON.stringify(master, null, 2)};
`,
  );
  console.log(
    `wrote ${file}: ${(master.durationSeconds / 60).toFixed(2)} min, sha ${master.sha256.slice(0, 16)}`,
  );
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const examId = Number(arg('exam') ?? 1);
  const dir = join('artifacts', 'toeic-listening-master', `exam-${examId}`);
  mkdirSync(dir, { recursive: true });
  if (mode === 'inventory') await inventory(examId, dir);
  else if (mode === 'narration') await narration(examId, dir);
  else if (mode === 'build') build(examId, dir);
  else if (mode === 'publish') await publish(examId, dir);
  else if (mode === 'registry') registry(examId, dir);
  else
    throw new Error('mode: inventory | narration | build | publish | registry');
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
