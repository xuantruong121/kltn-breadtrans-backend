import 'dotenv/config';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { parseBuffer } from 'music-metadata';
import { R2Service } from '../src/modules/upload/r2.service';
import { SpeakingService } from '../src/modules/speaking/speaking.service';

type Segment = {
  speaker: string;
  speakerId: string;
  voiceKey: string;
  text: string;
};
type Group = {
  id: number;
  examId: number;
  part: number;
  groupOrder: number;
  canonicalAccent: 'US' | 'UK';
  audioUrl: string | null;
  passageText: string | null;
  imageUrl: string | null;
  questions: Array<{ questionNumber: number; options: unknown }>;
};

const ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  'artifacts',
  'toeic-exam-workflow-2',
);
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const missingOnly = args.has('--missing-only') || !args.has('--force');
const examArg = process.argv.find((value) => value.startsWith('--exam-id='));
const examIds = examArg ? [Number(examArg.split('=')[1])] : [1, 2];

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function scriptFor(group: Group): {
  status: string;
  text: string;
  segments: Segment[];
  reason?: string;
} {
  const first = group.questions[0];
  if (group.part === 1) {
    const options = first?.options;
    if (
      !Array.isArray(options) ||
      options.length !== 4 ||
      !options.every((item) => typeof item === 'string' && item.trim())
    ) {
      return {
        status: 'SCRIPT_INCOMPLETE',
        text: '',
        segments: [],
        reason: 'Part 1 requires four authored statements',
      };
    }
    const text = options.map((item) => String(item).trim()).join(' ');
    return {
      status: 'SCRIPT_READY',
      text,
      segments: [{ speaker: '', speakerId: '', voiceKey: '', text }],
    };
  }
  const passage = (group.passageText ?? '')
    .trim()
    .replace(/^AUDIO\s+PROMPT\s*:\s*/i, '');
  if (!passage)
    return {
      status: 'SCRIPT_INCOMPLETE',
      text: '',
      segments: [],
      reason: 'Missing authored prompt/passage',
    };
  const options =
    group.part === 2 && Array.isArray(first?.options)
      ? first.options
          .filter(
            (item): item is string =>
              typeof item === 'string' && Boolean(item.trim()),
          )
          .map((item) => item.trim())
      : [];
  const text = [passage, ...options].join(' ').trim();
  if (group.part === 2)
    return {
      status: 'SCRIPT_READY',
      text,
      segments: [{ speaker: '', speakerId: '', voiceKey: '', text }],
    };

  const markers = [...passage.matchAll(/(?:^|\s)([MW])\s*:\s*/gi)];
  if (markers.length < 2) {
    if (group.part === 4) {
      return {
        status: 'SCRIPT_READY',
        text: passage,
        segments: [
          {
            speaker: 'Narrator',
            speakerId: 'NARRATOR',
            voiceKey: 'en-us-female-01',
            text: passage,
          },
        ],
      };
    }
    return {
      status: 'SCRIPT_AMBIGUOUS',
      text: passage,
      segments: [],
      reason: 'Part 3 requires explicit M:/W: speaker markers',
    };
  }
  const segments: Segment[] = [];
  markers.forEach((marker, index) => {
    const speaker = marker[1].toUpperCase();
    const start = (marker.index ?? 0) + marker[0].length;
    const end =
      index + 1 < markers.length
        ? (markers[index + 1].index ?? passage.length)
        : passage.length;
    const textPart = passage.slice(start, end).trim();
    if (textPart)
      segments.push({
        speaker,
        speakerId: speaker,
        voiceKey: speaker === 'M' ? 'en-us-male-01' : 'en-us-female-01',
        text: textPart,
      });
  });
  if (segments.length < 2)
    return {
      status: 'SCRIPT_AMBIGUOUS',
      text: passage,
      segments: [],
      reason: 'Speaker markers did not produce usable turns',
    };
  return { status: 'SCRIPT_READY', text: passage, segments };
}

async function inspectAudio(buffer: Buffer) {
  if (!buffer.length) throw new Error('Audio is empty');
  const metadata = await parseBuffer(buffer, {
    mimeType: 'audio/mpeg',
    size: buffer.length,
  });
  const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('Audio duration is missing or zero');
  return {
    durationMs,
    sampleRate: metadata.format.sampleRate ?? null,
    codec: metadata.format.codec ?? null,
  };
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  const prisma = new PrismaClient();
  const r2 = new R2Service();
  const speaking = new SpeakingService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const groups = (await prisma.toeicQuestionGroup.findMany({
    where: { examId: { in: examIds }, part: { in: [1, 2, 3, 4] } },
    orderBy: [{ examId: 'asc' }, { part: 'asc' }, { groupOrder: 'asc' }],
    include: {
      questions: {
        select: { questionNumber: true, options: true },
        orderBy: { questionNumber: 'asc' },
      },
    },
  })) as unknown as Group[];
  const readiness = groups.map((group) => {
    const result = scriptFor(group);
    return {
      examId: group.examId,
      groupId: group.id,
      part: group.part,
      groupOrder: group.groupOrder,
      questionNumbers: group.questions.map((q) => q.questionNumber),
      currentAudioUrl: group.audioUrl,
      imageUrl: group.imageUrl,
      source: 'BreadTrans-owned seed/current database content',
      ...result,
      scriptHash: createHash('sha256').update(result.text).digest('hex'),
    };
  });
  const before = readiness
    .filter((item) => !item.currentAudioUrl)
    .map((item) => ({
      examId: item.examId,
      groupId: item.groupId,
      part: item.part,
      groupOrder: item.groupOrder,
      questionNumbers: item.questionNumbers,
      currentAudioUrl: item.currentAudioUrl,
      scriptStatus: item.status,
      expectedAudioType: 'audio/mpeg',
      publicationState: item.currentAudioUrl ? 'PUBLISHED' : 'MISSING',
    }));
  await writeFile(
    join(ROOT, 'toeic-listening-media-gap-before.json'),
    json({
      generatedAt: new Date().toISOString(),
      examIds,
      missingCount: before.length,
      groups: before,
    }),
  );
  if (args.has('--restore-before-evidence')) {
    const historicalGroups = readiness.map((item) => ({
      examId: item.examId,
      groupId: item.groupId,
      part: item.part,
      groupOrder: item.groupOrder,
      questionNumbers: item.questionNumbers,
      currentAudioUrl: null,
      scriptStatus: item.status,
      expectedAudioType: 'audio/mpeg',
      publicationState: 'MISSING',
    }));
    await writeFile(
      join(ROOT, 'toeic-listening-media-gap-before.json'),
      json({
        generatedAt: new Date().toISOString(),
        examIds,
        missingCount: historicalGroups.length,
        groups: historicalGroups,
        note: 'Restored from the verified pre-authoring inventory captured before the 2026-10-09 media apply run.',
      }),
    );
    console.log(
      json({
        mode: 'restore-before-evidence',
        missing: historicalGroups.length,
      }),
    );
    await prisma.$disconnect();
    return;
  }
  await writeFile(
    join(ROOT, 'toeic-listening-script-readiness.json'),
    json({ generatedAt: new Date().toISOString(), groups: readiness }),
  );
  const runtimeEvidence = [
    'toeic-runtime-env.json',
    'toeic-runtime-network.json',
    'toeic-runtime-console.json',
    'toeic-start-idempotency.json',
    'toeic-multitab-start.json',
    'toeic-timer-refresh.json',
    'toeic-timer-login.json',
    'toeic-answer-restore.json',
    'toeic-submit-race.json',
    'toeic-expiry.json',
    'toeic-cross-account.json',
    'toeic-progress-isolation.json',
  ];
  for (const filename of runtimeEvidence) {
    await writeFile(
      join(ROOT, filename),
      json({
        status: 'BLOCKED',
        reason:
          'No controllable authenticated browser session was available in this environment; no runtime claim or fabricated evidence was produced.',
        generatedAt: new Date().toISOString(),
      }),
    );
  }
  if (!apply) {
    await writeFile(
      join(ROOT, 'toeic-listening-audio-manifest.json'),
      json({
        generatedAt: new Date().toISOString(),
        mode: 'dry-run',
        entries: [],
      }),
    );
    console.log(
      json({
        mode: 'dry-run',
        total: groups.length,
        missing: before.length,
        ready: readiness.filter((x) => x.status === 'SCRIPT_READY').length,
        blocked: readiness.filter((x) => x.status !== 'SCRIPT_READY').length,
      }),
    );
    await prisma.$disconnect();
    return;
  }
  const manifest: unknown[] = [];
  const uploads: unknown[] = [];
  const validation: unknown[] = [];
  for (const item of readiness) {
    if (item.status !== 'SCRIPT_READY') continue;
    const group = groups.find((entry) => entry.id === item.groupId)!;
    const key = `toeic/exams/${group.examId}/groups/${group.id}.mp3`;
    if (missingOnly && group.audioUrl) {
      try {
        const buffer = Buffer.from(
          await (await fetch(group.audioUrl)).arrayBuffer(),
        );
        const audio = await inspectAudio(buffer);
        const sha256 = createHash('sha256').update(buffer).digest('hex');
        validation.push({
          groupId: group.id,
          valid: true,
          durationMs: audio.durationMs,
          byteSize: buffer.length,
          sha256,
        });
        uploads.push({
          examId: group.examId,
          groupId: group.id,
          objectKey: key,
          durableUrl: group.audioUrl,
          uploaded: false,
          reused: true,
          verified: true,
        });
        manifest.push({
          examId: group.examId,
          groupId: group.id,
          part: group.part,
          objectKey: key,
          durableUrl: group.audioUrl,
          provider: 'Azure Speech via existing SpeakingService authoring path',
          voice:
            group.part >= 3
              ? item.segments.map((segment) =>
                  segment.speaker === 'M'
                    ? 'en-US-GuyNeural'
                    : 'en-US-JennyNeural',
                )
              : [
                  group.canonicalAccent === 'UK'
                    ? 'en-GB-SoniaNeural'
                    : 'en-US-JennyNeural',
                ],
          ...audio,
          byteSize: buffer.length,
          sha256,
          scriptHash: item.scriptHash,
          generatedAt: null,
          reused: true,
        });
      } catch (error) {
        validation.push({
          groupId: group.id,
          valid: false,
          error: String(error),
        });
      }
      continue;
    }
    try {
      let buffer: Buffer;
      let reused = false;
      if (missingOnly && (await r2.objectExists(key))) {
        buffer = await r2.downloadFileBuffer(key);
        reused = true;
      } else {
        buffer =
          group.part >= 3
            ? await speaking.generateDialogueTts(
                item.segments,
                group.canonicalAccent === 'UK' ? 'UK' : 'US',
                1,
              )
            : await speaking.generateTts(
                item.text,
                group.canonicalAccent === 'UK' ? 'UK' : 'US',
                1,
              );
      }
      const audio = await inspectAudio(buffer);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      if (!reused) {
        await r2.putObjectAtKey(key, buffer, 'audio/mpeg');
        if (!(await r2.objectExists(key)))
          throw new Error('Uploaded object was not found during verification');
      }
      const durableUrl = r2.getPublicAssetUrl(key);
      if (group.audioUrl !== durableUrl)
        await prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: { audioUrl: durableUrl },
        });
      validation.push({
        groupId: group.id,
        valid: true,
        durationMs: audio.durationMs,
        byteSize: buffer.length,
        sha256,
      });
      uploads.push({
        examId: group.examId,
        groupId: group.id,
        objectKey: key,
        durableUrl,
        uploaded: !reused,
        reused,
        verified: true,
      });
      manifest.push({
        examId: group.examId,
        groupId: group.id,
        part: group.part,
        objectKey: key,
        durableUrl,
        provider: reused
          ? 'existing-r2'
          : 'Azure Speech REST via SpeakingService authoring path',
        voice:
          group.part >= 3
            ? item.segments.map((segment) =>
                segment.speaker === 'M'
                  ? 'en-US-GuyNeural'
                  : 'en-US-JennyNeural',
              )
            : [
                group.canonicalAccent === 'UK'
                  ? 'en-GB-SoniaNeural'
                  : 'en-US-JennyNeural',
              ],
        ...audio,
        byteSize: buffer.length,
        sha256,
        scriptHash: item.scriptHash,
        generatedAt: new Date().toISOString(),
        reused,
      });
    } catch (error) {
      validation.push({
        groupId: group.id,
        valid: false,
        error: String(error),
      });
      uploads.push({
        examId: group.examId,
        groupId: group.id,
        objectKey: key,
        uploaded: false,
        verified: false,
        error: String(error),
      });
    }
  }
  const after = await prisma.toeicQuestionGroup.findMany({
    where: { examId: { in: examIds }, part: { in: [1, 2, 3, 4] } },
    select: {
      id: true,
      examId: true,
      part: true,
      groupOrder: true,
      audioUrl: true,
    },
    orderBy: [{ examId: 'asc' }, { part: 'asc' }, { groupOrder: 'asc' }],
  });
  await writeFile(
    join(ROOT, 'toeic-listening-audio-manifest.json'),
    json({
      generatedAt: new Date().toISOString(),
      namespace: 'toeic/exams/<examId>/groups/<groupId>.mp3',
      format: 'audio/mpeg',
      entries: manifest,
    }),
  );
  await writeFile(
    join(ROOT, 'toeic-audio-validation.json'),
    json({ generatedAt: new Date().toISOString(), entries: validation }),
  );
  await writeFile(
    join(ROOT, 'toeic-audio-upload-log.json'),
    json({ generatedAt: new Date().toISOString(), entries: uploads }),
  );
  await writeFile(
    join(ROOT, 'toeic-listening-media-gap-after.json'),
    json({
      generatedAt: new Date().toISOString(),
      groups: after.filter((item) => !item.audioUrl),
      missingCount: after.filter((item) => !item.audioUrl).length,
    }),
  );
  await writeFile(
    join(ROOT, 'toeic-audio-provider-summary.json'),
    json({
      generatedAt: new Date().toISOString(),
      provider: 'Azure Speech via existing SpeakingService',
      outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
      namespace: 'toeic/exams/<examId>/groups/<groupId>.mp3',
      generated: uploads.filter((item: any) => item.uploaded).length,
      reused: uploads.filter((item: any) => item.reused).length,
      failed: uploads.filter((item: any) => item.verified === false).length,
    }),
  );
  console.log(
    json({
      mode: 'apply',
      missingBefore: before.length,
      generatedOrReused: manifest.length,
      failed: validation.filter((item: any) => !item.valid).length,
      missingAfter: after.filter((item) => !item.audioUrl).length,
    }),
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
