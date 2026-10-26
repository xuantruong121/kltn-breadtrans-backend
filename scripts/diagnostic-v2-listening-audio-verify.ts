/**
 * Coverage check of the generated V2 listening clips: transcribes each MP3
 * with Azure Speech (continuous recognition, en-US) and reports how many of
 * the approved script's words were recognised. One recognition session per
 * clip, hard-capped at 4; prints the audio seconds used.
 *
 * Usage: DIAG_V2_ASR_VERIFY_AUTHORIZED=4-sessions npx ts-node --transpile-only scripts/diagnostic-v2-listening-audio-verify.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

const OUT = 'artifacts/entry-diagnostic-v2-audio';
const MAX_SESSIONS = 4;

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/^[ab]:\s/gim, '')
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function recognise(wav: Buffer): Promise<string> {
  const config = SpeechSDK.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY as string,
    process.env.AZURE_SPEECH_REGION as string,
  );
  config.speechRecognitionLanguage = 'en-US';
  const audio = SpeechSDK.AudioConfig.fromWavFileInput(wav);
  const recognizer = new SpeechSDK.SpeechRecognizer(config, audio);
  const parts: string[] = [];
  return new Promise((resolve, reject) => {
    recognizer.recognized = (_s, e) => {
      if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech)
        parts.push(e.result.text);
    };
    recognizer.canceled = (_s, e) => {
      recognizer.close();
      if (e.reason === SpeechSDK.CancellationReason.Error)
        reject(new Error(`canceled: ${e.errorDetails}`.slice(0, 200)));
      else resolve(parts.join(' '));
    };
    recognizer.sessionStopped = () => {
      recognizer.close();
      resolve(parts.join(' '));
    };
    recognizer.startContinuousRecognitionAsync(undefined, reject);
  });
}

async function main() {
  if (process.env.DIAG_V2_ASR_VERIFY_AUTHORIZED !== '4-sessions')
    throw new Error('REFUSED: not authorized');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpeg: string = require('ffmpeg-static');
  const draft = JSON.parse(
    readFileSync('artifacts/entry-diagnostic-v2-content-draft.json', 'utf8'),
  );
  const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
  const tmp = mkdtempSync(join(tmpdir(), 'diag-v2-asr-'));
  let sessions = 0;
  let seconds = 0;
  for (const clip of manifest.clips) {
    if (sessions >= MAX_SESSIONS) throw new Error('HARD_CAP_REACHED');
    const wavPath = join(tmp, `${clip.clipKey}.wav`);
    execFileSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      clip.file,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-acodec',
      'pcm_s16le',
      wavPath,
    ]);
    sessions += 1;
    seconds += clip.durationMs / 1000;
    const heard = await recognise(readFileSync(wavPath));
    const script: string = draft.listening.clips.find(
      (c: any) => c.draftKey === clip.clipKey,
    ).script;
    const expected = words(script);
    const got = new Set(words(heard));
    const hit = expected.filter((w) => got.has(w)).length;
    const missing = [...new Set(expected.filter((w) => !got.has(w)))];
    console.log(
      `${clip.clipKey}: ${(clip.durationMs / 1000).toFixed(1)} s, script words ${expected.length}, recognised ${words(heard).length}, recall ${Math.round((hit / expected.length) * 100)}%${missing.length ? `, not heard: ${missing.slice(0, 12).join(' ')}` : ''}`,
    );
  }
  console.log(
    `AZURE_RECOGNITION_SESSIONS=${sessions} AUDIO_SECONDS=${seconds.toFixed(1)}`,
  );
}
main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
