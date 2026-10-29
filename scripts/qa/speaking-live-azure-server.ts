/**
 * Harness backend for an owner-authorized LIVE Azure Speaking Practice check
 * (CP60-SPEAKING: at most 2 Azure assessment operations, retries included).
 *
 * The normal application runs (controllers, upload validation, queue,
 * processor, persistence, rewards, post-processing). Only these are changed:
 *   - every request leaving the process goes through a guard: a POST to the
 *     Azure short-audio speech-to-text REST endpoint is allowed while the
 *     budget lasts and refused (before it is sent) afterwards; any other
 *     non-local host (Gemini, R2, TTS, …) is refused;
 *   - the Azure Speech SDK (the unscripted websocket path) is refused, so no
 *     operation can escape the count;
 *   - Gemini's post-grading feedback rewording is replaced by a labelled stub
 *     (no Gemini call is authorized), so the mixed-provider path is NOT live.
 * Each Azure exchange is logged to LIVE_AZURE_LOG: assessment parameters,
 * audio size, status and the returned scores. Never the key or the audio.
 * Refuses to start unless DATABASE_URL is a harness clone on :5460.
 *
 *   LIVE_AZURE_BUDGET=2 LIVE_AZURE_LOG=<file.jsonl> npx ts-node --transpile-only scripts/qa/speaking-live-azure-server.ts
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { GeminiEvaluatorStrategy } from '../../src/modules/ai/strategies/gemini-evaluator.strategy';

const BUDGET = Math.min(2, Number(process.env.LIVE_AZURE_BUDGET ?? 0));
const FAKE_FILE = process.env.LIVE_AZURE_FAKE_FILE;
const LOG = process.env.LIVE_AZURE_LOG;
let azureCalls = 0;
let refused = 0;

function log(entry: Record<string, unknown>) {
  if (LOG)
    appendFileSync(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: RequestInit) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  if (['127.0.0.1', 'localhost'].includes(url.hostname))
    return realFetch(input as never, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const isAzureStt =
    method === 'POST' &&
    /\.stt\.speech\.microsoft\.com$/.test(url.hostname) &&
    url.pathname.endsWith('/conversation/cognitiveservices/v1');
  // Deterministic mode (LIVE_AZURE_FAKE_FILE): the Azure request is answered
  // here from the scenario file, read at each call; nothing leaves the process.
  if (isAzureStt && FAKE_FILE) {
    const body = readFileSync(FAKE_FILE, 'utf8');
    log({ event: 'fake-azure', scenario: JSON.parse(body).__scenario ?? null });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!isAzureStt || azureCalls >= BUDGET) {
    refused += 1;
    log({
      event: 'refused',
      method,
      azure: isAzureStt,
      reason: isAzureStt ? 'budget reached' : 'host not allowed',
      refused,
    });
    throw new Error(
      isAzureStt ? 'LIVE_AZURE_BUDGET_REACHED' : 'LIVE_HOST_NOT_ALLOWED',
    );
  }
  azureCalls += 1;
  const n = azureCalls;
  const headers = new Headers(init?.headers);
  const pa = headers.get('Pronunciation-Assessment');
  const body = init?.body as Uint8Array | undefined;
  log({
    event: 'azure-request',
    n,
    query: url.search,
    contentType: headers.get('Content-Type'),
    audioBytes: body?.byteLength ?? null,
    assessment: pa ? JSON.parse(Buffer.from(pa, 'base64').toString()) : null,
  });
  const started = Date.now();
  const response = await realFetch(input as never, init);
  const copy = response.clone();
  let data: any = null;
  try {
    data = await copy.json();
  } catch {
    /* non-JSON error body */
  }
  const best = data?.NBest?.[0];
  const pron = best?.PronunciationAssessment ?? best ?? {};
  const words: any[] = best?.Words ?? [];
  const errorTypes: Record<string, number> = {};
  for (const w of words) {
    const t = w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? 'None';
    errorTypes[t] = (errorTypes[t] ?? 0) + 1;
  }
  log({
    event: 'azure-response',
    n,
    httpStatus: response.status,
    ms: Date.now() - started,
    recognitionStatus: data?.RecognitionStatus ?? null,
    durationTicks: data?.Duration ?? null,
    display: best?.Display ?? null,
    scores: {
      AccuracyScore: pron.AccuracyScore ?? null,
      FluencyScore: pron.FluencyScore ?? null,
      CompletenessScore: pron.CompletenessScore ?? null,
      PronScore: pron.PronScore ?? null,
      ProsodyScore: pron.ProsodyScore ?? null,
    },
    words: words.length,
    errorTypes,
  });
  return response;
};

// The unscripted path uses the SDK over a websocket, outside fetch: refused.
for (const method of [
  'recognizeOnceAsync',
  'startContinuousRecognitionAsync',
] as const) {
  (sdk.SpeechRecognizer.prototype as any)[method] = function (
    _ok?: unknown,
    err?: (e: string) => void,
  ) {
    refused += 1;
    log({ event: 'refused', sdk: method, refused });
    err?.('LIVE_AZURE_SDK_NOT_ALLOWED');
  };
}

// No Gemini call is authorized: the feedback rewording returns nothing, so
// the Azure-derived feedback stays as graded.
GeminiEvaluatorStrategy.prototype.generatePronunciationFeedback = function () {
  log({ event: 'gemini-feedback-stubbed' });
  return Promise.resolve({});
};

async function assertHarness() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@127\.0\.0\.1:5460\/(harness_clone|diag_clone)(\?|$)/.test(url))
    throw new Error('REFUSED: DATABASE_URL is not a harness clone');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
    'select current_database() db, system_identifier::text sysid from pg_control_system()',
  );
  await prisma.$disconnect();
  if (
    !['harness_clone', 'diag_clone'].includes(db) ||
    ['7674533776495505443', '7699757546958700579'].includes(sysid)
  )
    throw new Error(`REFUSED: target ${db} ${sysid} is not the harness`);
  if (process.env.MOCK_AZURE_SPEECH === 'true')
    throw new Error('REFUSED: MOCK_AZURE_SPEECH would bypass the live check');
  log({ event: 'start', db, sysid, budget: BUDGET, fake: Boolean(FAKE_FILE) });
}

async function bootstrap() {
  if (BUDGET < 1 && !FAKE_FILE)
    throw new Error('REFUSED: LIVE_AZURE_BUDGET not set');
  await assertHarness();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: true, credentials: true });
  await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
