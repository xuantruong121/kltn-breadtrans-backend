import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

import { PrismaService } from '../../prisma/prisma.service';
import { LISTENING_VOICE_REGISTRY } from '../quiz/listening-audio-authoring.service';
import { R2Service } from '../upload/r2.service';
import {
  type MasterClip,
  narrationSegments,
  narrationSsml,
  planMaster,
  RESPONSE_GAP,
} from './listening-master/master-script';
import {
  type ListeningMaster,
  listeningMasterFor,
  privateListeningMasterKey,
} from './toeic-listening-master';

const run = promisify(execFile);

const RATE = 24000;
/** Bumped when the narration or the assembly changes, so masters rebuild. */
const BUILD_VERSION = 'master-v1';
const FULL_LISTENING = Array.from({ length: 100 }, (_, index) => index + 1);
/** A 16-bit mono WAV at 24 kHz: bytes per second of audio. */
const WAV_BYTES_PER_SECOND = RATE * 2;
const WAV_HEADER_BYTES = 78;
const MISSING_MANIFEST_TTL_MS = 60_000;

export type StoredListeningMaster = ListeningMaster & {
  sourceHash: string;
  builtAt: string;
};

type ListeningGroup = {
  id: number;
  part: number;
  groupOrder: number;
  audioUrl: string | null;
  mediaMetadata: unknown;
  questions: Array<{ questionNumber: number }>;
};

export type ListeningMasterState = {
  state: 'NOT_NEEDED' | 'MISSING' | 'STALE' | 'READY';
  durationSeconds?: number;
};

/** Changes whenever a clip, or what a clip belongs to, changes. */
export function listeningSourceHash(groups: ListeningGroup[]) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        BUILD_VERSION,
        ...groups.map((group) => [
          group.id,
          group.part,
          group.questions.map((question) => question.questionNumber),
          group.audioUrl,
          (group.mediaMetadata as { audio?: { sourceHash?: string } } | null)
            ?.audio?.sourceHash ?? null,
        ]),
      ]),
    )
    .digest('hex');
}

/** Only a full section has the 100 questions the narration speaks about. */
export function isFullListening(groups: ListeningGroup[]) {
  const numbers = groups.flatMap((group) =>
    group.questions.map((question) => question.questionNumber),
  );
  return (
    numbers.length === FULL_LISTENING.length &&
    numbers.every((number, index) => number === FULL_LISTENING[index])
  );
}

const manifestKey = (examId: number) =>
  `premium/listening/toeic/exam-${examId}/listening-master/manifest.json`;

const wavSeconds = async (file: string) =>
  Math.max(
    0,
    ((await stat(file)).size - WAV_HEADER_BYTES) / WAV_BYTES_PER_SECOND,
  );

function ffmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error('ffmpeg không khả dụng trên máy chủ');
  return run(ffmpegPath, ['-y', '-v', 'error', ...args], {
    maxBuffer: 1 << 26,
    timeout: 10 * 60_000,
  });
}

/**
 * Turns an exam's approved Listening clips into the one continuous recording
 * learners hear: intro, Part directions, question cues, clips and answer gaps.
 * The approved clips are never re-synthesized. The result lives in the private
 * bucket beside a manifest, which needs no schema change.
 */
@Injectable()
export class ToeicListeningMasterService {
  private readonly logger = new Logger(ToeicListeningMasterService.name);
  private readonly building = new Map<
    number,
    Promise<StoredListeningMaster | null>
  >();
  private readonly manifests = new Map<
    number,
    { value: StoredListeningMaster | null; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  private groups(examId: number): Promise<ListeningGroup[]> {
    return this.prisma.toeicQuestionGroup.findMany({
      where: { examId, part: { lte: 4 } },
      orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
      select: {
        id: true,
        part: true,
        groupOrder: true,
        audioUrl: true,
        mediaMetadata: true,
        questions: {
          select: { questionNumber: true },
          orderBy: { questionNumber: 'asc' },
        },
      },
    });
  }

  private async manifest(examId: number) {
    const cached = this.manifests.get(examId);
    if (cached?.value) return cached.value;
    if (cached && Date.now() - cached.at < MISSING_MANIFEST_TTL_MS) return null;
    let value: StoredListeningMaster | null = null;
    try {
      if (await this.r2.privateObjectExists(manifestKey(examId)))
        value = JSON.parse(
          (
            await this.r2.downloadPrivateFileBuffer(manifestKey(examId))
          ).toString('utf8'),
        ) as StoredListeningMaster;
    } catch (error) {
      this.logger.warn(`Listening master manifest ${examId}: ${String(error)}`);
    }
    this.manifests.set(examId, { value, at: Date.now() });
    return value;
  }

  /** The recording that matches the exam now, or null. */
  async current(examId: number): Promise<ListeningMaster | null> {
    const registered = listeningMasterFor(examId);
    if (registered) return registered;
    const stored = await this.manifest(examId);
    if (!stored) return null;
    return stored.sourceHash === listeningSourceHash(await this.groups(examId))
      ? stored
      : null;
  }

  async state(examId: number): Promise<ListeningMasterState> {
    const registered = listeningMasterFor(examId);
    if (registered)
      return { state: 'READY', durationSeconds: registered.durationSeconds };
    const groups = await this.groups(examId);
    if (!isFullListening(groups)) return { state: 'NOT_NEEDED' };
    const stored = await this.manifest(examId);
    if (!stored) return { state: 'MISSING' };
    return stored.sourceHash === listeningSourceHash(groups)
      ? { state: 'READY', durationSeconds: stored.durationSeconds }
      : { state: 'STALE', durationSeconds: stored.durationSeconds };
  }

  /** A short-lived link for the admin's own player. */
  async adminPlaybackUrl(examId: number) {
    const master = await this.current(examId);
    if (!master) return null;
    return {
      url: await this.r2.getPrivatePresignedDownloadUrl(
        privateListeningMasterKey(master),
        3600,
      ),
      durationSeconds: master.durationSeconds,
      timeline: master.timeline,
    };
  }

  /**
   * The current recording, built first when it is missing or out of date.
   * Null for an exam without a full Listening section, which has none.
   */
  async ensure(examId: number): Promise<ListeningMaster | null> {
    const registered = listeningMasterFor(examId);
    if (registered) return registered;
    const running = this.building.get(examId);
    if (running) return running;
    const task = this.buildIfNeeded(examId).finally(() =>
      this.building.delete(examId),
    );
    this.building.set(examId, task);
    return task;
  }

  private async buildIfNeeded(examId: number) {
    const groups = await this.groups(examId);
    if (!isFullListening(groups)) return null;
    const sourceHash = listeningSourceHash(groups);
    const stored = await this.manifest(examId);
    if (stored?.sourceHash === sourceHash) return stored;
    const missing = groups.filter((group) => !group.audioUrl);
    if (missing.length)
      throw new Error(`${missing.length} nhóm Listening chưa có audio`);
    return this.build(examId, groups, sourceHash);
  }

  private async build(
    examId: number,
    groups: ListeningGroup[],
    sourceHash: string,
  ) {
    const dir = await mkdtemp(join(tmpdir(), `toeic-master-${examId}-`));
    try {
      const clips: MasterClip[] = groups.map((group) => ({
        groupId: group.id,
        part: group.part,
        questionNumbers: group.questions.map((q) => q.questionNumber),
      }));
      const clipFiles = await this.normalizedClips(dir, groups);
      const narration = await this.narrate(dir, clips);
      const lengths = new Map<string, number>();
      for (const [id, file] of [...clipFiles, ...narration])
        lengths.set(String(id), await wavSeconds(file));
      const plan = planMaster(clips, (item) =>
        lengths.get(item.kind === 'clip' ? String(item.groupId) : item.id)!,
      );
      const files: string[] = [];
      for (const item of plan.items) {
        if (item.kind === 'clip')
          files.push(clipFiles.get(String(item.groupId))!);
        else if (item.kind === 'narration') files.push(narration.get(item.id)!);
        else files.push(await this.silence(dir, item.seconds));
      }
      const audio = await this.assemble(dir, files);
      const master = await this.store(examId, audio, sourceHash, plan);
      this.logger.log(
        `Listening master exam ${examId}: ${(master.durationSeconds / 60).toFixed(1)} min`,
      );
      return master;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async normalizedClips(dir: string, groups: ListeningGroup[]) {
    const files = new Map<string, string>();
    for (const group of groups) {
      const source = join(dir, `source-${group.id}.mp3`);
      const body = /^https?:/.test(group.audioUrl!)
        ? Buffer.from(await (await fetch(group.audioUrl!)).arrayBuffer())
        : await this.r2.downloadPrivateFileBuffer(group.audioUrl!);
      await writeFile(source, body);
      const file = join(dir, `clip-${group.id}.wav`);
      await ffmpeg(['-i', source, '-ar', String(RATE), '-ac', '1', file]);
      await rm(source);
      files.set(String(group.id), file);
    }
    return files;
  }

  /** All narration in one TTS request, cut locally at its bookmarks. */
  private async narrate(dir: string, clips: MasterClip[]) {
    const segments = narrationSegments(clips);
    const voice = LISTENING_VOICE_REGISTRY['en-us-female-01'].providerVoice;
    const body = segments
      .map(
        (segment) =>
          `${narrationSsml(segment.text)}<bookmark mark="${segment.id}"/><break time="1200ms"/>`,
      )
      .join('');
    const { audio, marks } = await this.synthesize(
      `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}">${body}</voice></speak>`,
    );
    const whole = join(dir, 'narration.wav');
    await writeFile(whole, audio);
    const total = await wavSeconds(whole);
    const files = new Map<string, string>();
    let start = 0;
    for (const [index, segment] of segments.entries()) {
      // The service reports no bookmark at the very end of the audio.
      const end =
        marks[segment.id] ??
        (index === segments.length - 1 ? total : undefined);
      if (end === undefined) throw new Error(`Thiếu mốc lời dẫn ${segment.id}`);
      const raw = join(dir, `narration-${segment.id}.raw.wav`);
      const file = join(dir, `narration-${segment.id}.wav`);
      await ffmpeg([
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
      // In a second pass: the filter has no effect combined with -ss/-to.
      await ffmpeg([
        '-i',
        raw,
        '-af',
        'silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse',
        file,
      ]);
      await rm(raw);
      files.set(segment.id, file);
      start = end;
    }
    return files;
  }

  private synthesize(
    ssml: string,
  ): Promise<{ audio: Buffer; marks: Record<string, number> }> {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region)
      throw new Error('Chưa cấu hình Azure Speech để đọc lời dẫn');
    const config = SpeechSDK.SpeechConfig.fromSubscription(key, region);
    config.speechSynthesisOutputFormat =
      SpeechSDK.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    const synthesizer = new SpeechSDK.SpeechSynthesizer(config, null);
    const marks: Record<string, number> = {};
    synthesizer.bookmarkReached = (_sender, event) => {
      marks[event.text] = event.audioOffset / 1e7;
    };
    return new Promise((done, fail) =>
      synthesizer.speakSsmlAsync(
        ssml,
        (result) => {
          synthesizer.close();
          if (
            result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted
          )
            done({ audio: Buffer.from(result.audioData), marks });
          else fail(new Error(result.errorDetails || 'Azure TTS thất bại'));
        },
        (error) => {
          synthesizer.close();
          fail(new Error(String(error).slice(0, 200)));
        },
      ),
    );
  }

  private async silence(dir: string, seconds: number) {
    await mkdir(join(dir, 'silence'), { recursive: true });
    const file = join(dir, 'silence', `${seconds}.wav`);
    await stat(file).catch(() =>
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${RATE}:cl=mono`,
        '-t',
        String(seconds),
        file,
      ]),
    );
    return file;
  }

  private async assemble(dir: string, files: string[]) {
    const list = join(dir, 'concat.txt');
    await writeFile(
      list,
      files
        .map(
          (file) =>
            `file '${resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
        )
        .join('\n'),
    );
    const wav = join(dir, 'master.wav');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', wav]);
    const mp3 = join(dir, 'master.mp3');
    // Speech loudness target; constant bitrate keeps seeking exact.
    await ffmpeg([
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
      mp3,
    ]);
    return readFile(mp3);
  }

  private async store(
    examId: number,
    audio: Buffer,
    sourceHash: string,
    plan: ReturnType<typeof planMaster>,
  ) {
    const sha256 = createHash('sha256').update(audio).digest('hex');
    // Music-metadata is ESM-only: keep it out of module bootstrap.
    const { parseBuffer } = await import('music-metadata');
    const { format } = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
    const durationSeconds = +(format.duration ?? plan.plannedSeconds).toFixed(
      3,
    );
    const master: StoredListeningMaster = {
      examId,
      key: `catalog/toeic/exam-${examId}/listening-master/${sha256.slice(0, 16)}.v1.mp3`,
      sha256,
      bytes: audio.length,
      durationSeconds,
      format: 'mp3 24000 Hz 1ch 64 kb/s CBR',
      responseGapSeconds: RESPONSE_GAP,
      timeline: plan.timeline,
      sourceHash,
      builtAt: new Date().toISOString(),
    };
    const audioKey = privateListeningMasterKey(master);
    await this.r2.putPrivateObjectAtKey(audioKey, audio, 'audio/mpeg');
    if (!(await this.r2.privateObjectExists(audioKey)))
      throw new Error('R2 chưa xác nhận audio liền mạch vừa tải lên');
    await this.r2.putPrivateObjectAtKey(
      manifestKey(examId),
      Buffer.from(JSON.stringify(master)),
      'application/json',
    );
    this.manifests.set(examId, { value: master, at: Date.now() });
    return master;
  }
}
