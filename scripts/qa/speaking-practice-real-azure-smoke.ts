/**
 * ONE real Azure Speech call through the practice free-answer path
 * (assessPracticeSpeech, unscripted). No server, no queue, no DB write.
 * Counts against the owner-approved C3 cap: 1 session, the clip's length.
 *
 * Usage: npx ts-node scripts/qa/speaking-practice-real-azure-smoke.ts <16 kHz WAV>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';

import { assessPracticeSpeech } from '../../src/modules/speaking/speaking-assessment-mode';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_ALLOW_REAL_PROVIDER', 'speaking-practice-real-azure-smoke calls a real paid provider');

void (async () => {
  const wav = readFileSync(process.argv[2]);
  const ai = {
    assessPronunciation: () => {
      throw new Error('scripted path must not be called for a free answer');
    },
  };
  const started = Date.now();
  const result = await assessPracticeSpeech(
    ai as never,
    {
      taskType: 'RESPOND_TO_QUESTION',
      targetText: 'What do you usually do on weekends?',
    },
    wav,
  );
  console.log(
    JSON.stringify({ elapsedMs: Date.now() - started, result }, null, 2),
  );
})().catch((e) => {
  console.error('FAILED', e?.code, e?.message);
  process.exit(1);
});
