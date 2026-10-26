/**
 * Phase C2: measure how far the duration the normalizer reports drifts from
 * the duration actually encoded, so the speaking tolerance is derived from
 * observed codec behaviour rather than guessed.
 *
 * Encodes exact-length tones with ffmpeg-static into every container the
 * diagnostic accepts, then runs each through the REAL normalizer.
 * Local files only; no network, no database.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ffmpegPath from 'ffmpeg-static';

import { DiagnosticSpeakingAudioNormalizer } from '../../src/modules/diagnostic/diagnostic-speaking-audio-normalizer';

const FORMATS = [
  {
    ext: 'webm',
    mime: 'audio/webm;codecs=opus',
    codec: ['-c:a', 'libopus', '-b:a', '32k'],
  },
  { ext: 'ogg', mime: 'audio/ogg', codec: ['-c:a', 'libopus', '-b:a', '32k'] },
  { ext: 'm4a', mime: 'audio/mp4', codec: ['-c:a', 'aac', '-b:a', '64k'] },
  { ext: 'wav', mime: 'audio/wav', codec: ['-c:a', 'pcm_s16le'] },
];

async function main() {
  if (!ffmpegPath) throw new Error('ffmpeg-static unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'c2-codec-'));
  const normalizer = new DiagnosticSpeakingAudioNormalizer();
  let worst = 0;
  try {
    for (const seconds of [0.25, 1, 45, 60]) {
      for (const f of FORMATS) {
        const out = join(dir, `t${seconds}.${f.ext}`);
        execFileSync(ffmpegPath, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
          '-ac',
          '1',
          ...f.codec,
          out,
        ]);
        const result = await normalizer.normalize(readFileSync(out), f.mime);
        const drift = result.durationMs - seconds * 1000;
        worst = Math.max(worst, Math.abs(drift));
        console.log(
          `${String(seconds).padStart(5)}s ${f.ext.padEnd(4)} -> measured ${String(result.durationMs).padStart(6)} ms  drift ${drift >= 0 ? '+' : ''}${drift} ms  (${result.inputBytes} bytes)`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nWORST_ABSOLUTE_CODEC_DRIFT_MS=${worst}`);
}

main().catch((e) => {
  console.error('MEASURE FAILED:', e?.message ?? e);
  process.exit(2);
});
