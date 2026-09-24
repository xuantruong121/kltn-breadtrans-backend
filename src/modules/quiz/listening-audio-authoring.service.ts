import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, QuizType } from '@prisma/client';
import { createHash } from 'crypto';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { parseEncodedMp3DurationMs } from './listening-media-metadata';
import {
  normalizeDialogueSegments,
  withSpeakerTurnIds,
  type NormalizedDialogueSegment,
} from './listening-dialogue.contract';

export interface PublishedListeningAudioIdentity {
  artifactId?: number;
  version?: number;
  checksumSha256?: string;
}

function dedupeRepeatedDialogueBlocks(
  blocks: NormalizedDialogueSegment[][],
): NormalizedDialogueSegment[] {
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const key = JSON.stringify(
      block.map(({ speaker, speakerId, voiceKey, text, translation }) => ({
        speaker,
        speakerId,
        voiceKey,
        text,
        translation,
      })),
    );
    if (seen.has(key)) return [];
    seen.add(key);
    return block;
  });
}

export const LISTENING_VOICE_REGISTRY_VERSION = '2026-09-21.v1';
export const LISTENING_VOICE_REGISTRY = {
  'en-us-female-01': {
    voiceKey: 'en-us-female-01',
    providerVoice: 'en-US-JennyNeural',
  },
  'en-us-male-01': {
    voiceKey: 'en-us-male-01',
    providerVoice: 'en-US-GuyNeural',
  },
  'en-gb-female-01': {
    voiceKey: 'en-gb-female-01',
    providerVoice: 'en-GB-SoniaNeural',
  },
  'en-gb-male-01': {
    voiceKey: 'en-gb-male-01',
    providerVoice: 'en-GB-RyanNeural',
  },
} as const;
const PRODUCTION_PREFIX = 'catalog/listening/practice';

export interface TimelineTurn {
  turnId: string;
  startMs: number;
  endMs: number;
}

interface CanonicalTurn {
  turnId: string;
  speakerTurnId?: string;
  speakerId: string;
  text: string;
  translation?: string;
  tone: string;
  rate: string;
  pauseMs: number;
  voiceKey: string;
  providerVoice: string;
  dialogueAct?: string;
  delivery?: string;
  expressiveStyle?: string;
  styleDegree?: number;
  emphasis?: Array<{
    token: string;
    level: 'reduced' | 'moderate' | 'strong';
  }>;
}

interface CanonicalSynthesisPayload {
  schemaVersion: string;
  quizId: number;
  locale: string;
  accent: string;
  outputFormat: string;
  voiceRegistryVersion: string;
  ssmlPolicyVersion: string;
  turns: CanonicalTurn[];
}

export function resolveListeningVoice(
  speakerId: string,
  accent: string,
  requestedVoiceKey?: string,
  fallbackSlot?: number,
): { voiceKey: string; providerVoice: string } {
  const normalizedAccent = accent === 'UK' ? 'en-gb' : 'en-us';
  let gender: 'female' | 'male' | null = null;
  if (requestedVoiceKey) {
    const requested = requestedVoiceKey.toLowerCase();
    if (requested.includes('female')) gender = 'female';
    else if (requested.includes('male')) gender = 'male';
    else if (requested === 'female-01') gender = 'female';
    else if (requested === 'male-01') gender = 'male';
    else
      throw new BadRequestException(
        `Không nhận diện được voiceKey: ${requestedVoiceKey}.`,
      );
  }
  if (!gender) {
    const normalizedSpeaker = speakerId.toLowerCase();
    const isMale =
      /male|man|agent|manager|guy|ethan|leo|ben|dan|customer-2|nhân viên|nhan vien|hỗ trợ|ho tro|support|assistant|staff|mark/.test(
        normalizedSpeaker,
      );
    const isFemale =
      /female|woman|lady|maya|nora|jenny|khách hàng|khach hang|customer-1|customer|caller|client|buyer|guest/.test(
        normalizedSpeaker,
      );
    if (isMale && !isFemale) {
      gender = 'male';
    } else if (isFemale && !isMale) {
      gender = 'female';
    } else if (fallbackSlot !== undefined) {
      gender = fallbackSlot % 2 === 1 ? 'male' : 'female';
    } else {
      gender = isMale ? 'male' : 'female';
    }
  }
  const key = `${normalizedAccent}-${gender}-01`;
  const resolved = (
    LISTENING_VOICE_REGISTRY as Record<
      string,
      { voiceKey: string; providerVoice: string }
    >
  )[key];
  if (!resolved)
    throw new BadRequestException(`Không có voice registry cho ${key}.`);
  return resolved;
}

const STYLE_DEGREE = {
  friendly: 0.9,
  chat: 0.9,
  cheerful: 0.85,
  excited: 0.75,
} as const;

/** Resolve domain delivery metadata to the verified Azure style allowlist. */
export function resolveDeliveryStyle(
  providerVoice: string,
  delivery?: string,
): { style?: keyof typeof STYLE_DEGREE; styleDegree?: number } {
  const normalized = delivery?.trim().toUpperCase();
  const isJenny = providerVoice === 'en-US-JennyNeural';
  const isGuy = providerVoice === 'en-US-GuyNeural';
  if (normalized === 'FRIENDLY' && (isJenny || isGuy))
    return { style: 'friendly', styleDegree: STYLE_DEGREE.friendly };
  if (normalized === 'CONVERSATIONAL') {
    if (isJenny) return { style: 'chat', styleDegree: STYLE_DEGREE.chat };
    if (isGuy) return { style: 'friendly', styleDegree: STYLE_DEGREE.friendly };
  }
  if (normalized === 'FRIENDLY_UPBEAT' || normalized === 'POSITIVE_REACTION') {
    if (isJenny || isGuy)
      return { style: 'cheerful', styleDegree: STYLE_DEGREE.cheerful };
  }
  if (normalized === 'EXCITED_LIGHT' && (isJenny || isGuy))
    return { style: 'excited', styleDegree: STYLE_DEGREE.excited };
  // Thoughtful/clarifying/concerned delivery intentionally uses neutral voice
  // plus restrained rate/pause; no theatrical style is forced.
  return {};
}

/** Resolve domain delivery metadata to conservative Azure prosody. */
export function resolveDeliveryRate(rate: string, delivery?: string): string {
  if (rate && rate !== '0%') return rate;
  const normalized = delivery?.trim().toUpperCase();
  if (normalized === 'URGENT' || normalized === 'EXCITED') return '+4%';
  if (normalized === 'CALM' || normalized === 'CONCERNED') return '-4%';
  if (normalized === 'EXCITED_LIGHT' || normalized === 'FRIENDLY_UPBEAT')
    return '+3%';
  if (normalized === 'THOUGHTFUL' || normalized === 'CLARIFYING') return '-3%';
  return rate || '0%';
}

export function buildListeningSsml(payload: CanonicalSynthesisPayload): string {
  const groups: CanonicalTurn[][] = [];
  for (const turn of payload.turns) {
    const previous = groups.at(-1);
    if (
      previous &&
      (previous[0].speakerTurnId ?? previous[0].turnId) ===
        (turn.speakerTurnId ?? turn.turnId)
    )
      previous.push(turn);
    else groups.push([turn]);
  }
  let turnIndex = 0;
  const body = groups
    .map((group, groupIndex) => {
      const prior = payload.turns[turnIndex - 1];
      const pause =
        groupIndex > 0 && prior ? `<break time="${prior.pauseMs}ms"/>` : '';
      const chunks = group
        .map((turn, index) => {
          turnIndex += 1;
          const betweenChunks =
            index > 0 ? `<break time="${group[index - 1].pauseMs}ms"/>` : '';
          const spokenText = renderTextWithEndBookmark(
            turn.text,
            turn.emphasis,
            turn.providerVoice,
            `${turn.turnId}:end`,
          );
          return `${betweenChunks}<bookmark mark="${turn.turnId}:start"/><prosody rate="${resolveDeliveryRate(turn.rate, turn.delivery)}">${spokenText}</prosody>`;
        })
        .join('');
      const style = resolveDeliveryStyle(
        group[0].providerVoice,
        group[0].delivery,
      );
      const body = style.style
        ? `<mstts:express-as style="${style.style}" styledegree="${style.styleDegree}">${chunks}</mstts:express-as>`
        : chunks;
      return `<voice name="${group[0].providerVoice}">${pause}${body}</voice>`;
    })
    .join('');
  return `<speak version="1.0" xml:lang="${payload.locale}" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts">${body}</speak>`;
}

/**
 * Azure may drop a bookmark placed after terminal punctuation when the voice
 * block is followed by another voice. Keeping the marker immediately before
 * the terminal punctuation preserves the lexical text while producing a
 * reliable end offset (punctuation itself has no learner word to highlight).
 */
export function renderTextWithEndBookmark(
  text: string,
  emphasis: CanonicalTurn['emphasis'],
  providerVoice: string,
  endMark: string,
): string {
  const match = /([.!?…]+["'”’»)]*)\s*$/.exec(text);
  if (!match || match.index === undefined) {
    return `${renderEmphasizedText(text, emphasis, providerVoice)}<bookmark mark="${escapeXml(endMark)}"/>`;
  }
  const prefix = text.slice(0, match.index);
  const suffix = text.slice(match.index);
  return `${renderEmphasizedText(prefix, emphasis, providerVoice)}<bookmark mark="${escapeXml(endMark)}"/>${escapeXml(suffix)}`;
}

export function renderEmphasizedText(
  text: string,
  emphasis: CanonicalTurn['emphasis'],
  providerVoice: string,
): string {
  const escaped = escapeXml(text);
  // Azure word-level emphasis is verified only for en-US-GuyNeural. Other
  // voices keep the exact escaped learner text without unsupported markup.
  if (providerVoice !== 'en-US-GuyNeural' || !emphasis?.length) return escaped;
  return emphasis.reduce((value, item) => {
    const token = escapeXml(item.token);
    if (!token || !value.includes(token)) return value;
    return value.replace(
      token,
      `<emphasis level="${item.level}">${token}</emphasis>`,
    );
  }, escaped);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function validateTimeline(
  timeline: TimelineTurn[],
  durationMs: number,
  expectedTurnIds: string[],
): void {
  if (timeline.length !== expectedTurnIds.length) {
    throw new BadRequestException('Timeline không đủ số lượt lời chuẩn.');
  }
  const expected = new Set(expectedTurnIds);
  const seen = new Set<string>();
  let previousEnd = -1;
  for (const [index, turn] of timeline.entries()) {
    if (
      !expected.has(turn.turnId) ||
      seen.has(turn.turnId) ||
      turn.startMs < 0 ||
      turn.endMs <= turn.startMs
    ) {
      throw new BadRequestException(
        `Timeline không hợp lệ tại lượt ${index + 1}.`,
      );
    }
    seen.add(turn.turnId);
    if (turn.startMs < previousEnd || turn.endMs > durationMs) {
      throw new BadRequestException(
        'Timeline không tăng dần hoặc vượt thời lượng audio.',
      );
    }
    previousEnd = turn.endMs;
  }
  if (seen.size !== expected.size) {
    throw new BadRequestException('Timeline thiếu lượt lời chuẩn.');
  }
}

@Injectable()
export class ListeningAudioAuthoringService {
  private readonly logger = new Logger(ListeningAudioAuthoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  private loadCanonical(quizId: number): Promise<CanonicalSynthesisPayload> {
    return this.prisma.quiz
      .findUnique({
        where: { id: quizId },
        select: {
          id: true,
          type: true,
          questions: {
            orderBy: { order: 'asc' },
            select: { id: true, order: true, content: true },
          },
        },
      })
      .then((quiz) => {
        if (!quiz)
          throw new NotFoundException('Không tìm thấy bài luyện nghe.');
        if (quiz.type !== QuizType.LISTENING_PRACTICE) {
          throw new BadRequestException(
            'Chỉ tạo audio artifact cho bài Luyện nghe.',
          );
        }
        const blocks: NormalizedDialogueSegment[][] = [];
        const blockQuestions = quiz.questions.map((question) => {
          const content = (question.content ?? {}) as Record<string, unknown>;
          const segments = withSpeakerTurnIds(
            normalizeDialogueSegments(content.transcriptSegments),
          );
          const source =
            segments.length > 0
              ? segments
              : typeof content.correctAnswer === 'string'
                ? [
                    {
                      speaker: String(content.speaker ?? 'speaker-1'),
                      text: content.correctAnswer,
                    },
                  ]
                : [];
          return { question, content, source };
        });
        const turns: CanonicalTurn[] = [];
        const accent = blockQuestions.some(
          ({ content }) => content.accent === 'UK',
        )
          ? 'UK'
          : 'US';
        for (const { source } of blockQuestions) {
          if (source.length > 1) blocks.push(source);
        }
        const uniqueSegments = blocks.length
          ? dedupeRepeatedDialogueBlocks(blocks)
          : blockQuestions.flatMap(({ source }) => source);
        const speakerSlotMap = new Map<string, number>();
        let turnIndex = 0;
        for (const segment of withSpeakerTurnIds(uniqueSegments)) {
          const speakerId = segment.speakerId ?? segment.speaker ?? 'speaker-1';
          if (!speakerSlotMap.has(speakerId)) {
            speakerSlotMap.set(speakerId, speakerSlotMap.size);
          }
          const voice = resolveListeningVoice(
            speakerId,
            accent,
            segment.voiceKey,
            speakerSlotMap.get(speakerId),
          );
          const expressive = resolveDeliveryStyle(
            voice.providerVoice,
            segment.delivery,
          );
          turns.push({
            turnId: `turn-${String(++turnIndex).padStart(3, '0')}`,
            speakerTurnId: segment.speakerTurnId ?? `speaker-turn-${turnIndex}`,
            speakerId,
            text: segment.text.trim(),
            ...(segment.translation
              ? { translation: segment.translation }
              : {}),
            tone: segment.tone ?? 'NEUTRAL',
            rate: segment.rate ?? '0%',
            pauseMs: segment.pauseMs ?? 260,
            ...(segment.dialogueAct
              ? { dialogueAct: segment.dialogueAct }
              : {}),
            ...(segment.delivery ? { delivery: segment.delivery } : {}),
            ...(expressive.style ? { expressiveStyle: expressive.style } : {}),
            ...(expressive.styleDegree !== undefined
              ? { styleDegree: expressive.styleDegree }
              : {}),
            ...(segment.emphasis ? { emphasis: segment.emphasis } : {}),
            ...voice,
          });
        }
        if (turns.length === 0)
          throw new BadRequestException('Bài luyện chưa có transcript hợp lệ.');
        const resolvedAccent = turns.some((turn) =>
          turn.providerVoice.startsWith('en-GB'),
        )
          ? 'UK'
          : accent;
        return {
          schemaVersion: 'listening-audio.v2',
          quizId,
          locale: resolvedAccent === 'UK' ? 'en-GB' : 'en-US',
          accent: resolvedAccent,
          outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
          voiceRegistryVersion: LISTENING_VOICE_REGISTRY_VERSION,
          ssmlPolicyVersion: 'safe-ssml.v2',
          turns,
        };
      });
  }

  async validateContent(quizId: number) {
    const payload = await this.loadCanonical(quizId);
    const speakers = new Set(payload.turns.map((turn) => turn.speakerId));
    if (speakers.size < 2) {
      throw new BadRequestException(
        'Hội thoại production cần ít nhất hai người nói.',
      );
    }
    const providerVoices = new Set(
      payload.turns.map((turn) => turn.providerVoice),
    );
    if (speakers.size > 1 && providerVoices.size < 2) {
      throw new BadRequestException(
        'Mỗi người nói trong hội thoại phải được ánh xạ sang một giọng đọc khác nhau.',
      );
    }
    return {
      quizId,
      turns: payload.turns.length,
      speakers: [...speakers],
      contentHash: sha256(
        stableJson(
          payload.turns.map(({ turnId, speakerId, text, translation }) => ({
            turnId,
            speakerId,
            text,
            translation,
          })),
        ),
      ),
      synthesisHash: sha256(stableJson(payload)),
      valid: true,
    };
  }

  private synthesize(
    payload: CanonicalSynthesisPayload,
  ): Promise<{ audio: Buffer; timeline: TimelineTurn[]; durationMs: number }> {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      throw new ServiceUnavailableException(
        'Azure Speech chưa được cấu hình cho authoring.',
      );
    }
    return new Promise((resolve, reject) => {
      const config = SpeechSDK.SpeechConfig.fromSubscription(key, region);
      config.speechSynthesisOutputFormat =
        SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
      const chunks: Buffer[] = [];
      const stream = SpeechSDK.PushAudioOutputStream.create({
        write: (data: ArrayBuffer) => {
          chunks.push(Buffer.from(data));
        },
        close: () => undefined,
      });
      const audioConfig = SpeechSDK.AudioConfig.fromStreamOutput(stream);
      const synthesizer = new SpeechSDK.SpeechSynthesizer(config, audioConfig);
      const bookmarks: { text: string; audioOffset: number }[] = [];
      synthesizer.bookmarkReached = (_sender, event) =>
        bookmarks.push({ text: event.text, audioOffset: event.audioOffset });
      synthesizer.speakSsmlAsync(
        buildListeningSsml(payload),
        (result) => {
          const starts = new Map<string, number>();
          const ends = new Map<string, number>();
          for (const bookmark of bookmarks) {
            const match = /^(.*):(start|end)$/.exec(bookmark.text);
            if (!match) continue;
            const ms = Math.round(bookmark.audioOffset / 10000);
            if (match[2] === 'start') starts.set(match[1], ms);
            else ends.set(match[1], ms);
          }
          // Bookmark callbacks are delivered asynchronously by the SDK. Build
          // the timeline in canonical turn order instead of callback order so
          // an out-of-order event cannot create a false non-monotonic timeline.
          const timeline: TimelineTurn[] = payload.turns.map((turn) => ({
            turnId: turn.turnId,
            startMs: starts.get(turn.turnId) ?? -1,
            endMs: ends.get(turn.turnId) ?? -1,
          }));
          const audio = Buffer.concat(
            chunks.length ? chunks : [Buffer.from(result.audioData)],
          );
          const durationPromise = parseEncodedMp3DurationMs(audio);
          synthesizer.close();
          durationPromise
            .then((durationMs) => {
              validateTimeline(
                timeline,
                durationMs,
                payload.turns.map((turn) => turn.turnId),
              );
              resolve({ audio, timeline, durationMs });
            })
            .catch((error: unknown) =>
              reject(error instanceof Error ? error : new Error(String(error))),
            );
        },
        (error) => {
          synthesizer.close();
          reject(new Error(`Azure Speech synthesis failed: ${error}`));
        },
      );
    });
  }

  private async recordUsage(input: {
    quizId: number;
    artifactId: number;
    actorId: number;
    synthesisHash: string;
    characterCount: number;
    success: boolean;
    durationMs?: number;
    error?: string;
  }) {
    try {
      await this.prisma.listeningAudioUsage.create({
        data: {
          quizId: input.quizId,
          artifactId: input.artifactId,
          actorId: input.actorId,
          provider: 'AZURE_SPEECH',
          operation: 'LISTENING_TTS_AUTHORING',
          synthesisHash: input.synthesisHash,
          characterCount: input.characterCount,
          success: input.success,
          durationMs: input.durationMs,
          error: input.error?.slice(0, 1000),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Listening authoring usage telemetry failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async generatePreview(quizId: number, actorId: number) {
    const payload = await this.loadCanonical(quizId);
    const startedAt = Date.now();
    const synthesisHash = sha256(stableJson(payload));
    const contentHash = sha256(
      stableJson(
        payload.turns.map(({ turnId, speakerId, text, translation }) => ({
          turnId,
          speakerId,
          text,
          translation,
        })),
      ),
    );
    const existing = await this.prisma.listeningAudioArtifact.findUnique({
      where: { quizId_synthesisHash: { quizId, synthesisHash } },
    });
    if (
      existing &&
      ['PREVIEW_READY', 'APPROVED', 'PUBLISHED'].includes(existing.status)
    )
      return { ...existing, reused: true };
    if (existing?.status === 'GENERATING') return { ...existing, reused: true };
    if (existing && ['FAILED', 'STALE'].includes(existing.status)) {
      const claimed = await this.prisma.listeningAudioArtifact.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: 'GENERATING', error: null },
      });
      if (claimed.count === 0) {
        const current =
          await this.prisma.listeningAudioArtifact.findUniqueOrThrow({
            where: { id: existing.id },
          });
        return { ...current, reused: true };
      }
    }
    const max = await this.prisma.listeningAudioArtifact.aggregate({
      where: { quizId },
      _max: { version: true },
    });
    let artifact =
      existing?.status === 'FAILED' || existing?.status === 'STALE'
        ? await this.prisma.listeningAudioArtifact.findUniqueOrThrow({
            where: { id: existing.id },
          })
        : undefined;
    try {
      artifact ??= await this.prisma.listeningAudioArtifact.create({
        data: {
          quizId,
          version: (max._max.version ?? 0) + 1,
          synthesisHash,
          contentHash,
          status: 'GENERATING',
          provider: 'AZURE_SPEECH_SDK',
          locale: payload.locale,
          accent: payload.accent,
          voiceRegistryVersion: payload.voiceRegistryVersion,
          outputFormat: payload.outputFormat,
        },
      });
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        const retry = await this.prisma.listeningAudioArtifact.findUnique({
          where: { quizId_synthesisHash: { quizId, synthesisHash } },
        });
        if (retry) return { ...retry, reused: true };
      }
      throw error;
    }
    try {
      const synthesized = await this.synthesize(payload);
      const key = `${PRODUCTION_PREFIX}/quiz-${quizId}/audio/v${artifact.version}/full.mp3`;
      const uploaded = await this.uploadService.putObjectAtKey(
        key,
        synthesized.audio,
        'audio/mpeg',
      );
      await this.prisma.listeningAudioArtifact.update({
        where: { id: artifact.id },
        data: {
          status: 'PREVIEW_READY',
          r2Key: uploaded.key,
          r2Url: uploaded.url,
          durationMs: synthesized.durationMs,
          checksumSha256: sha256(synthesized.audio),
          timeline: synthesized.timeline as unknown as Prisma.InputJsonValue,
        },
      });
      await this.recordUsage({
        quizId,
        artifactId: artifact.id,
        actorId,
        synthesisHash,
        characterCount: payload.turns.reduce(
          (total, turn) => total + turn.text.length,
          0,
        ),
        success: true,
        durationMs: Date.now() - startedAt,
      });
      return {
        ...(await this.prisma.listeningAudioArtifact.findUniqueOrThrow({
          where: { id: artifact.id },
        })),
        actorId,
      };
    } catch (error) {
      await this.recordUsage({
        quizId,
        artifactId: artifact.id,
        actorId,
        synthesisHash,
        characterCount: payload.turns.reduce(
          (total, turn) => total + turn.text.length,
          0,
        ),
        success: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.prisma.listeningAudioArtifact.update({
        where: { id: artifact.id },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async getArtifact(quizId: number) {
    return this.prisma.listeningAudioArtifact.findFirst({
      where: { quizId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
  }

  async listArtifacts(quizId: number) {
    const artifacts = await this.prisma.listeningAudioArtifact.findMany({
      where: { quizId },
      orderBy: { version: 'desc' },
    });
    if (artifacts.length === 0) return artifacts;
    let currentHash: string | null = null;
    try {
      currentHash = (await this.validateContent(quizId)).synthesisHash;
    } catch {
      // Keep the CMS history visible even when the current content is not yet
      // authorable; Validate remains the explicit action that explains why.
    }
    return artifacts.map((artifact) => ({
      ...artifact,
      isStale: currentHash === null || artifact.synthesisHash !== currentHash,
    }));
  }

  async getCurrentPublishedArtifact(quizId: number) {
    const artifact = await this.getArtifact(quizId);
    if (!artifact) return null;
    try {
      const current = await this.validateContent(quizId);
      return current.synthesisHash === artifact.synthesisHash ? artifact : null;
    } catch {
      return null;
    }
  }

  async approve(quizId: number, artifactId: number, actorId: number) {
    const artifact = await this.prisma.listeningAudioArtifact.findFirst({
      where: { id: artifactId, quizId },
    });
    if (!artifact || artifact.status !== 'PREVIEW_READY')
      throw new ConflictException('Artifact chưa sẵn sàng để duyệt.');
    const current = await this.validateContent(quizId);
    if (current.synthesisHash !== artifact.synthesisHash)
      throw new ConflictException(
        'Artifact đã stale do nội dung thay đổi; hãy tạo preview mới.',
      );
    return this.prisma.listeningAudioArtifact.update({
      where: { id: artifact.id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actorId },
    });
  }

  async publish(quizId: number, artifactId: number, actorId: number) {
    const artifact = await this.prisma.listeningAudioArtifact.findFirst({
      where: { id: artifactId, quizId },
    });
    if (
      !artifact ||
      artifact.status !== 'APPROVED' ||
      !artifact.r2Key ||
      !artifact.checksumSha256 ||
      !artifact.timeline ||
      !artifact.durationMs
    )
      throw new ConflictException('Artifact chưa đủ điều kiện publish.');
    const current = await this.validateContent(quizId);
    if (current.synthesisHash !== artifact.synthesisHash)
      throw new ConflictException('Artifact đã stale do nội dung thay đổi.');
    if (!(await this.uploadService.objectExists(artifact.r2Key)))
      throw new ConflictException('Không tìm thấy object audio trên R2.');
    return this.prisma.$transaction(async (tx) => {
      // Serialize the publication pointer per quiz. A row-only updateMany is
      // not enough: two APPROVED artifacts can otherwise both become
      // PUBLISHED under concurrent admin requests.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`listening_publish:${quizId}`}))
      `;
      const lockedArtifact = await tx.listeningAudioArtifact.findFirst({
        where: { id: artifactId, quizId },
      });
      if (
        !lockedArtifact ||
        lockedArtifact.status !== 'APPROVED' ||
        !lockedArtifact.r2Key ||
        !lockedArtifact.checksumSha256 ||
        !lockedArtifact.timeline ||
        !lockedArtifact.durationMs
      ) {
        throw new ConflictException(
          'Artifact không còn ở trạng thái APPROVED để publish.',
        );
      }
      await tx.listeningAudioArtifact.updateMany({
        where: { quizId, status: 'PUBLISHED', id: { not: artifact.id } },
        data: { status: 'STALE' },
      });
      return tx.listeningAudioArtifact.update({
        where: { id: lockedArtifact.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedBy: actorId,
        },
      });
    });
  }

  async getPublishedAudio(
    quizId: number,
    requestedIdentity: PublishedListeningAudioIdentity = {},
  ) {
    const artifact = await this.getArtifact(quizId);
    if (!artifact || !artifact.r2Key)
      throw new ServiceUnavailableException({
        code: 'LISTENING_FULL_AUDIO_NOT_READY',
        message: 'Audio toàn bài chưa được quản trị viên tạo và duyệt.',
      });
    const current = await this.validateContent(quizId);
    if (current.synthesisHash !== artifact.synthesisHash)
      throw new ServiceUnavailableException({
        code: 'LISTENING_FULL_AUDIO_STALE',
        message: 'Audio hiện tại đã cũ; quản trị viên cần tạo lại.',
      });
    if (
      requestedIdentity.artifactId !== undefined &&
      requestedIdentity.artifactId !== artifact.id
    ) {
      throw new ConflictException('Audio không còn là phiên bản hiện hành.');
    }
    if (
      requestedIdentity.version !== undefined &&
      requestedIdentity.version !== artifact.version
    ) {
      throw new ConflictException('Audio không còn là phiên bản hiện hành.');
    }
    if (
      requestedIdentity.checksumSha256 &&
      requestedIdentity.checksumSha256 !== artifact.checksumSha256
    ) {
      throw new ConflictException(
        'Checksum audio không khớp phiên bản hiện hành.',
      );
    }
    return {
      artifact,
      buffer: await this.uploadService.downloadFileBuffer(artifact.r2Key),
    };
  }
}
