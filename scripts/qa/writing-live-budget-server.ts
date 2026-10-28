/**
 * Harness backend with the REAL Gemini adapter and a hard request budget, for
 * an owner-authorized live grading check (Checkpoint 58: at most five
 * requests, retries included).
 *
 * Everything is the normal application (controllers, DTO validation, Writing
 * service, persistence); only the network call is counted. Every real Gemini
 * request goes through GeminiCredentialManager.execute → operation(model);
 * each operation call is counted before it runs, and once the budget is spent
 * the call throws a non-retryable error instead of reaching the provider.
 * Token usage and the model's raw text are appended to LIVE_GEMINI_LOG (no
 * credentials). It refuses to start unless DATABASE_URL is the harness clone.
 *
 * A second guard wraps globalThis.fetch and counts every HTTP request to the
 * Gemini API, so SDK-level or recovery requests cannot exceed the budget.
 *
 * Usage (from the harness launcher env): LIVE_GEMINI_BUDGET=5
 *   LIVE_GEMINI_LOG=<file.jsonl> npx ts-node --transpile-only scripts/qa/writing-live-budget-server.ts
 */
import { appendFileSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { GeminiCredentialManager } from '../../src/modules/ai/gemini/gemini-credential-manager.service';

const BUDGET = Math.min(5, Number(process.env.LIVE_GEMINI_BUDGET ?? 0));
const LOG = process.env.LIVE_GEMINI_LOG;
let requests = 0;

function log(entry: Record<string, unknown>) {
  if (LOG)
    appendFileSync(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
}

// Second guard at the network level: every HTTP request to the Gemini API
// counts, whatever layer sends it (SDK, retry, parse recovery). Past the
// budget the request is refused before it leaves the process.
let networkRequests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes('generativelanguage.googleapis.com')) {
    if (networkRequests >= BUDGET) {
      log({ event: 'network-blocked', budget: BUDGET });
      throw new Error('LIVE_GEMINI_BUDGET_REACHED');
    }
    networkRequests += 1;
    log({ event: 'network', n: networkRequests });
  }
  return realFetch(input as never, init as never);
};

type Execute = GeminiCredentialManager['execute'];
const realExecute: Execute = GeminiCredentialManager.prototype.execute;
GeminiCredentialManager.prototype.execute = function (options) {
  return realExecute.call(this, {
    ...options,
    operation: async (model: { model?: string }) => {
      if (requests >= BUDGET) {
        log({ event: 'blocked', budget: BUDGET });
        throw new Error('LIVE_GEMINI_BUDGET_REACHED');
      }
      requests += 1;
      const n = requests;
      log({ event: 'request', n, model: model.model, task: options.taskType });
      try {
        const result = await options.operation(model as never);
        const response = (result as any)?.response;
        log({
          event: 'response',
          n,
          usage: response?.usageMetadata ?? null,
          text: typeof response?.text === 'function' ? response.text() : null,
        });
        return result;
      } catch (error) {
        log({
          event: 'error',
          n,
          message: String((error as Error)?.message ?? error).slice(0, 300),
        });
        throw error;
      }
    },
  });
} as Execute;

async function assertHarness() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@127\.0\.0\.1:5460\/harness_clone/.test(url))
    throw new Error('REFUSED: DATABASE_URL is not the harness clone');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
    'select current_database() db, system_identifier::text sysid from pg_control_system()',
  );
  await prisma.$disconnect();
  if (db !== 'harness_clone' || sysid === '7674533776495505443')
    throw new Error(`REFUSED: target ${db} ${sysid} is not the harness`);
  log({ event: 'start', db, sysid, budget: BUDGET });
}

async function bootstrap() {
  if (BUDGET < 1) throw new Error('REFUSED: LIVE_GEMINI_BUDGET not set');
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
