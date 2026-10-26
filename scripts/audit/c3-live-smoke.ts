/**
 * Phase C3 bounded live smoke test of the real Entry Diagnostic graders.
 *
 * NOT RUN IN C3. `--live` calls Azure Speech and Gemini, which costs money and
 * sends audio and text to external services; it refuses to start without the
 * explicit authorization variable below, which must only be set after the
 * user has approved artifacts/entry-diagnostic-phase-c3-live-smoke-plan.md.
 *
 * What it exercises: the production grader classes (ProviderDiagnosticRubric
 * Grader, AzureUnscriptedSpeechAssessor over createAzureRecognitionSession,
 * AiService.generateStructuredJson over GeminiEvaluatorStrategy), the real
 * audio normalizer, validateRubricGrade and gradeWithRubric.
 * What it never touches: any database, any Redis, object storage, the running
 * application. Nothing is persisted except the result file.
 *
 * Hard caps: at most MAX_AZURE_SESSIONS recognition sessions and
 * MAX_MODEL_CALLS structured-JSON calls; the next call past a cap throws and
 * the run stops. (One gateway call may rotate through up to three Gemini keys
 * internally on rate-limit or auth errors.)
 *
 * `--dry-run` replaces both network seams with fakes and needs no credentials;
 * it proves the harness, not the providers.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/audit/c3-live-smoke.ts --dry-run
 *   C3_LIVE_SMOKE_AUTHORIZED=bounded-c3-live-smoke \
 *     npx ts-node --transpile-only scripts/audit/c3-live-smoke.ts --live --audio-dir <dir>
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';

import { AiService } from '../../src/modules/ai/ai.service';
import { GeminiEvaluatorStrategy } from '../../src/modules/ai/strategies/gemini-evaluator.strategy';
import {
  AzureUnscriptedSpeechAssessor,
  createAzureRecognitionSession,
  type RecognitionSession,
} from '../../src/modules/diagnostic/diagnostic-azure-speech';
import {
  assessWritingLength,
  gradeWithRubric,
  parseRubric,
  type RubricGradeOutcome,
} from '../../src/modules/diagnostic/diagnostic-productive';
import { ProviderDiagnosticRubricGrader } from '../../src/modules/diagnostic/diagnostic-rubric-grader';
import { DiagnosticSpeakingAudioNormalizer } from '../../src/modules/diagnostic/diagnostic-speaking-audio-normalizer';

const AUTHORIZATION = 'bounded-c3-live-smoke';
const MAX_AZURE_SESSIONS = 6;
const MAX_MODEL_CALLS = 16;
const ROOT = join(__dirname, '..', '..');
const ARTIFACTS = join(ROOT, 'artifacts');

const args = process.argv.slice(2);
const live = args.includes('--live');
const dryRun = args.includes('--dry-run');
const audioDir = args[args.indexOf('--audio-dir') + 1];

const MIME: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
};

/** Word error rate between what was said and what Azure heard. */
function wordErrorRate(reference: string, hypothesis: string): number {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean);
  const r = norm(reference);
  const h = norm(hypothesis);
  const d = Array.from({ length: r.length + 1 }, (_, i) =>
    Array.from({ length: h.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= r.length; i += 1)
    for (let j = 1; j <= h.length; j += 1)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
  return r.length
    ? Math.round((d[r.length][h.length] / r.length) * 1000) / 1000
    : 0;
}

function capped<T extends (...a: any[]) => Promise<any>>(
  fn: T,
  cap: number,
  name: string,
) {
  let calls = 0;
  const wrapped = ((...a: any[]) => {
    if (calls >= cap)
      throw new Error(`HARD_CAP_REACHED: ${name} limited to ${cap} calls`);
    calls += 1;
    return fn(...a);
  }) as T;
  return { wrapped, count: () => calls };
}

function fakeSeams() {
  const session: RecognitionSession = () => {
    const words =
      'I usually study in the library near my house because it is quiet'.split(
        ' ',
      );
    return Promise.resolve({
      segments: [
        JSON.stringify({
          Duration: words.length * 4_500_000,
          DisplayText: words.join(' '),
          NBest: [
            {
              Display: words.join(' '),
              PronunciationAssessment: {
                AccuracyScore: 80,
                FluencyScore: 70,
                ProsodyScore: 65,
                PronScore: 75,
              },
              Words: words.map((w, i) => ({
                Word: w,
                Offset: i * 4_500_000,
                Duration: 3_500_000,
              })),
            },
          ],
        }),
      ],
    });
  };
  const gateway = {
    generateStructuredJson: (input: any) => {
      const ref = /"submissionRef" exactly as "([^"]+)"/.exec(input.prompt)![1];
      const version = /"rubricVersion" exactly as "([^"]+)"/.exec(
        input.prompt,
      )![1];
      const keys: string[] = input.responseSchema.properties.criteria.required;
      const graded = input.prompt
        .slice(input.prompt.indexOf('<<<') + 3, input.prompt.lastIndexOf('>>>'))
        .trim();
      return Promise.resolve({
        model: 'dry-run-fake',
        text: JSON.stringify({
          submissionRef: ref,
          rubricVersion: version,
          criteria: Object.fromEntries(keys.map((k) => [k, 2])),
          criterionFeedback: Object.fromEntries(
            keys.map((k) => [k, `Dry-run note for ${k}.`]),
          ),
          feedback: 'Dry-run feedback, produced without any provider.',
          suggestions: [],
          evidenceQuotes: [graded.split(/\s+/u).slice(0, 3).join(' ')],
        }),
      });
    },
  };
  return { session, gateway };
}

async function main() {
  if (live === dryRun)
    throw new Error('REFUSED: pass exactly one of --live or --dry-run');
  if (live) {
    if (process.env.C3_LIVE_SMOKE_AUTHORIZED !== AUTHORIZATION)
      throw new Error(
        'REFUSED: live smoke is not authorized (see the C3 live smoke plan)',
      );
    if (process.env.NODE_ENV === 'production')
      throw new Error('REFUSED: NODE_ENV=production');
    // Credentials are read only here, only in an authorized live run.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ quiet: true });
  }

  const drafts = JSON.parse(
    readFileSync(
      join(ARTIFACTS, 'entry-diagnostic-v2-content-draft.json'),
      'utf8',
    ),
  );
  const rubricsDoc = JSON.parse(
    readFileSync(
      join(ARTIFACTS, 'entry-diagnostic-v2-rubrics-draft.json'),
      'utf8',
    ),
  );
  const rubricOf = (skill: 'SPEAKING' | 'WRITING') => {
    const r = rubricsDoc.rubrics.find((x: any) => x.skill === skill);
    return parseRubric({
      id: skill === 'SPEAKING' ? 1 : 2,
      skill,
      rubricVersion: r.rubricVersion,
      criteria: r.criteria,
    });
  };
  const task = (key: string) =>
    [...drafts.speaking.tasks, ...drafts.writing.tasks].find(
      (t: any) => t.draftKey === key,
    );

  let session: RecognitionSession;
  let gateway: Pick<AiService, 'generateStructuredJson'>;
  if (live) {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region)
      throw new Error(
        'REFUSED: AZURE_SPEECH_KEY/AZURE_SPEECH_REGION are not set',
      );
    session = createAzureRecognitionSession({ key, region });
    // No Redis: the Gemini rotation then keeps no cooldown or telemetry state.
    gateway = new AiService(new GeminiEvaluatorStrategy());
  } else {
    ({ session, gateway } = fakeSeams());
  }
  const azure = capped(session, MAX_AZURE_SESSIONS, 'Azure sessions');
  const model = capped(
    (input: Parameters<AiService['generateStructuredJson']>[0]) =>
      gateway.generateStructuredJson(input),
    MAX_MODEL_CALLS,
    'model calls',
  );
  const grader = new ProviderDiagnosticRubricGrader(
    { generateStructuredJson: model.wrapped },
    new AzureUnscriptedSpeechAssessor(azure.wrapped),
  );

  const summarize = (outcome: RubricGradeOutcome) =>
    outcome.status === 'GRADED'
      ? {
          status: outcome.status,
          attempts: outcome.attempts,
          criteria: outcome.grade.criteria,
          taskPercentage: Math.round(outcome.grade.taskPercentage * 10) / 10,
          criterionFeedback: outcome.grade.criterionFeedback,
          feedback: outcome.grade.feedback,
          suggestions: outcome.grade.suggestions,
          evidenceQuotes: outcome.grade.evidenceQuotes,
          transcript: outcome.grade.transcript,
          speechEvidence: outcome.grade.speechEvidence,
        }
      : {
          status: outcome.status,
          attempts: outcome.attempts,
          reason: outcome.reason,
        };

  const results: any[] = [];
  const writing = JSON.parse(
    readFileSync(
      join(ARTIFACTS, 'c3-fixtures', 'writing-smoke-fixtures.json'),
      'utf8',
    ),
  );
  for (const c of writing.cases) {
    const t = task(c.task);
    const startedAt = Date.now();
    const outcome = await gradeWithRubric(grader, {
      skill: 'WRITING',
      submissionRef: `smoke:writing:${c.id}`,
      rubric: rubricOf('WRITING'),
      taskPrompt: t.prompt,
      taskInstructions: t.instructions ?? null,
      responseText: c.text,
      writingLength: assessWritingLength(c.text, t.wordMin, t.wordMax),
    });
    results.push({
      id: c.id,
      skill: 'WRITING',
      expect: c.expect,
      latencyMs: Date.now() - startedAt,
      ...summarize(outcome),
    });
    console.log(
      `${c.id}: ${outcome.status}${outcome.status === 'GRADING_FAILED' ? ' ' + outcome.reason : ''}`,
    );
  }

  const files =
    audioDir && existsSync(audioDir)
      ? readdirSync(audioDir).filter(
          (f) => /^S\d_/.test(f) && MIME[extname(f).toLowerCase()],
        )
      : [];
  if (live && !files.length)
    console.log(
      'no Speaking recordings supplied; Speaking cases skipped (NOT_RUN)',
    );
  const normalizer = new DiagnosticSpeakingAudioNormalizer();
  for (const f of files.sort()) {
    const id = basename(f, extname(f));
    const t = task(id.startsWith('S2_') ? 'SPK_TASK_02' : 'SPK_TASK_01');
    const normalized = await normalizer.normalize(
      readFileSync(join(audioDir, f)),
      MIME[extname(f).toLowerCase()],
    );
    const startedAt = Date.now();
    const outcome = await gradeWithRubric(grader, {
      skill: 'SPEAKING',
      submissionRef: `smoke:speaking:${id}`,
      rubric: rubricOf('SPEAKING'),
      taskPrompt: t.prompt,
      taskInstructions: t.instructions ?? null,
      audio: normalized.buffer,
      durationMs: normalized.durationMs,
    });
    const said = join(audioDir, `${id}.txt`);
    const summary: any = summarize(outcome);
    results.push({
      id,
      skill: 'SPEAKING',
      durationMs: normalized.durationMs,
      latencyMs: Date.now() - startedAt,
      wordErrorRate:
        existsSync(said) && summary.transcript
          ? wordErrorRate(readFileSync(said, 'utf8'), summary.transcript)
          : null,
      ...summary,
    });
    console.log(
      `${id}: ${outcome.status}${outcome.status === 'GRADING_FAILED' ? ' ' + outcome.reason : ''}`,
    );
  }

  const outDir = join(ARTIFACTS, 'c3-live-smoke');
  mkdirSync(outDir, { recursive: true });
  const out = join(
    outDir,
    `${live ? 'live' : 'dry-run'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    out,
    JSON.stringify(
      {
        mode: live ? 'LIVE' : 'DRY_RUN',
        providersContacted: live,
        caps: {
          azureSessions: MAX_AZURE_SESSIONS,
          modelCalls: MAX_MODEL_CALLS,
        },
        used: { azureSessions: azure.count(), modelCalls: model.count() },
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `azure sessions ${azure.count()}/${MAX_AZURE_SESSIONS}, model calls ${model.count()}/${MAX_MODEL_CALLS}`,
  );
  console.log(`result -> ${out}`);
}

main().catch((e) => {
  console.error('C3 LIVE SMOKE STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
