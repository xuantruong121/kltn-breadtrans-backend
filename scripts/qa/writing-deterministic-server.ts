import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AI_EVALUATOR_TOKEN } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import type { IAIEvaluator } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const mode = process.env.WRITING_QA_PROVIDER_MODE === 'failure' ? 'failure' : 'success';
const counterFile = process.env.WRITING_QA_COUNTER_FILE;
let calls = 0;

function persistCounter() {
  if (!counterFile) return;
  mkdirSync(dirname(counterFile), { recursive: true });
  writeFileSync(counterFile, JSON.stringify({ mode, calls }), 'utf8');
}

function evaluate(score: number) {
  calls += 1;
  persistCounter();
  if (mode === 'failure') throw new Error('deterministic writing provider unavailable');
  return {
    score,
    feedback: 'Deterministic acceptance feedback.',
    suggestions: ['Deterministic improvement suggestion.'],
  };
}

const provider = {
  generateFeedback: async () => 'Deterministic generic feedback.',
  chat: async () => 'Deterministic chat response.',
  assessPronunciation: async () => ({
    overallScore: 0,
    clarity: 'Poor',
    feedback: 'Not available in Writing acceptance provider.',
    problematicWords: [],
    suggestions: [],
  }),
  explainToeicError: async () => 'Deterministic explanation.',
  generateToeicQuestions: async () => [],
  generateDictation: async () => [],
  evaluateWritingPart1: async () => evaluate(3),
  evaluateWritingPart2: async () => evaluate(4),
  evaluateWritingPart3: async () => evaluate(5),
  evaluateSpeakingPart3To5: async () => evaluate(5),
  importEtsPdf: async () => [],
  generateSmartContentFromDocument: async () => ({
    quizQuestions: [],
    flashcards: [],
    assignment: { title: 'QA', description: 'QA', instructions: 'QA' },
  }),
} as unknown as IAIEvaluator;

async function bootstrap() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_EVALUATOR_TOKEN)
    .useValue(provider)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: true, credentials: true });
  persistCounter();
  await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
